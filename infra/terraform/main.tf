provider "cloudflare" {
  # Reads CLOUDFLARE_API_TOKEN from the environment.
}

data "cloudflare_zone" "this" {
  filter = {
    name = var.zone_name
  }
}

data "cloudflare_zero_trust_organization" "this" {
  account_id = var.account_id
}

# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

resource "cloudflare_d1_database" "main" {
  account_id = var.account_id
  name       = "trailblazer"

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_bucket" "uploads" {
  account_id = var.account_id
  name       = "trailblazer-uploads"
  location   = var.r2_location

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_queue" "jobs" {
  account_id = var.account_id
  queue_name = "trailblazer-jobs"
}

resource "cloudflare_queue" "jobs_dlq" {
  account_id = var.account_id
  queue_name = "trailblazer-jobs-dlq"
}

# The queue consumer, cron triggers and bindings are declared in wrangler.toml and
# applied by `wrangler deploy`, because they ship together with the Worker code.

# ---------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------

resource "cloudflare_workers_custom_domain" "app" {
  count = var.attach_custom_domain ? 1 : 0

  account_id = var.account_id
  zone_id    = data.cloudflare_zone.this.zone_id
  hostname   = var.hostname
  service    = var.worker_name
}

# ---------------------------------------------------------------------------
# Cloudflare Access: only the listed emails can reach the app
# ---------------------------------------------------------------------------

resource "cloudflare_zero_trust_access_policy" "owner" {
  account_id       = var.account_id
  name             = "trailblazer-owner"
  decision         = "allow"
  session_duration = var.session_duration
  include          = [for e in var.allowed_emails : { email = { email = e } }]
}

resource "cloudflare_zero_trust_access_application" "app" {
  account_id       = var.account_id
  name             = "Trailblazer"
  type             = "self_hosted"
  session_duration = var.session_duration

  destinations = [{ type = "public", uri = var.hostname }]

  policies = [{ id = cloudflare_zero_trust_access_policy.owner.id, precedence = 1 }]

  auto_redirect_to_identity = false
  app_launcher_visible      = false
}

# Strava calls this webhook server-to-server, so it can't log in through Access.
# The Worker authenticates it separately (verify token + subscription ID check).
resource "cloudflare_zero_trust_access_policy" "public_bypass" {
  account_id = var.account_id
  name       = "trailblazer-webhook-bypass"
  decision   = "bypass"
  include    = [{ everyone = {} }]
}

resource "cloudflare_zero_trust_access_application" "strava_webhook" {
  account_id = var.account_id
  name       = "Trailblazer – Strava webhook"
  type       = "self_hosted"

  destinations = [{ type = "public", uri = "${var.hostname}/api/strava/webhook" }]

  policies = [{ id = cloudflare_zero_trust_access_policy.public_bypass.id, precedence = 1 }]

  app_launcher_visible = false
}
