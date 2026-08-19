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

variable "r2_cors_allowed_origins" {
  description = "Allowed origins for Cloudflare R2 CORS"
  type        = list(string)
  default     = ["https://rss-news.rikiyaota.kyoto", "http://localhost:5173"]
}

variable "custom_domain" {
  description = "Custom domain for Cloudflare Pages"
  type        = string
  default     = "rss-news.rikiyaota.kyoto"
}

variable "cloudflare_zone_name" {
  description = "Cloudflare Zone Name"
  type        = string
  default     = "rikiyaota.kyoto"
}
