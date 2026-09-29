#!/usr/bin/env bash
# Restores the database from a backup made by backup.sh: ./restore.sh backups/dtat-YYYYMMDD-HHMMSS.dump
# The current database is REPLACED. The application is stopped during the restore.
set -euo pipefail
cd "$(dirname "$0")"

dump="${1:?Укажите файл дампа: ./restore.sh backups/<файл>.dump}"
[ -f "$dump" ] || { echo "Файл не найден: $dump" >&2; exit 1; }

read -r -p "Текущая база будет заменена данными из $dump. Продолжить? [y/N] " answer
[ "$answer" = "y" ] || [ "$answer" = "Y" ] || exit 1

psql() { docker compose exec -T db psql -v ON_ERROR_STOP=1 -q -U dtat "$@"; }

docker compose stop api web
psql -d postgres -c "DROP DATABASE IF EXISTS dtat WITH (FORCE)" -c "CREATE DATABASE dtat"
# TimescaleDB requires restore mode around pg_restore.
psql -d dtat -c "CREATE EXTENSION IF NOT EXISTS timescaledb" -c "SELECT timescaledb_pre_restore()" >/dev/null
docker compose exec -T db pg_restore -U dtat -d dtat --no-owner < "$dump"
psql -d dtat -c "SELECT timescaledb_post_restore()" >/dev/null
docker compose up -d
echo "Восстановлено из $dump"
