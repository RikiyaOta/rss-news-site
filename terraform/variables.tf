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
