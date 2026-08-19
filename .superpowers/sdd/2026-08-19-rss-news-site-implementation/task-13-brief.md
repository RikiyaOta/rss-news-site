# Task 13 Brief: GitHub Actions ワークフロー定義 & `pinact` によるバージョン固定

**Files:**
- Create:
  - `.github/workflows/ci.yml`
  - `.github/workflows/daily-pipeline.yml`
  - `.github/workflows/deploy.yml`
  - `.github/workflows/e2e.yml`
- Test:
  - `tests/workflows.test.ts`

**Requirements:**
1. **ユーザー要求・セキュリティ要件の厳格遵守:**
   - **`pinact` によるアクションのコミットハッシュ固定:**
     - すべてのサードパーティ GitHub Action（`actions/checkout`, `jdx/mise-action`, `cloudflare/wrangler-action` 等）は、40文字のコミットハッシュ（SHA-1）でバージョン固定すること（例: `actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2`）。
   - **テストカバレッジのPR/ステップサマリー出力:**
     - `ci.yml` において `pnpm test:coverage` を実行し、Vitest のカバレッジ結果を `$GITHUB_STEP_SUMMARY`（GitHub Actions ステップサマリー）に出力する。
   - **毎朝9時 (JST) の E2E テスト定期実行:**
     - `e2e.yml` は `cron: '0 0 * * *'`（UTC 00:00 = JST 09:00）および `workflow_dispatch` で定期実行する。
2. **ワークフロー構成:**
   - **`ci.yml`:**
     - トリガー: `pull_request` (to main), `push` (to main)
     - `actions/checkout`, `jdx/mise-action`, `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test:coverage` (ステップサマリー出力付き)。
   - **`daily-pipeline.yml`:**
     - トリガー: `schedule` (毎日定期実行 cron: `0 21 * * *` = JST 06:00), `workflow_dispatch`
     - 依存インストール後 `pnpm pipeline` を実行（`GEMINI_API_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` 等のシークレット注入）。
   - **`deploy.yml`:**
     - トリガー: `push` (branches: `main`)
     - `pnpm build` および Terraform による R2 / Pages デプロイ（R2 tfstate バックエンド接続）。
   - **`e2e.yml`:**
     - トリガー: `schedule` (cron: `0 0 * * *` = JST 09:00), `workflow_dispatch`
     - Playwright ブラウザのインストールおよび `pnpm test:e2e` 実行。
3. **テスト要件 (`tests/workflows.test.ts`):**
   - すべてのテストケースを **日本語** で記述。
   - 4つのワークフローファイルの存在・YAMLパース検証。
   - すべてのサードパーティアクションが 40桁の SHA ハッシュで固定されていることの検証（`pinact` 準拠チェック）。
   - `ci.yml` のカバレッジ出力設定、`e2e.yml` の毎朝9時（`0 0 * * *`）cron 設定の検証。
   - `pnpm` コマンドが使用されていること（`npm` / `yarn` の不使用）の静的検証。
4. 全テストが通過し、型チェック（`tsc --noEmit`）でエラーがないこと。
5. **コマンド実行ルール:**
   - **パッケージマネージャーには必ず `pnpm` のみを使用し、`npm` や `npx` は絶対に使用しないこと。**
   - コマンドは `BypassSandbox: false`（サンドボックスモード）で実行すること。
