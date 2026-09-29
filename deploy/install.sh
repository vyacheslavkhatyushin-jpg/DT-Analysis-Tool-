#!/usr/bin/env bash
# Installs or upgrades DT Analysis Tool. Two ways to run it (see docs/DEPLOYMENT.md):
#  - from an unpacked release bundle (has a VERSION file and images/): no internet needed;
#  - from the deploy/ folder of a git clone: images are pulled from the registry in online.env.
# Needs: Docker Engine with the compose plugin, openssl.
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n== %s\n' "$*"; }
random() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
# set_env KEY VALUE: replace or append a variable in .env
set_env() {
  if grep -q "^$1=" .env; then
    sed -i "s|^$1=.*|$1=$2|" .env
  else
    echo "$1=$2" >> .env
  fi
}

command -v docker >/dev/null || { echo "Docker не установлен" >&2; exit 1; }
docker compose version >/dev/null || { echo "Нужен плагин docker compose" >&2; exit 1; }
command -v openssl >/dev/null || { echo "Нужен openssl" >&2; exit 1; }

if [ -f VERSION ]; then
  mode=bundle
  VERSION="$(cat VERSION)"
else
  mode=online
  [ -f online.env ] || { echo "Нет ни VERSION (архив релиза), ни online.env (git-клон)" >&2; exit 1; }
fi

if [ ! -f .env ] && docker volume inspect dtat_db-data >/dev/null 2>&1; then
  echo "Найдена база данных прежней установки, но в этой папке нет .env." >&2
  echo "Запустите install.sh из папки прежней установки или перенесите сюда её .env и certs/." >&2
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

if [ "$mode" = bundle ]; then
  say "Загрузка образов $VERSION из архива"
  shopt -s nullglob
  archives=(images/*.tar.gz)
  [ ${#archives[@]} -gt 0 ] || echo "В images/ нет архивов: использую уже загруженные образы"
  for archive in "${archives[@]}"; do
    docker load -i "$archive"
  done
  set_env DTAT_VERSION "$VERSION"
  set_env DTAT_IMAGE_PREFIX ""
else
  # Registry settings come from the repository and follow it on every update.
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^[A-Z_]+$ ]] && set_env "$key" "$value"
  done < online.env
  say "Загрузка образов из $(grep '^DTAT_IMAGE_PREFIX=' .env | cut -d= -f2)"
  if ! docker compose pull; then
    echo >&2
    echo "Не удалось скачать образы. Если реестр требует входа:" >&2
    echo "  docker login ghcr.io -u <пользователь GitHub>   (пароль: токен с правом read:packages)" >&2
    echo "Если ВМ выходит в интернет через прокси, Docker должен знать о нём (docs/DEPLOYMENT.md)." >&2
    exit 1
  fi
fi

mkdir -p data/tiles certs backups
if [ ! -f certs/server.crt ] || [ ! -f certs/server.key ]; then
  say "Сертификата нет: выпускаю самоподписанный (замените на сертификат ИБ)"
  ./make-cert.sh "$(hostname -f 2>/dev/null || hostname)"
fi

say "Запуск"
docker compose up -d --remove-orphans

say "Удаление неиспользуемых образов"
if [ "$mode" = bundle ]; then
  for repo in dtat-api dtat-web; do
    docker images "$repo" --format '{{.Repository}}:{{.Tag}}' | grep -v ":$VERSION\$" | xargs -r docker rmi || true
  done
fi
docker image prune -f >/dev/null

https_port="$(grep -E '^DTAT_HTTPS_PORT=' .env | cut -d= -f2)"
https_port="${https_port:-443}"
port_suffix=""
[ "$https_port" != "443" ] && port_suffix=":$https_port"

say "Проверка"
health=""
for _ in $(seq 1 30); do
  health="$(curl -sk --noproxy '*' "https://localhost:$https_port/api/health" || true)"
  [[ "$health" == *'"ok"'* ]] && break
  sleep 2
done
docker compose ps
echo
if [[ "$health" == *'"ok"'* ]]; then
  echo "Система работает: $health"
  echo "Откройте https://$(hostname -f 2>/dev/null || hostname)$port_suffix/"
else
  echo "Система не ответила за минуту. Журналы: docker compose logs --tail 50 api web migrate" >&2
  exit 1
fi
