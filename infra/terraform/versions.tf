terraform {
  required_version = ">= 1.6"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }

  # Local state for now. Move to a remote backend (e.g. R2 via the s3 backend) later.
  backend "local" {
    path = "terraform.tfstate"
  }
}
