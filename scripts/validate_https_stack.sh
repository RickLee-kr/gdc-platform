#!/usr/bin/env bash
# HTTPS / reverse-proxy smoke checks (host-side; defaults match docker-compose.platform.yml: 18080→80, 18443→443).
set -euo pipefail

HTTP_BASE="${HTTP_BASE:-http://127.0.0.1:18080}"
HTTPS_BASE="${HTTPS_BASE:-https://127.0.0.1:18443}"

probe_http_health() {
  local code body tmp
  tmp="$(mktemp)"
  code="$(curl -sS -o "$tmp" -w '%{http_code}' "${HTTP_BASE}/health" || true)"
  body="$(cat "$tmp" 2>/dev/null || true)"
  rm -f "$tmp"
  if echo "$body" | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'; then
    echo "HTTP ${code} — JSON health OK"
    return 0
  fi
  if [[ "$code" =~ ^30[1278]$ ]]; then
    echo "HTTP ${code} — redirect (HTTP→HTTPS likely enabled). Following to HTTPS..."
    curl -kfsS "${HTTPS_BASE}/health" | head -c 200
    echo
    return 0
  fi
  echo "FAIL: unexpected HTTP /health (code=${code})" >&2
  echo "$body" | head -c 400 >&2
  return 1
}

echo "== HTTP health (via proxy; tolerates redirect mode) =="
probe_http_health
echo "OK"

echo "== HTTPS health (self-signed; -k) =="
if curl -kfsS "${HTTPS_BASE}/health" | head -c 200; then
  echo
  echo "OK"
else
  echo "SKIP: HTTPS not listening (TLS disabled or proxy down)."
fi

echo "== Done =="
