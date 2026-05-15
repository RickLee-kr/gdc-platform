#!/bin/sh
set -eu
UP_HOST="${GDC_UPSTREAM_API_HOST:-api}"
UP_PORT="${GDC_UPSTREAM_API_PORT:-8000}"
UI_HOST="${GDC_UPSTREAM_UI_HOST:-frontend}"
UI_PORT="${GDC_UPSTREAM_UI_PORT:-80}"
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
python3 /reload_server.py &
exec nginx -g "daemon off;"
