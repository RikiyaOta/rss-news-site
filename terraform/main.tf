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
}

resource "cloudflare_workers_custom_domain" "custom" {
  count      = var.cloudflare_zone_id != null ? 1 : 0
  account_id = var.cloudflare_account_id
  hostname   = var.custom_domain
  service    = var.worker_name
  zone_id    = var.cloudflare_zone_id
}
