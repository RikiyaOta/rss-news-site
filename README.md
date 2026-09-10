# RSS News for Me

技術ブログの RSS フィードを定期的に巡回し、**自分の関心にどれだけ近いか**でスコアを付けて日別に並べる、個人用のニュースサイトです。外部 LLM API を使わず、埋め込みモデルによるベクトル類似度だけでスコアリングするため、完全無料で運用できます。

サイト: [rss-news.rikiyaota.kyoto](https://rss-news.rikiyaota.kyoto)

---

## 📡 どこからデータを取っているか

購読しているフィードの一覧は [`config/feeds.yaml`](config/feeds.yaml) の `feeds` がすべてです（このファイルが唯一の正で、ここに無いフィードは巡回しません）。

収集は GitHub Actions の定期実行で行います（スケジュールは [`.github/workflows/fetch-and-score-pipeline.yml`](.github/workflows/fetch-and-score-pipeline.yml) を参照）。各記事について、

- タイトル・URL・配信元名を取得する
- 記事ページの `og:description`、無ければフィードの `description` をスニペットとして保存する
- 公開日時（`published_at`）から JST の日付（`published_date_jst`）を算出する

を行い、Cloudflare D1 の `articles` テーブルへ UPSERT します。

---

## 🎯 どうスコアが付くか

スコアは **記事と自分の関心プロファイルとのコサイン類似度** だけで決まります。編集者もランキングも介在しません。

1. `config/feeds.yaml` の `profile.interests`（関心キーワード群）を、それぞれ多言語埋め込みモデル `BAAI/bge-m3` で 1024 次元のベクトルにする
2. 記事の「タイトル＋スニペット」も同じモデルで同じ空間のベクトルにする
3. 記事ベクトルと **各関心ベクトルとのコサイン類似度の最大値** を取る（最も近い関心が、その記事のスコアの根拠になる）
4. 類似度を区分に当てはめて 0〜100 点へ変換する

| 点数帯 | 意味 |
|---|---|
| 85〜100 | 実測の上限を超える例外的な一致 |
| 65〜84 | 明確に関心テーマの記事 |
| 40〜64 | 関連はしているが主題ではない |
| 0〜39 | 無関係な記事でも出る水準 |

点数の切り方（各区分の下端）は [`src/shared/score-bands.ts`](src/shared/score-bands.ts) が正で、記事カードのバッジの色もここを参照します。類似度そのもののしきい値は [`src/pipeline/scorer.ts`](src/pipeline/scorer.ts) の `SIMILARITY_BANDS` が正です。「単語に近い短い関心テキスト」と「タイトル＋要約」を突き合わせる非対称な構成のため、類似度は文ペア類似度の常識よりかなり低いレンジ（実測でおおむね 0.32〜0.56）に収まります。一般的なベンチマークの数字を根拠にしきい値を置くと上位区分が到達不能になるため、モデルや関心テキストを変えたときは実測の分布を見て置き直しています。

### 除外キーワード

`profile.exclude_keywords` に載せた語が「タイトル＋要約」の先頭 1000 文字（埋め込みに使うテキストと同じ範囲）に部分一致した記事は、類似度によらずスコアを 10 点以下に潰します。本文全体を配信するフィードでも、本文の奥に 1 度出ただけの語で記事が潰れないようにするため、照合範囲を埋め込みと揃えています。部分一致なので巻き込み事故を起こしやすく、「その語が本文にあれば確実に読みたくない」と言い切れるものだけを置いています。

### 関心プロファイルを変えたら

`config/feeds.yaml` を編集して `main` に push すると、次回のパイプライン実行から新しいプロファイルが使われます。既存記事のスコアは自動では変わらないため、`Rescore Existing Articles` ワークフロー（[`.github/workflows/rescore-articles.yml`](.github/workflows/rescore-articles.yml)）で全件を再スコアリングします。

---

## 📅 日付の扱い

画面の日付は **フィードが提供する公開日時のみ** を正とします。

- 収集（巡回）時刻を公開日時の代わりに使うことはしません
- 公開日時を取得できない記事は、そもそも取り込みません
- 再巡回で既存記事の公開日が後ろの日付へ移動しないよう、UPSERT では古い方を保持します

このため、同じ記事が複数の日にまたがって現れることはありません。

---

## 🔍 セマンティック検索

日別一覧とは別に、自然言語で全期間の記事を横断検索できます。Cloudflare Workers AI（`@cf/baai/bge-m3`）で検索クエリを 1024 次元ベクトル化し、D1 に格納済みの記事ベクトルとのコサイン類似度順に返します。記事側のベクトルは収集時に計算済みなので、検索のたびに記事を再処理することはありません。

---

## 🏗️ システム構成

```
[ GitHub Actions (定期実行) ]
  │
  ├── 1. 各 RSS フィードから新規記事を取得 & メタデータ補完 (og:description)
  ├── 2. BAAI/bge-m3 で記事埋め込みベクトル生成 (1024次元 Float32Array)
  ├── 3. 関心プロファイルとのコサイン類似度に基づくスコアリング (0〜100点)
  └── 4. Cloudflare D1 (articles テーブル) へバッチ同期 (UPSERT)

[ Cloudflare Workers / Hono / React SPA ]
  │
  ├── 日別閲覧 (/api/articles?date=YYYY-MM-DD):
  │     D1 から published_date_jst 基準でスコア順に取得して即時返却
  │
  └── セマンティック検索 (/api/search?q=...):
        Workers AI (@cf/baai/bge-m3) でクエリをベクトル化
        → D1 の全記事ベクトルとのコサイン類似度を計算し、類似度順に返却
```

- **フロントエンド:** React 19 + Tailwind CSS + Lucide Icons
- **エッジ:** Cloudflare Workers（Static Assets + Hono）、Cloudflare D1、Workers AI
- **パイプライン:** GitHub Actions 上で `@huggingface/transformers` により `BAAI/bge-m3` をローカル実行
- **IaC:** Terraform で D1 を管理（tfstate は R2）、アプリ側は Wrangler

---

## 🚀 本番デプロイ手順 & 環境設定

本システムを GitHub Actions および Cloudflare 上にデプロイするための事前準備手順です。

### 1. Cloudflare R2 で tfstate 用バケットを作成（手動）

Terraform の状態ファイル（`terraform.tfstate`）を管理するため、Cloudflare ダッシュボード上で以下のバケットを手動で作成してください。

- **バケット名:** `rss-news-site-tfstate`
- **リージョン:** Automatic (または APAC)

### 2. GitHub Secrets の設定

本リポジトリの **Settings > Secrets and variables > Actions** に、以下のシークレットを登録してください。

| シークレット名 | 説明 | 必須 |
|---|---|:---:|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare アカウント ID（Terraform / Workers / D1 用） | 必須 |
| `CLOUDFLARE_API_TOKEN` | Cloudflare D1 & Workers の編集権限を持つ API トークン | 必須 |
| `CLOUDFLARE_D1_DATABASE_ID` | Cloudflare D1 データベース ID（記事収集パイプライン同期用） | 必須 |
| `R2_ACCESS_KEY_ID` | Terraform tfstate 管理用 R2 の S3 互換 Access Key ID | 必須 |
| `R2_SECRET_ACCESS_KEY` | Terraform tfstate 管理用 R2 の S3 互換 Secret Access Key | 必須 |

### 3. 初回デプロイとデータ生成

1. **インフラ & フロントエンドのデプロイ:**
   - コードを `main` ブランチに push すると、`.github/workflows/deploy.yml` が自動起動し、Terraform の適用（D1 データベース作成）と Cloudflare Workers (Static Assets) へのデプロイが完了します。
2. **初回の記事収集パイプライン実行:**
   - GitHub の **Actions** タブから `Fetch & Score Articles Pipeline` ワークフローを選択し、**Run workflow**（手動実行）をクリックして初回データを収集し、D1 データベースに同期します。

---

## 💻 ローカル開発環境

### 必須ツール
- `mise`（Node.js, pnpm, Terraform, pinact などのバージョン管理）

### セットアップコマンド

```bash
# ツールのセットアップ
mise install

# 依存パッケージのインストール
pnpm install

# 開発サーバーの起動 (http://localhost:5173)
pnpm dev

# 全品質チェック (型チェック・リント・フォーマット・Terraform検証・テスト)
pnpm check

# ユニット & 統合テスト実行
pnpm test

# E2E テスト実行 (Playwright)
pnpm test:e2e

# プロダクションビルド
pnpm build
```

---

## 📖 開発規約
AI エージェントおよび開発者向けの詳細な開発規約・制約事項は [AGENTS.md](AGENTS.md) を参照してください。
