#!/usr/bin/env bash
# Installs or upgrades DT Analysis Tool on the target VM from a release bundle.
# Run from the unpacked bundle directory: ./install.sh
# Needs: Docker Engine with the compose plugin, openssl. No internet access required.
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n== %s\n' "$*"; }
random() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "$1"; }

command -v docker >/dev/null || { echo "Docker не установлен" >&2; exit 1; }
docker compose version >/dev/null || { echo "Нужен плагин docker compose" >&2; exit 1; }
command -v openssl >/dev/null || { echo "Нужен openssl" >&2; exit 1; }

VERSION="$(cat VERSION)"

say "Загрузка образов $VERSION"
shopt -s nullglob
archives=(images/*.tar.gz)
[ ${#archives[@]} -gt 0 ] || echo "В images/ нет архивов: использую уже загруженные образы"
for archive in "${archives[@]}"; do
  docker load -i "$archive"
done

if [ ! -f .env ] && docker volume inspect dtat_db-data >/dev/null 2>&1; then
  echo "Найдена база данных прежней установки, но в этой папке нет .env." >&2
  echo "Распакуйте релиз в папку прежней установки (там .env с паролем базы) и запустите install.sh оттуда." >&2
  exit 1
fi

if [ ! -f .env ]; then
  say "Первая установка: создаю .env со случайными секретами"
  admin_password="$(random 16)"
  sed -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(random 32)/" \
      -e "s/^DTAT_SECRET_KEY=.*/DTAT_SECRET_KEY=$(random 64)/" \
      -e "s/^DTAT_INITIAL_ADMIN_PASSWORD=.*/DTAT_INITIAL_ADMIN_PASSWORD=$admin_password/" \
      .env.example > .env
  chmod 600 .env
  echo "Пароль администратора (admin): $admin_password"
  echo "Смените его после первого входа."
fi
sed -i "s/^DTAT_VERSION=.*/DTAT_VERSION=$VERSION/" .env

mkdir -p data/tiles certs backups
if [ ! -f certs/server.crt ] || [ ! -f certs/server.key ]; then
  say "Сертификата нет: выпускаю самоподписанный (замените на сертификат ИБ)"
  ./make-cert.sh "$(hostname -f 2>/dev/null || hostname)"
fi

say "Запуск"
docker compose up -d --remove-orphans
docker compose ps
https_port="$(grep -E '^DTAT_HTTPS_PORT=' .env | cut -d= -f2)"
port_suffix=""
[ -n "$https_port" ] && [ "$https_port" != "443" ] && port_suffix=":$https_port"
echo
echo "Готово. Откройте https://$(hostname -f 2>/dev/null || hostname)$port_suffix/"
