# AI RSS News & Semantic Search

完全無料で運用可能な、AI駆動型の個人向けニュース収集・要約・セマンティック検索ダッシュボードシステムです。

GitHub Actions による毎日の自動巡回で最新の技術記事を収集し、多言語ベクトルモデル（`intfloat/multilingual-e5-small`）による興味関心スコアリングとメタデータ抽出、さらにブラウザ内の WebAssembly 版 SQLite（`sql.js`）を活用した爆速の自然言語横断検索を提供します。

---

## 🌟 主な特徴

- **完全無料運用（ゼロサーバー構成）:**
  - サーバーサイド DB を常時稼働させず、静的ホスティング（Cloudflare Pages）とオブジェクトストレージ（Cloudflare R2）のみで構成。外部 LLM API キーも不要。
- **ローカル多言語ベクトルによる興味関心スコアリング:**
  - `intfloat/multilingual-e5-small` を用いて記事とユーザー関心プロファイルのコサイン類似度をローカル計算し、0〜100 点でスコアリング。
- **ブラウザ内セマンティック検索（ベクトル検索）:**
  - Web Worker 上で検索クエリを 384 次元ベクトル化し、Wasm SQLite で過去全期間の記事から類似記事をミリ秒単位で高速検索。
- **差分ダウンロード & インメモリ結合:**
  - 検索ヒットした日付の SQLite ファイルのみを並列差分ダウンロードし、クライアント側でシームレスに結合・表示。
- **IaC & 自動デプロイ:**
  - Terraform による Cloudflare インフラのコード管理、および GitHub Actions による CI/CD・日次バッチ・定期 E2E テスト。

---

## 🏗️ システム構成図

```
[ GitHub Actions (日次自動実行: Cron) ]
  │
  ├── 1. 各 RSS フィードから新規記事を取得 & メタデータ補完 (og:description)
  ├── 2. multilingual-e5-small で記事埋め込みベクトル生成 (384次元)
  ├── 3. ユーザー関心プロファイルとのコサイン類似度に基づくローカル自動スコアリング
  ├── 4. 日別記事 SQLite DB (data/YYYY-MM-DD.db) & 全体検索インデックス (search_index.db) を更新
  └── 5. Cloudflare R2 ストレージへアップロード

[ フロントエンド (Cloudflare Pages / React SPA) ]
  │
  ├── 日別閲覧: 選択日付の SQLite DB を R2 から取得し、Wasm SQLite でスコア順表示
  └── 横断検索: Web Worker で検索クエリをベクトル化 → 類似度走査 → 該当日の DB のみ差分取得して結合
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
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare アカウント ID（Terraform / Pages デプロイ用） | 必須 |
| `CLOUDFLARE_API_TOKEN` | Cloudflare Pages & R2 の編集権限を持つ API トークン | 必須 |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 の S3 互換 Access Key ID（Daily Pipeline / Deploy 用） | 必須 |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 の S3 互換 Secret Access Key（Daily Pipeline / Deploy 用） | 必須 |
| `R2_ACCOUNT_ID` | Cloudflare アカウント ID（Daily Pipeline の R2 クライアント用）。未設定の場合は `CLOUDFLARE_ACCOUNT_ID` を流用 | 任意 |
| `R2_BUCKET_NAME` | データ配信用の R2 バケット名（未設定時は `rss-news-site-data`） | 任意 |
| `VITE_R2_PUBLIC_URL` | R2 バケットの公開アクセス URL / カスタムドメイン（未設定時は `https://rss-news.rikiyaota.kyoto`） | 任意 |

### 3. 初回デプロイとデータ生成

1. **インフラ & フロントエンドのデプロイ:**
   - コードを `main` ブランチに push すると、`.github/workflows/deploy.yml` が自動起動し、Terraform の適用（R2 バケット作成など）と Cloudflare Pages へのデプロイが完了します。
2. **初回の記事収集パイプライン実行:**
   - GitHub の **Actions** タブから `Daily Pipeline` ワークフローを選択し、**Run workflow**（手動実行）をクリックして初回データを生成・R2 に同期します。

---

## 💻 ローカル開発環境

### 必須ツール
- `mise`（Node.js, pnpm, Terraform などのバージョン管理）

### セットアップコマンド

```bash
# ツールのセットアップ
mise install

# 依存パッケージのインストール
pnpm install

# 開発サーバーの起動 (http://localhost:5173)
pnpm dev

# 全品質チェック (型チェック・リント・フォーマット・テスト)
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

収集対象の RSS フィードおよびスコアリング基準は [`config/feeds.yaml`](file:///Users/rikiyaota/Documents/github.com/RikiyaOta/rss-news-site/config/feeds.yaml) でカスタマイズ可能です。

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
AI エージェントおよび開発者向けの詳細な開発規約・制約事項は [AGENTS.md](file:///Users/rikiyaota/Documents/github.com/RikiyaOta/rss-news-site/AGENTS.md) を参照してください。
