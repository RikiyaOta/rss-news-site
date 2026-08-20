output "d1_database_id" {
  description = "Cloudflare D1 database ID"
  value       = cloudflare_d1_database.news_db.id
}

output "d1_database_name" {
  description = "Cloudflare D1 database name"
  value       = cloudflare_d1_database.news_db.name
}

output "pages_project_name" {
  description = "Cloudflare Pages project name"
  value       = cloudflare_pages_project.site.name
}

output "pages_subdomain" {
  description = "Cloudflare Pages subdomain URL"
  value       = cloudflare_pages_project.site.subdomain
}

output "custom_domain" {
  description = "Cloudflare Pages custom domain"
  value       = cloudflare_pages_domain.custom.name
}
