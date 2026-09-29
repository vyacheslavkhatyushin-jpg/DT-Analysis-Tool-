#!/usr/bin/env bash
# Builds a self-contained release bundle for offline installation (run where Docker Hub is reachable):
#   deploy/scripts/make-release.sh [version] [--no-db-image]
# Result: release/dtat-<version>.tar.gz with images, compose file and install scripts.
# --no-db-image skips the database image (~1 GB) for upgrades where it has not changed.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
version="${1:-$(git -C "$root" describe --tags --always --dirty)}"
with_db=true
[ "${2:-}" = "--no-db-image" ] && with_db=false
DB_IMAGE="timescale/timescaledb-ha:pg16"

out="$root/release/dtat-$version"
rm -rf "$out"
mkdir -p "$out/images"

echo "== Сборка образов $version"
DTAT_VERSION="$version" POSTGRES_PASSWORD=x DTAT_SECRET_KEY=x \
  docker compose -f "$root/deploy/docker-compose.yml" -f "$root/deploy/docker-compose.build.yml" build
docker save "dtat-api:$version" "dtat-web:$version" | gzip > "$out/images/dtat-app.tar.gz"
if $with_db; then
  docker pull "$DB_IMAGE"
  docker save "$DB_IMAGE" | gzip > "$out/images/db.tar.gz"
fi

echo "== Файлы установки"
cp "$root/deploy/docker-compose.yml" "$root/deploy/.env.example" "$out/"
cp "$root"/deploy/scripts/{install,make-cert,backup,restore}.sh "$out/"
cp "$root/docs/DEPLOYMENT.md" "$out/README.md"
echo "$version" > "$out/VERSION"
chmod +x "$out"/*.sh

tar -C "$root/release" -czf "$root/release/dtat-$version.tar.gz" "dtat-$version"
(cd "$root/release" && sha256sum "dtat-$version.tar.gz" > "dtat-$version.tar.gz.sha256")
rm -rf "$out"
echo "== Готово: release/dtat-$version.tar.gz"
