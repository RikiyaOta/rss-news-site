output "d1_database_id" {
  description = "Cloudflare D1 database ID"
  value       = cloudflare_d1_database.news_db.id
}

output "d1_database_name" {
  description = "Cloudflare D1 database name"
  value       = cloudflare_d1_database.news_db.name
}
