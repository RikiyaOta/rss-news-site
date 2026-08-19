# Task 12 Brief: Terraform による Cloudflare R2 & Pages インフラ定義

**Files:**
- Create:
  - `terraform/backend.tf`
  - `terraform/main.tf`
  - `terraform/variables.tf`
  - `terraform/outputs.tf`
- Test:
  - `tests/terraform.test.ts`

**Requirements:**
1. `terraform/backend.tf`:
   - 仕様書の制約に従い、S3互換バックエンドとしてユーザー作成済み R2 バケット `rss-news-site-tfstate` を設定。
   - `bucket = "rss-news-site-tfstate"`, `key = "rss-news-site/terraform.tfstate"`, `region = "auto"`, `skip_credentials_validation = true`, `skip_region_validation = true`, `skip_requesting_account_id = true`, `skip_s3_checksum = true`, `use_path_style = true`。
2. `terraform/main.tf`:
   - `terraform` ブロック（required_version >= 1.5.0, required_providers cloudflare >= 4.0）
   - Cloudflare R2 バケットリソース (`cloudflare_r2_bucket.data`): `name = var.r2_data_bucket_name` (`rss-news-site-data`), `location = "apac"` (または auto)
   - Cloudflare Pages プロジェクトリソース (`cloudflare_pages_project.site`):
     - `name = var.pages_project_name` (`rss-news-site`)
     - `production_branch = var.production_branch` (`main`)
     - `build_config`: `build_command = "pnpm build"`, `destination_dir = "dist"`
     - `environment_variables`: `NODE_VERSION = "24"`
3. `terraform/variables.tf`:
   - `cloudflare_account_id`: string (必須)
   - `r2_data_bucket_name`: string (デフォルト: `"rss-news-site-data"`)
   - `pages_project_name`: string (デフォルト: `"rss-news-site"`)
   - `production_branch`: string (デフォルト: `"main"`)
4. `terraform/outputs.tf`:
   - `r2_bucket_name`, `pages_project_name`, `pages_subdomain`
5. `tests/terraform.test.ts`:
   - すべてのテストケースを **日本語** で記述。
   - Terraform ファイルの構文・リソース定義・バックエンド設定（`rss-news-site-tfstate`）・変数・出力の静的検証テスト。
6. 全テストが通過し、型チェック（`tsc --noEmit`）でエラーがないこと。
7. **コマンド実行ルール:**
   - **パッケージマネージャーには必ず `pnpm` のみを使用し、`npm` や `npx` は絶対に使用しないこと。**
   - コマンドは `BypassSandbox: false`（サンドボックスモード）で実行すること。
