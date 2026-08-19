# 設計仕様書: AI駆動型RSS収集・検索システム (rss-news-site)

- **作成日:** 2026-08-19
- **ステータス:** 設計完了・承認待ち

---

## 1. システム概要とゴール

本システムは、GitHub Actions による日次定期巡回で RSS フィードから記事を収集し、Gemini 2.5 Flash-Lite による要約・スコアリングおよび `intfloat/multilingual-e5-small` による日本語ベクトル埋め込み（384次元）を行い、Cloudflare R2 上の SQLite データベースとして公開する、**完全無料で運用可能な個人向けニュースダッシュボード** である。

フロントエンド（Cloudflare Pages 上の React SPA）は、WebAssembly 版 SQLite とブラウザ内 Transformers.js を組み合わせることで、サーバーサイド DB を一切介さずに爆速のセマンティック（ベクトル）横断検索を実現する。

---

## 2. システムアーキテクチャ

```mermaid
flowchart TD
    subgraph GitHub Actions [GitHub Actions (Cron / PR / Deploy)]
        cron[毎日07:00 JST: RSS収集・AI要約・ベクトル化]
        tf_ci[PR / Merge: Terraform Plan & Apply]
        pr_ci[PR / Push: Vitest テスト & カバレッジ出力]
        e2e_cron[毎朝09:00 JST: Playwright E2E 定期実行]
    end

    subgraph Cloudflare [Cloudflare Platform]
        R2_TF[(R2 Bucket: rss-news-site-tfstate)]
        R2_DATA[(R2 Bucket: rss-news-site-data)]
        PAGES[Cloudflare Pages: React SPA ホスティング]
    end

    subgraph UserBrowser [ユーザーのブラウザ (SPA)]
        UI[React UI (Tailwind CSS)]
        Worker[Web Worker: Transformers.js (e5-small)]
        WasmDB[sql.js / sqlite-vec (Wasm)]
    end

    cron -->|要約・スコア| gemini[Google AI Studio: Gemini 2.5 Flash-Lite]
    cron -->|アップロード: data/YYYY-MM-DD.db & search_index.db| R2_DATA
    tf_ci -->|State 管理| R2_TF
    tf_ci -->|構成反映| R2_DATA
    tf_ci -->|構成反映| PAGES

    UI -->|日別閲覧: data/YYYY-MM-DD.db 取得| R2_DATA
    UI -->|全体検索: search_index.db 取得| R2_DATA
    UI -->|クエリベクトル化| Worker
    UI -->|インデックス走査 & 差分DB取得・結合| WasmDB
```

---

## 3. 技術スタック・セキュリティ・ツールチェーン

### 3.1 ツール管理 & サプライチェーン攻撃対策
* **バージョンマネージャー:** `mise` (`mise.toml` & `mise.lock`)
  * Node.js: `24.19.0` (LTS 最新)
  * pnpm: `11.22.0` (最新安定版)
  * Terraform: `1.15.8` (最新安定版)
  * pinact: `4.0.0` (最新メジャー)
* **パッケージセキュリティ (`pnpm-workspace.yaml`):**
  * `pnpm-workspace.yaml` 内で `minimumReleaseAge: 10080`（7日間 = $7 \times 24 \times 60$ 分）および `minimumReleaseAgeStrict: true` を設定。リリース後7日未満のパッケージ依存解決・インストールを遮断。
  * `pnpm-lock.yaml` および `mise.lock` をリポジトリで厳格にコミット管理。
* **GitHub Actions セキュリティ:**
  * `pinact` を使用し、すべてのサードパーティ GitHub Action をコミットハッシュ（SHA-1）で固定（例: `actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2`）。

### 3.2 構成要素
| コンポーネント | 選定技術 (バージョン要件) | 採用理由・役割 |
| :--- | :--- | :--- |
| フロントエンド | React 19 + Vite 6 + TypeScript + Tailwind CSS | 高速ビルド、Wasm / Web Worker との親和性 |
| バックエンド | Node.js 24 LTS + TypeScript + `pnpm` (tsx) | フロントと型・Transformers.js (ONNX) 互換性を100%統一 |
| 要約・スコア AI | Gemini 2.5 Flash-Lite (`@google/genai`) | 1,000 req/日 無料枠、高精度な日本語要約とスコアリング |
| ベクトル化 AI | `intfloat/multilingual-e5-small` | 384次元の軽量日本語対応埋め込みモデル（ONNX / Transformers.js） |
| データベース | SQLite + sqlite-vec | 日別DBおよび全体ベクトル検索用 Wasm DB |
| ストレージ | Cloudflare R2 (`rss-news-site-data`) | 10GB 無料枠、転送量（Egress）完全無料 |
| IaC | Terraform + S3 backend (R2: `rss-news-site-tfstate`) | Cloudflare リソースのコード管理と自動反映 |

---

## 4. データベース設計

### 4.1 日別データDB (`data/YYYY-MM-DD.db`)
* **用途:** 特定の日付の記事一覧表示、および検索結果の詳細表示
* **スキーマ:**
```sql
CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,       -- URLのSHA-256ハッシュ (先頭16文字)
    title TEXT NOT NULL,       -- 記事タイトル
    url TEXT NOT NULL,         -- 記事URL
    source_name TEXT NOT NULL, -- フィード名 (例: "Zenn", "Hacker News")
    summary TEXT NOT NULL,     -- Geminiによる3行要約 (箇条書き改行区切り)
    score INTEGER NOT NULL,    -- 興味関心スコア (0〜100)
    published_at TEXT NOT NULL -- ISO 8601 形式の公開日時
);
CREATE INDEX IF NOT EXISTS idx_articles_score ON articles(score DESC);
```

### 4.2 全体検索インデックスDB (`search_index.db`)
* **用途:** 過去全期間を横断するコサイン類似度（ベクトル）検索
* **スキーマ:**
```sql
CREATE TABLE IF NOT EXISTS search_index (
    article_id TEXT PRIMARY KEY, -- 日別DBの id と対応
    date TEXT NOT NULL,          -- 該当記事の日付 ("YYYY-MM-DD")
    embedding BLOB NOT NULL      -- Float32Array 384次元 (1536 bytes)
);
CREATE INDEX IF NOT EXISTS idx_search_index_date ON search_index(date);
```

---

## 5. 処理フロー詳細

### 5.1 バックエンド収集パイプライン (`src/pipeline/`)
1. **設定読込:** `config/feeds.yaml` から RSS フィード一覧および興味関心プロファイル（関心のある技術・除外キーワード・採点基準）をパース。
2. **RSS巡回 (`rss-parser`):** 各フィードから記事を取得し、URLハッシュを生成。
3. **差分判定:** 過去7日間の日別DBおよび `search_index.db` に存在する記事IDを除外。
4. **Gemini API 要約 & スコアリング:**
   * モデル: `gemini-2.5-flash-lite`
   * プロンプト: 記事タイトルと概要から、ユーザープロファイルに基づいた 0〜100 のスコアと 3 行要約（日本語）を JSON 形式で出力。
   * **レート制限待機:** 15 RPM を遵守するため、各記事のリクエスト完了後に **4.2 秒** の待機（Sleep）を実行。
5. **ベクトル埋め込み生成 (`@huggingface/transformers`):**
   * モデル: `intfloat/multilingual-e5-small` (ONNX)
   * 入力形式: `"passage: " + title + "\n" + summary`
   * 出力: 384次元の `Float32Array`（L2正規化済み）
6. **DB書き込み & R2アップロード:**
   * 当日分の `data/YYYY-MM-DD.db` を生成・追記。
   * `search_index.db` を R2 から取得し、新規ベクトルレコードを `search_index` テーブルに追加。
   * 両ファイルを `@aws-sdk/client-s3` 経由で R2 バケットにアップロード（上書き）。

### 5.2 フロントエンド検索フロー (`src/web/`)
1. **通常表示（日別モード）:**
   * 選択された日付の `data/YYYY-MM-DD.db` を R2 から fetch。
   * `sql.js` (SQLite Wasm) でオープンし、`SELECT * FROM articles ORDER BY score DESC` を実行して即座に描画。
2. **横断セマンティック検索モード:**
   * ユーザーが検索クエリを入力（例:「Rust での非同期処理」）。
   * Web Worker 内の `Transformers.js` で `"query: " + query` を 384 次元ベクトルに変換。
   * `search_index.db` から全ベクトルをロードし、内積（コサイン類似度）を計算して上位 K 件（例: 20件）の `{article_id, date, similarity}` を抽出。
   * ヒットした日付のうち、未ロードの `data/YYYY-MM-DD.db` のみを並列差分ダウンロード。
   * 各日付 DB から `article_id` に合致する記事レコードを取得し、類似度順にクライアント側で結合して結果を表示。

---

## 6. Terraform インフラ管理 (`terraform/`)

* **Backend:** S3 backend (R2: `rss-news-site-tfstate`)
* **構成リソース (`main.tf`):**
  * `cloudflare_r2_bucket.data`: バケット名 `rss-news-site-data`
  * `cloudflare_r2_bucket_cors`:
    * Allowed Origins: `["*"]`（または Pages ドメイン）
    * Allowed Methods: `["GET", "HEAD"]`
    * Allowed Headers: `["*"]`
  * `cloudflare_pages_project.web`:
    * Project Name: `rss-news-site`
    * Production Branch: `main`

---

## 7. CI/CD & テスト戦略

### 7.1 ワークフロー定義 (`.github/workflows/`)
1. **`ci.yml` (PR / Push 毎):**
   * `mise` & `pnpm` セットアップ
   * 型チェック (`tsc --noEmit`)
   * ユニット・統合テスト (`vitest run --coverage`)
   * **GitHub Step Summary にカバレッジレポート（テーブル形式）を出力**
2. **`daily-pipeline.yml` (毎日 07:00 JST 定期実行 & 手動実行):**
   * RSS収集・Gemini要約・ベクトル化・R2アップロードを実行
3. **`e2e-daily.yml` (毎朝 09:00 JST 定期実行):**
   * Playwright による E2E テスト実行（PR 時の CI 負荷を回避）
4. **`terraform.yml` (PR / main マージ時):**
   * PR 時: `terraform plan`
   * main マージ時: `terraform apply`
5. **`deploy-pages.yml` (main マージ時):**
   * フロントエンドのビルド & Cloudflare Pages へのデプロイ

### 7.2 テスト方針 (すべて日本語記述)
* すべてのテストケース（`describe`, `it`, `test`）のタイトルおよびアサーション理由を日本語で記述。
* **カバレッジ目標:** コアロジック（パーサー、Gemini連携、ベクトル化、差分DBマージ）において 85% 以上を維持。
