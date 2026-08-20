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

data "cloudflare_zones" "primary" {
  name = var.zone_name
}

resource "cloudflare_d1_database" "news_db" {
  account_id = var.cloudflare_account_id
  name       = var.d1_database_name
}

resource "cloudflare_workers_script" "site" {
  account_id          = var.cloudflare_account_id
  script_name         = var.worker_name
  content             = "export default { fetch() { return new Response('ok'); } };"
  compatibility_date  = "2026-08-20"
  compatibility_flags = ["nodejs_compat"]

  bindings = [
    {
      name = "DB"
      type = "d1"
      id   = cloudflare_d1_database.news_db.id
    },
    {
      name = "AI"
      type = "ai"
    }
  ]

  lifecycle {
    ignore_changes = [content, assets]
  }
}

resource "cloudflare_workers_custom_domain" "custom" {
  account_id = var.cloudflare_account_id
  hostname   = var.custom_domain
  service    = cloudflare_workers_script.site.script_name
  zone_id    = data.cloudflare_zones.primary.result[0].id
}
