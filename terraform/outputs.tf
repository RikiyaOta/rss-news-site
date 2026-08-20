output "d1_database_id" {
  description = "ID of the Cloudflare D1 database"
  value       = cloudflare_d1_database.news_db.id
}

output "d1_database_name" {
  description = "Name of the Cloudflare D1 database"
  value       = cloudflare_d1_database.news_db.name
}

output "worker_name" {
  description = "Name of the Cloudflare Worker"
  value       = var.worker_name
}

output "custom_domain" {
  description = "Custom domain for the Cloudflare Worker"
  value       = var.custom_domain
}
