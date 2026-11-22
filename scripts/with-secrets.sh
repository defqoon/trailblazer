#!/usr/bin/env bash
# Run a command with the private Cloudflare/Google/Strava secrets loaded into the environment.
# Usage: scripts/with-secrets.sh terraform -chdir=infra/terraform plan
set -euo pipefail
SECRETS_FILE="${TRAILBLAZER_SECRETS:-$HOME/.config/trailblazer/secrets.env}"
if [[ ! -f "$SECRETS_FILE" ]]; then
  echo "Missing $SECRETS_FILE (see README › Infrastructure)" >&2
  exit 1
fi
if [[ "$(stat -c %a "$SECRETS_FILE" 2>/dev/null || stat -f %Lp "$SECRETS_FILE")" != "600" ]]; then
  echo "Warning: $SECRETS_FILE should be chmod 600" >&2
fi
set -a
# shellcheck disable=SC1090
source "$SECRETS_FILE"
set +a
# Terraform reads the account ID from the same variable Wrangler uses.
export TF_VAR_account_id="${TF_VAR_account_id:-${CLOUDFLARE_ACCOUNT_ID:-}}"
exec "$@"
