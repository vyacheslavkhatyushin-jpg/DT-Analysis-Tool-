#!/usr/bin/env bash
# Issues a self-signed certificate into certs/ for the given host name (default: this host).
# For production replace certs/server.crt and certs/server.key with ones issued by your CA,
# then run: docker compose restart web
set -euo pipefail
cd "$(dirname "$0")"

host="${1:-$(hostname -f 2>/dev/null || hostname)}"
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout certs/server.key -out certs/server.crt \
  -subj "/CN=$host" \
  -addext "subjectAltName=DNS:$host,DNS:localhost,IP:127.0.0.1"
chmod 600 certs/server.key
echo "Сертификат для $host: certs/server.crt"
