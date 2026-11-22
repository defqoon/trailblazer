variable "account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "zone_name" {
  description = "Zone (domain) that hosts the app, e.g. example.com"
  type        = string
}

variable "hostname" {
  description = "Full hostname for the app, e.g. trail.example.com"
  type        = string
}

variable "allowed_emails" {
  description = "Emails allowed through Cloudflare Access"
  type        = list(string)
}

variable "worker_name" {
  description = "Worker script name (must match `name` in wrangler.toml)"
  type        = string
  default     = "trailblazer"
}

variable "attach_custom_domain" {
  description = "Attach the hostname to the Worker. Requires the Worker to exist, so set true after the first `wrangler deploy`."
  type        = bool
  default     = false
}

variable "r2_location" {
  description = "R2 location hint (wnam, enam, weur, eeur, apac, oc)"
  type        = string
  default     = "weur"
}

variable "session_duration" {
  description = "Access session length"
  type        = string
  default     = "720h"
}
