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
