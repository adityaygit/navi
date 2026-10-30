#!/usr/bin/env bash
# Run a command against the LOCAL stack only (tests, local builds). Any hosted
# Supabase project or real-provider settings in the environment are removed,
# and .env.local (npm run env:local) supplies the local values. Prevents tests,
# which delete and recreate users, from ever reaching a real project.
#   scripts/local-only.sh npx vitest run
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env.local ] || { echo "No .env.local: start Supabase (npm run db:start) and run npm run env:local first." >&2; exit 1; }
unset NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_ACCESS_TOKEN \
  NEXT_PUBLIC_SITE_URL ANTHROPIC_API_KEY GEMINI_API_KEY NAVI_ADMIN_EMAILS NAVI_AI_PROVIDER \
  VERCEL_TOKEN TRIGGER_SECRET_KEY CRON_SECRET NEXT_PUBLIC_VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT
set -a
# shellcheck disable=SC1091
. ./.env.local
set +a
exec "$@"
