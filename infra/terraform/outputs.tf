output "d1_database_id" {
  description = "Paste into wrangler.toml → [[d1_databases]].database_id"
  value       = cloudflare_d1_database.main.id
}

output "access_aud" {
  description = "Paste into wrangler.toml → [vars].ACCESS_AUD"
  value       = cloudflare_zero_trust_access_application.app.aud
}

output "access_team_domain" {
  description = "Paste into wrangler.toml → [vars].ACCESS_TEAM_DOMAIN"
  value       = "https://${data.cloudflare_zero_trust_organization.this.auth_domain}"
}

output "app_url" {
  value = "https://${var.hostname}"
}
