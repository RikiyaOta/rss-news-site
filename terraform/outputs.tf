output "r2_bucket_name" {
  description = "Cloudflare R2 data bucket name"
  value       = cloudflare_r2_bucket.data.name
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

output "r2_public_url" {
  description = "Public URL for the R2 data bucket"
  value       = "https://${cloudflare_r2_managed_domain.data.domain}"
}
