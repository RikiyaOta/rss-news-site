# AGENTS.md - AI エージェント開発ガイドライン

本リポジトリ（`rss-news-site`）で作業を行うすべての AI エージェントは、以下の開発規約および制約事項を厳格に遵守してください。

---

## 1. ツールチェーン & パッケージマネージャー制約

* **パッケージマネージャーの厳格固定:**
  * パッケージのインストール、ビルド、テスト、スクリプト実行には **必ず `pnpm` のみを使用** してください。
  * **`npm`、`npx`、`yarn`、`bun` 等のコマンドは絶対に使用禁止** です（例: `npm test` ではなく `pnpm test`、`npx vitest` ではなく `pnpm vitest`）。
* **バージョンマネージャー (`mise`):**
  * グローバルツール（Node.js 24 LTS, pnpm 11.22, Terraform 1.15.8, pinact 4.0.0）は `mise.toml` で管理されており、`mise.lock` でハッシュ固定されています。
* **サプライチェーンセキュリティ:**
  * `pnpm-workspace.yaml` に `minimumReleaseAge: 10080`（7日間）が設定されています。最新リリースから7日未満のパッケージはインストールできません。

---

## 2. テスト規約 & 品質基準

* **テストケース名の完全日本語化:**
  * Vitest および Playwright のすべてのテストケース名（`describe`, `it`, `test` の第1引数）およびアサーションメッセージは **すべて日本語** で記述してください。
* **テスト実行コマンド:**
  * ユニットテスト: `pnpm test`
  * カバレッジ計測: `pnpm test:coverage`
  * 型チェック: `pnpm typecheck` (`tsc --noEmit`)
  * E2Eテスト: `pnpm test:e2e`
* **テスト駆動開発 (TDD):**
  * 新規機能・修正時は必ず失敗するテスト（Red）を作成してから実装（Green）し、リファクタリング（Refactor）を行ってください。

---

## 3. コマンド実行 & サンドボックス規約

* **サンドボックス内実行の徹底:**
  * コマンドを実行する際は、原則として標準サンドボックスモード（`BypassSandbox: false`）で実行してください。
* **単一コマンドの実行:**
  * `&&` や `|`（パイプ）で複数のコマンドを1行に連結せず、1ステップにつき単一のコマンドを実行してください。

---

## 4. アーキテクチャ & 実装ルール

1. **RSS 収集 & ローカル多言語埋め込みスコアリングパイプライン:**
   * 外部 LLM API（Gemini 等）を使用せず、ローカルの `BAAI/bge-m3` 埋め込みモデルを用いてユーザー関心プロファイルとのコサイン類似度から 0〜100 点でスコアリングします。
   * RSS 記事のメタデータ（`og:description` / `description`）を抽出してスニペットとして保存します。
   * 記事の公開日時（`published_at`）から日本標準時（JST）の日付（`published_date_jst`）を算出して保存します。
2. **多言語ベクトル埋め込み (`BAAI/bge-m3`):**
   * 記事登録（インデックス化）時のテキストには必ず **`"passage: "`** プレフィックスを付与してください（例: `"passage: {title}\n{summary}"`）。
   * 検索クエリのベクトル化時には必ず **`"query: "`** プレフィックスを付与してください。
   * ベクトルは 1024 次元の L2 正規化済み `Float32Array`（BLOB 4096バイト）を扱います。
3. **Cloudflare D1 データベース設計:**
   * テーブル: `articles` (`id` PK, `title`, `url` UNIQUE, `source_name`, `summary`, `score`, `published_at`, `published_date_jst`, `embedding` BLOB, `created_at`)
   * インデックス: `idx_articles_jst_score` (`published_date_jst, score DESC`), `idx_articles_url` (`url`), `idx_articles_score` (`score DESC`)
4. **Cloudflare Workers & Hono API:**
   * Cloudflare Workers（Static Assets + Hono）によるエッジ API / フロントエンド配信。
   * `/api/articles?date=YYYY-MM-DD`: `published_date_jst` 基準の日別記事一覧（スコア降順）。
   * `/api/search?q=...`: Workers AI (`@cf/baai/bge-m3`) によるクエリベクトル化と D1 全記事ベクトル類似度検索。
5. **Terraform & Wrangler 責務分離方針 (Cloudflare Best Practice):**
   * **Terraform の責務:** 永続インフラ・長寿命リソースである Cloudflare D1 データベース（`rss-news-db`）の作成とライフサイクル管理に専念（tfstate は R2 バケット `rss-news-site-tfstate` で管理）。
   * **Wrangler の責務 (`wrangler.jsonc`):** アプリケーションコード（Hono）、React SPA 静的アセット、D1 / Workers AI バインディング、カスタムドメインのルーティングを一元管理。Worker 本体を Terraform 側に重複定義しない。
   * すべてのサードパーティ GitHub Action は `pinact` を使用してコミットハッシュ（SHA-1）で固定してください。
