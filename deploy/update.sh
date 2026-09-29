#!/usr/bin/env bash
# Updates an installation made from a git clone: pulls the repository, then the new images,
# and restarts the system (migrations run automatically). Data, .env and certificates are kept.
set -euo pipefail
cd "$(dirname "$0")"

if [ -f VERSION ]; then
  echo "Это установка из архива релиза: обновляйте её новым архивом и ./install.sh" >&2
  exit 1
fi

if [ -n "$(docker compose ps --status running -q db 2>/dev/null)" ]; then
  ./backup.sh
else
  echo "База не запущена: бэкап перед обновлением пропущен" >&2
fi
git -C .. pull --ff-only
exec ./install.sh
