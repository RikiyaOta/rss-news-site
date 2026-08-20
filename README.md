# AI RSS News & Semantic Search

完全無料で運用可能な、AI駆動型の個人向けニュース収集・要約・セマンティック検索ダッシュボードシステムです。

GitHub Actions による毎日の自動巡回で最新の技術記事を収集し、多言語ベクトルモデル（`BAAI/bge-m3`）による興味関心スコアリングとメタデータ抽出を行い、Cloudflare D1 に同期。Cloudflare Workers（Static Assets + Hono）と Workers AI（`@cf/baai/bge-m3`）を活用して、高速な日別記事配信と自然言語セマンティック検索を提供します。

---

## 🌟 主な特徴

- **完全無料・エッジサーバーレス構成:**
  - Cloudflare Workers（Static Assets + Hono）と Cloudflare D1、Workers AI による高可用・低レイテンシ構成。外部 LLM API キーも不要。
- **ローカル多言語ベクトルによる興味関心スコアリング:**
  - GitHub Actions 上で `BAAI/bge-m3`（1024次元）を用いて記事とユーザー関心プロファイルのコサイン類似度をローカル計算し、0〜100 点で自動スコアリング。
- **エッジ AI による自然言語セマンティック検索:**
  - Cloudflare Workers AI（`@cf/baai/bge-m3`）で検索クエリを 1024 次元ベクトル化し、Cloudflare D1 に格納された全期間の記事ベクトルとの類似度計算により高精度なセマンティック検索をミリ秒単位で実現。
- **公開日（JST）基準の日別一覧 & 検索:**
  - 記事の公開日時（`published_at`）から日本標準時（JST）の日付（`published_date_jst`）を算出し、高速インデックス検索。正確な日別閲覧と検索結果の日付バッジ表示を提供。
- **モダン & 軽量なフロントエンド:**
  - React 19 + Tailwind CSS + Lucide Icons による快適な UI/UX。日別ナビゲーションとセマンティック検索のシームレスなタブ切り替え。
- **IaC & 自動デプロイ:**
  - Terraform による Cloudflare インフラ（D1 / Pages）のコード管理、および GitHub Actions による CI/CD・日次バッチ・定期 E2E テスト。

---

## 🏗️ システム構成図

```
[ GitHub Actions (日次自動実行: Cron) ]
  │
  ├── 1. 各 RSS フィードから新規記事を取得 & メタデータ補完 (og:description)
  ├── 2. BAAI/bge-m3 で記事埋め込みベクトル生成 (1024次元 Float32Array)
  ├── 3. ユーザー関心プロファイルとのコサイン類似度に基づくローカル自動スコアリング (0〜100点)
  └── 4. Cloudflare D1 データベース (articles テーブル) へバッチ同期 (UPSERT)

[ バックエンド & フロントエンド (Cloudflare Workers / Hono / React SPA) ]
  │
  ├── 日別閲覧 (/api/articles?date=YYYY-MM-DD):
  │     D1 から published_date_jst 基準でスコア順に取得して即時返却
  │
  └── セマンティック検索 (/api/search?q=...):
        Workers AI (@cf/baai/bge-m3) でクエリを 1024 次元ベクトル化
        → D1 の全記事ベクトルとのコサイン類似度を計算し、類似度順に返却
```

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
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare アカウント ID（Terraform / Pages / D1 用） | 必須 |
| `CLOUDFLARE_API_TOKEN` | Cloudflare D1 & Pages の編集権限を持つ API トークン | 必須 |
| `CLOUDFLARE_D1_DATABASE_ID` | Cloudflare D1 データベース ID（日次パイプライン同期用） | 必須 |
| `R2_ACCESS_KEY_ID` | Terraform tfstate 管理用 R2 の S3 互換 Access Key ID | 必須 |
| `R2_SECRET_ACCESS_KEY` | Terraform tfstate 管理用 R2 の S3 互換 Secret Access Key | 必須 |

### 3. 初回デプロイとデータ生成

1. **インフラ & フロントエンドのデプロイ:**
   - コードを `main` ブランチに push すると、`.github/workflows/deploy.yml` が自動起動し、Terraform の適用（D1 データベース作成など）と Cloudflare Pages へのデプロイが完了します。
2. **初回の記事収集パイプライン実行:**
   - GitHub の **Actions** タブから `Daily Pipeline` ワークフローを選択し、**Run workflow**（手動実行）をクリックして初回データを収集し、D1 データベースに同期します。

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

## ⚙️ フィードおよび関心プロファイルの設定

収集対象の RSS フィードおよびスコアリング基準は [`config/feeds.yaml`](config/feeds.yaml) でカスタマイズ可能です。

```yaml
feeds:
  - name: "Zenn AI"
    url: "https://zenn.dev/topics/ai/feed"
  - name: "Hacker News"
    url: "https://news.ycombinator.com/rss"

profile:
  interests:
    - "TypeScript"
    - "Cloudflare Workers"
    - "AI Agents"
  exclude_keywords:
    - "PR記事"
    - "初学者向けチュートリアル"
  scoring_guidelines: "実用的で技術的深みがあり、新規性のある記事を高く評価する"
```

---

## 📖 開発規約
AI エージェントおよび開発者向けの詳細な開発規約・制約事項は [AGENTS.md](AGENTS.md) を参照してください。
