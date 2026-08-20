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

variable "zone_name" {
  description = "Apex domain zone name"
  type        = string
  default     = "rikiyaota.kyoto"
}

variable "d1_database_name" {
  description = "Cloudflare D1 database name"
  type        = string
  default     = "rss-news-db"
}

variable "worker_name" {
  description = "Cloudflare Worker service name"
  type        = string
  default     = "rss-news-site"
}

variable "custom_domain" {
  description = "Custom domain for Cloudflare Worker"
  type        = string
  default     = "rss-news.rikiyaota.kyoto"
}
