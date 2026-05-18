#!/usr/bin/env bash
# Canonical one-command development platform bootstrap.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.platform.yml"
ENV_FILE="$ROOT/.env"

app_env="${APP_ENV:-development}"
case "${app_env,,}" in
  production|prod)
    echo "Refusing to start development platform with APP_ENV=$app_env" >&2
    exit 1
    ;;
esac

echo "Development admin contract: username admin, password admin unless GDC_SEED_ADMIN_PASSWORD is explicitly set."

python3 - "$ENV_FILE" <<'PY'
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []


def parse_val(raw: str) -> str:
    val = raw.strip()
    if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
        return val[1:-1]
    return val


def read_key(key: str) -> str | None:
    pat = re.compile(rf"^\s*{re.escape(key)}\s*=\s*(.*)\s*$")
    for line in reversed(lines):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        m = pat.match(line)
        if m:
            return parse_val(m.group(1))
    return None


def upsert_key(key: str, value: str) -> None:
    global lines
    pat = re.compile(rf"^(\s*{re.escape(key)}\s*=).*$")
    replaced = False
    out: list[str] = []
    for line in lines:
        if pat.match(line):
            out.append(f"{key}={value}")
            replaced = True
        else:
            out.append(line)
    if not replaced:
        if out and out[-1].strip():
            out.append("")
        out.append(f"{key}={value}")
    lines = out


def first_value(*keys: str, default: str) -> str:
    for key in keys:
        val = os.environ.get(key) or read_key(key)
        if val is not None and str(val).strip():
            return str(val).strip()
    return default


def validate_port(key: str, value: str) -> int:
    if not value.isdigit():
        raise SystemExit(f"ERROR: {key} must be a numeric TCP port (got {value!r}).")
    port = int(value)
    if port < 1 or port > 65535:
        raise SystemExit(f"ERROR: {key} must be between 1 and 65535 (got {port}).")
    return port


http = validate_port("GDC_HTTP_PORT", first_value("GDC_HTTP_PORT", "GDC_ENTRY_HTTP_PORT", default="18080"))
https = validate_port("GDC_HTTPS_PORT", first_value("GDC_HTTPS_PORT", "GDC_ENTRY_HTTPS_PORT", default="18443"))
api = validate_port("GDC_API_HOST_PORT", first_value("GDC_API_HOST_PORT", default="8000"))
pg = validate_port("GDC_PLATFORM_POSTGRES_HOST_PORT", first_value("GDC_PLATFORM_POSTGRES_HOST_PORT", default="55432"))
if http == https:
    raise SystemExit("ERROR: GDC_HTTP_PORT and GDC_HTTPS_PORT cannot be identical.")
for key, port in (("GDC_HTTP_PORT", http), ("GDC_HTTPS_PORT", https)):
    if port in {api, pg, 5432, 8000, 8080, 8099, 5514}:
        raise SystemExit(f"ERROR: {key} conflicts with a reserved platform service port ({port}).")

changed = False
if read_key("GDC_HTTP_PORT") is None:
    upsert_key("GDC_HTTP_PORT", str(http))
    changed = True
if read_key("GDC_HTTPS_PORT") is None:
    upsert_key("GDC_HTTPS_PORT", str(https))
    changed = True
if read_key("GDC_PUBLIC_HTTPS_PORT") is None:
    upsert_key("GDC_PUBLIC_HTTPS_PORT", str(https))
    changed = True
if changed:
    path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
PY

echo "Building development platform..."
docker compose -f "$COMPOSE_FILE" build

echo "Starting development platform..."
docker compose -f "$COMPOSE_FILE" up -d

echo "Validating development platform readiness..."
"$ROOT/scripts/dev/validate-platform-ready.sh"
