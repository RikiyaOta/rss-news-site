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

locals {
  matched_zones = try(data.cloudflare_zones.primary.result, [])
  zone_id       = length(local.matched_zones) > 0 ? local.matched_zones[0].id : var.cloudflare_zone_id
}

resource "cloudflare_d1_database" "news_db" {
  account_id = var.cloudflare_account_id
  name       = var.d1_database_name

  read_replication = {
    mode = "disabled"
  }
}

resource "cloudflare_workers_script" "site" {
  account_id          = var.cloudflare_account_id
  script_name         = var.worker_name
  main_module         = "index.js"
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
  count      = local.zone_id != null ? 1 : 0
  account_id = var.cloudflare_account_id
  hostname   = var.custom_domain
  service    = cloudflare_workers_script.site.script_name
  zone_id    = local.zone_id
}
