#!/usr/bin/env bash
# Non-destructive retention API helpers (preview, status, dry-run POST).
# Requires curl and jq. Does not delete data.

set -euo pipefail

GDC_API_BASE="${GDC_API_BASE:-http://127.0.0.1:8000}"
API_PREFIX="${API_PREFIX:-/api/v1}"

retention_preview() {
  local args=(-sS -f)
  if [[ -n "${GDC_API_TOKEN:-}" ]]; then
    args+=(-H "Authorization: Bearer ${GDC_API_TOKEN}")
  fi
  curl "${args[@]}" "${GDC_API_BASE}${API_PREFIX}/retention/preview" | jq .
}

retention_status() {
  local args=(-sS -f)
  if [[ -n "${GDC_API_TOKEN:-}" ]]; then
    args+=(-H "Authorization: Bearer ${GDC_API_TOKEN}")
  fi
  curl "${args[@]}" "${GDC_API_BASE}${API_PREFIX}/retention/status" | jq .
}

retention_dry_run() {
  local args=(-sS -f -X POST -H 'Content-Type: application/json' -d '{"dry_run": true}')
  if [[ -n "${GDC_API_TOKEN:-}" ]]; then
    args+=(-H "Authorization: Bearer ${GDC_API_TOKEN}")
  fi
  curl "${args[@]}" "${GDC_API_BASE}${API_PREFIX}/retention/run" | jq .
}

usage() {
  echo "Usage: $0 {retention_preview|retention_status|retention_dry_run}" >&2
  echo "Env: GDC_API_BASE (default ${GDC_API_BASE}), GDC_API_TOKEN (optional), API_PREFIX (default ${API_PREFIX})" >&2
  exit 1
}

main() {
  case "${1:-}" in
    retention_preview) retention_preview ;;
    retention_status) retention_status ;;
    retention_dry_run) retention_dry_run ;;
    *) usage ;;
  esac
}

main "$@"
