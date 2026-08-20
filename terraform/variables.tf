variable "cloudflare_account_id" {
  description = "Cloudflare Account ID"
  type        = string
}

variable "cloudflare_api_token" {
  description = "Cloudflare API Token"
  type        = string
  sensitive   = true
  default     = null
}

variable "d1_database_name" {
  description = "Cloudflare D1 database name"
  type        = string
  default     = "rss-news-db"
}

variable "pages_project_name" {
  description = "Name of the Cloudflare Pages project"
  type        = string
  default     = "rss-news-site"
}

variable "production_branch" {
  description = "Production branch for Cloudflare Pages"
  type        = string
  default     = "main"
}

variable "custom_domain" {
  description = "Custom domain for Cloudflare Pages"
  type        = string
  default     = "rss-news.rikiyaota.kyoto"
}
