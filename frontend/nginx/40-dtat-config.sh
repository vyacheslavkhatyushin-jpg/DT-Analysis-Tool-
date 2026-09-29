#!/bin/sh
# Picks the nginx site configuration: HTTPS when a certificate is mounted, plain HTTP otherwise.
set -eu

if [ -f /etc/nginx/certs/server.crt ] && [ -f /etc/nginx/certs/server.key ]; then
  mode=https
else
  mode=http
  echo "dtat: /etc/nginx/certs/server.{crt,key} not found, serving plain HTTP" >&2
fi

export DTAT_HTTPS_PORT="${DTAT_HTTPS_PORT:-443}"
# shellcheck disable=SC2016 # envsubst takes the list of variables literally
envsubst '${DTAT_HTTPS_PORT}' < "/etc/nginx/dtat/$mode.conf" > /etc/nginx/conf.d/default.conf
echo "dtat: nginx configured for $mode"
