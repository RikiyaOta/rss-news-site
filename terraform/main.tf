terraform {
  required_version = ">= 1.5.0"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

resource "cloudflare_r2_bucket" "data" {
  account_id = var.cloudflare_account_id
  name       = var.r2_data_bucket_name
  location   = "apac"
}

resource "cloudflare_r2_bucket_cors" "data_cors" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.data.name

  rule {
    allowed {
      origins = var.r2_cors_allowed_origins
      methods = ["GET", "HEAD"]
      headers = ["*"]
    }
    max_age_seconds = 86400
  }
}

resource "cloudflare_pages_project" "site" {
  account_id        = var.cloudflare_account_id
  name              = var.pages_project_name
  production_branch = var.production_branch

  build_config {
    build_command   = "pnpm build"
    destination_dir = "dist"
  }

  deployment_configs {
    production {
      environment_variables = {
        NODE_VERSION = "24"
      }
    }
    preview {
      environment_variables = {
        NODE_VERSION = "24"
      }
    }
  }
}
