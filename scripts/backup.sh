#!/usr/bin/env bash
# Weekly backup of the production database to backups/ (kept out of git).
# Cloudflare D1 also keeps point-in-time history ("Time Travel") – see docs/PLATFORM-GUIDE.md.
# Usage: ./scripts/backup.sh            (production)
#        ./scripts/backup.sh staging    (staging)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
if [ "${1:-}" = "staging" ]; then
  npx wrangler d1 export khatakhat-staging --env staging --remote --output "backups/khatakhat-staging-$(date +%F).sql"
else
  npx wrangler d1 export khatakhat --remote --output "backups/khatakhat-$(date +%F).sql"
fi
ls -lh backups | tail -3
