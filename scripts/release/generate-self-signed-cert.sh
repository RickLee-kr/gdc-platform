#!/usr/bin/env bash
# Generate a local TLS certificate and key for deploy/docker-compose.https.yml mounts.
# Never commit TLS material to git (operator-generated only).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TLS_DIR="${GDC_TLS_OUTPUT_DIR:-$ROOT/deploy/tls}"
CERT_PATH="${TLS_DIR}/server.crt"
KEY_PATH="${TLS_DIR}/server.key"
SUBJECT="${GDC_TLS_CERT_SUBJECT:-/CN=gdc.localhost}"
SAN="${GDC_TLS_SAN:-DNS:gdc.localhost,DNS:localhost,IP:127.0.0.1}"

if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: openssl is required to generate TLS material." >&2
  exit 1
fi

mkdir -p "$TLS_DIR"

if [[ -f "$CERT_PATH" || -f "$KEY_PATH" ]]; then
  if [[ "${GDC_TLS_OVERWRITE:-}" != "1" ]]; then
    echo "Refusing to overwrite existing TLS material without confirmation." >&2
    echo "  Files: $CERT_PATH $KEY_PATH" >&2
    echo "  Re-run with: GDC_TLS_OVERWRITE=1 $0" >&2
    exit 2
  fi
fi

openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
  -keyout "$KEY_PATH" \
  -out "$CERT_PATH" \
  -subj "$SUBJECT" \
  -addext "subjectAltName=$SAN"

chmod 600 "$KEY_PATH" || true
echo "Wrote TLS material to:"
echo "  $CERT_PATH"
echo "  $KEY_PATH"
