# ==============================================================================
# Architecture Design Note: Terraform & Wrangler 責務分離方針 (Cloudflare Best Practice)
# ==============================================================================
# - Terraform の責務:
#   - 永続インフラ・長寿命リソース（Cloudflare D1 データベース `rss-news-db`）の作成とライフサイクル管理。
# - Wrangler の責務 (`wrangler.jsonc`):
#   - アプリケーションコード（Hono サーバー）のバンドル & デプロイ
#   - React SPA 静的アセット (`dist/`) の差分アップロード
#   - D1 / Workers AI バインディングの接続
#   - カスタムドメイン (`rss-news.rikiyaota.kyoto`) のルーティング設定
#
# ※ Worker 本体（cloudflare_workers_script）を Terraform で管理しようとすると、
#   ダミースクリプトによる初期化ハックや ignore_changes が必要となり、wrangler deploy との
#   間で二重管理・設定競合（スキーマ不整合・パーミッションエラー）が発生するため、
#   公式推奨に従い Worker のアプリケーション層は wrangler.jsonc に一本化しています。
# ==============================================================================

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

resource "cloudflare_d1_database" "news_db" {
  account_id = var.cloudflare_account_id
  name       = var.d1_database_name

  read_replication = {
    mode = "disabled"
  }
}
