#!/usr/bin/env bash
# Database backup into backups/ (custom pg_dump format), keeping the latest N copies.
# Schedule it daily, e.g. in cron: 30 2 * * * /opt/dtat/backup.sh >> /opt/dtat/backups/backup.log 2>&1
# Restore: ./restore.sh backups/<file>.dump
set -euo pipefail
cd "$(dirname "$0")"

keep="${KEEP:-14}"
mkdir -p backups
file="backups/dtat-$(date +%Y%m%d-%H%M%S).dump"
# TimescaleDB catalog tables make pg_dump warn about circular foreign keys: expected, see restore.sh.
docker compose exec -T db pg_dump -U dtat -d dtat --format=custom > "$file.partial" \
  2> >(grep -v -E 'circular foreign-key|continuous_agg|might not be able to restore|full dump instead' >&2)
mv "$file.partial" "$file"
echo "$(date -Is) backup: $file ($(du -h "$file" | cut -f1))"

# shellcheck disable=SC2012 # the file names are generated above, ls sorting by time is fine
ls -1t backups/dtat-*.dump | tail -n +"$((keep + 1))" | xargs -r rm --
