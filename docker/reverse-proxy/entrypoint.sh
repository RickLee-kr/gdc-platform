#!/bin/sh
set -eu
UP_HOST="${GDC_UPSTREAM_API_HOST:-api}"
UP_PORT="${GDC_UPSTREAM_API_PORT:-8000}"
UI_HOST="${GDC_UPSTREAM_UI_HOST:-frontend}"
UI_PORT="${GDC_UPSTREAM_UI_PORT:-80}"
TLS_CERT="/var/gdc/tls/server.crt"
TLS_KEY="/var/gdc/tls/server.key"
# Docker may copy the stock image default.conf into an empty named volume, so "file exists"
# skips bootstrap and leaves static localhost content — fix by detecting that stub.
_need_bootstrap=0
if [ ! -f /etc/nginx/conf.d/default.conf ]; then
  _need_bootstrap=1
elif grep -q 'root[[:space:]]*/usr/share/nginx/html' /etc/nginx/conf.d/default.conf 2>/dev/null; then
  _need_bootstrap=1
elif ! grep -q 'gdc_ui_upstream' /etc/nginx/conf.d/default.conf 2>/dev/null; then
  _need_bootstrap=1
fi
if [ "$_need_bootstrap" -eq 1 ]; then
  sed -e "s|__GDC_API_UPSTREAM__|http://${UP_HOST}:${UP_PORT}|g" \
      -e "s|__GDC_UI_UPSTREAM__|http://${UI_HOST}:${UI_PORT}|g" \
      /docker/default.conf.bootstrap > /etc/nginx/conf.d/default.conf
fi

# HTTPS is controlled by the rendered nginx config, not by the published 443 port.
# Only prepare certificate material when the persisted config actually has a TLS listener.
if grep -Eq 'listen[[:space:]]+443[[:space:]]+ssl' /etc/nginx/conf.d/default.conf 2>/dev/null; then
  if [ ! -s "$TLS_CERT" ] || [ ! -s "$TLS_KEY" ]; then
    mkdir -p /var/gdc/tls
    openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
      -keyout "$TLS_KEY" \
      -out "$TLS_CERT" \
      -subj "/CN=localhost" \
      -addext "subjectAltName=DNS:localhost,DNS:gdc-platform-reverse-proxy,DNS:reverse-proxy,IP:127.0.0.1" >/dev/null 2>&1
  fi
  # PEMs are often written by the API container as root with a restrictive umask (e.g. key mode 0600).
  # Nginx workers run as user `nginx` and must read cert + key for TLS.
  chmod a+r "$TLS_CERT" "$TLS_KEY" 2>/dev/null || true
fi
python3 /reload_server.py &
exec nginx -g "daemon off;"
