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

variable "r2_data_bucket_name" {
  description = "Name of the Cloudflare R2 bucket for RSS news data"
  type        = string
  default     = "rss-news-site-data"
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
