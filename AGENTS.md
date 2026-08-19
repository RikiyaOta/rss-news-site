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

1. **RSS 収集 & Gemini 2.5 Flash-Lite パイプライン:**
   * Gemini API の無料枠制限（15 RPM）を遵守するため、記事の要約・スコアリング処理のリクエスト間には必ず **4.2秒 (4200ms) のスリープ（待機）** を挟んでください。
   * スコアは 0〜100 の整数値、要約は箇条書きの3行日本語サマリーを出力してください。
2. **多言語ベクトル埋め込み (`intfloat/multilingual-e5-small`):**
   * 記事登録（インデックス化）時のテキストには必ず **`"passage: "`** プレフィックスを付与してください。
   * 検索クエリのベクトル化時には必ず **`"query: "`** プレフィックスを付与してください。
   * ベクトルは 384 次元の L2 正規化済み `Float32Array` を扱います。
3. **SQLite データベース設計:**
   * 日別記事DB: `data/YYYY-MM-DD.db`（テーブル: `articles`、`idx_articles_score` インデックス）
   * 全体検索DB: `search_index.db`（テーブル: `search_index`、`article_id`, `date`, `embedding` BLOB）
4. **Cloudflare R2 & Terraform:**
   * R2 バケット: `rss-news-site-data`
   * Terraform の tfstate は R2 バケット `rss-news-site-tfstate` で S3 互換バックエンドとして管理します。
5. **GitHub Actions セキュリティ:**
   * すべてのサードパーティ GitHub Action は `pinact` を使用してコミットハッシュ（SHA-1）で固定してください。
