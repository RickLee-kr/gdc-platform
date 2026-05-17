#!/usr/bin/env bash
# Post-bootstrap PASS/FAIL checks (Docker only; no host mysql/curl required).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/dev-validation/lib/fixture-compose.sh
source "$ROOT/scripts/dev-validation/lib/fixture-compose.sh"
# shellcheck source=scripts/dev-validation/lib/db-exec.sh
source "$ROOT/scripts/dev-validation/lib/db-exec.sh"

PASS=0
FAIL=0

_smoke_ok() {
  echo "PASS  $*"
  PASS=$((PASS + 1))
}

_smoke_fail() {
  echo "FAIL  $*"
  FAIL=$((FAIL + 1))
}

_smoke_dns_from_api() {
  local host="$1"
  if ! docker ps --format '{{.Names}}' | grep -qx 'gdc-platform-api'; then
    _smoke_ok "DNS $host (skip — gdc-platform-api not running)"
    return
  fi
  if docker exec gdc-platform-api getent hosts "$host" >/dev/null 2>&1; then
    _smoke_ok "DNS $host from gdc-platform-api"
  else
    _smoke_fail "DNS $host from gdc-platform-api"
  fi
}

_smoke_minio_object() {
  if ! _fixture_service_running minio-test; then
    _smoke_fail "MinIO object (minio-test not running)"
    return
  fi
  if docker run --rm --network "$DEV_VALIDATION_DOCKER_NETWORK" \
    -e MINIO_ENDPOINT=http://gdc-minio-test:9000 \
    -e MINIO_ACCESS_KEY=gdcminioaccess \
    -e MINIO_SECRET_KEY=gdcminioaccesssecret12 \
    -e MINIO_BUCKET=gdc-test-logs \
    -v "$ROOT/scripts/dev-validation/seed_minio_boto.py:/seed.py:ro" \
    python:3.12-slim \
    bash -ec 'pip install -q --no-cache-dir boto3 >/dev/null && python - <<"PY"
import os, boto3
from botocore.client import Config
c=boto3.client("s3",endpoint_url=os.environ["MINIO_ENDPOINT"],aws_access_key_id=os.environ["MINIO_ACCESS_KEY"],aws_secret_access_key=os.environ["MINIO_SECRET_KEY"],config=Config(signature_version="s3v4",s3={"addressing_style":"path"}))
c.head_object(Bucket=os.environ["MINIO_BUCKET"],Key="security/lab-sample.ndjson")
print("ok")
PY
' >/dev/null 2>&1; then
    _smoke_ok "MinIO security/lab-sample.ndjson"
  else
    _smoke_fail "MinIO security/lab-sample.ndjson"
  fi
}

_smoke_wiremock_mappings() {
  if ! _fixture_service_running wiremock-test; then
    _smoke_fail "WireMock mappings (wiremock-test not running)"
    return
  fi
  local count
  count="$(_fixture_compose exec -T wiremock-test sh -ec \
    'wget -qO- http://127.0.0.1:8080/__admin/mappings 2>/dev/null | wc -c' 2>/dev/null | tr -d '[:space:]' || echo 0)"
  if [[ "${count:-0}" -gt 50 ]]; then
    _smoke_ok "WireMock admin mappings payload (${count} bytes)"
  else
    _smoke_fail "WireMock admin mappings payload (${count:-0} bytes)"
  fi
}

_smoke_remote_file() {
  if _fixture_service_running sftp-test; then
    if _fixture_compose exec -T sftp-test test -f /home/gdc/upload/lab-001.ndjson 2>/dev/null; then
      _smoke_ok "SFTP lab-001.ndjson"
    else
      _smoke_fail "SFTP lab-001.ndjson"
    fi
  else
    _smoke_fail "SFTP lab-001.ndjson (sftp-test not running)"
  fi
  if _fixture_service_running ssh-scp-test; then
    if _fixture_compose exec -T ssh-scp-test test -f /home/gdc2/upload/lab-scp-001.json 2>/dev/null; then
      _smoke_ok "SCP lab-scp-001.json"
    else
      _smoke_fail "SCP lab-scp-001.json"
    fi
  else
    _smoke_ok "SCP lab-scp-001.json (skip — ssh-scp-test not running)"
  fi
}

echo "=== Dev-validation fixture smoke checks ==="

for h in \
  gdc-wiremock-test \
  gdc-postgres-query-test \
  gdc-mysql-query-test \
  gdc-mariadb-query-test \
  gdc-minio-test \
  gdc-sftp-test \
  gdc-ssh-scp-test \
  gdc-webhook-receiver-test \
  gdc-syslog-test; do
  _smoke_dns_from_api "$h"
done

if _fixture_service_running postgres-query-test; then
  n="$(_fixture_compose exec -T postgres-query-test psql -U gdc_fixture -d gdc_query_fixture -t -A \
    -c 'SELECT COUNT(*) FROM security_events;' 2>/dev/null | tr -d '[:space:]')"
  if [[ "${n:-0}" -ge 3 ]]; then
    _smoke_ok "PostgreSQL security_events count=$n"
  else
    _smoke_fail "PostgreSQL security_events count=${n:-0}"
  fi
else
  _smoke_fail "PostgreSQL security_events (postgres-query-test not running)"
fi

if _fixture_service_running mysql-query-test; then
  n="$(_sql_tcp_query mysql-query-test gdc_fixture gdc_fixture_pw gdc_query_fixture \
    'SELECT COUNT(*) FROM security_events;' 2>/dev/null | tail -1 | tr -d '[:space:]')"
  if [[ "${n:-0}" -ge 3 ]]; then
    _smoke_ok "MySQL security_events count=$n"
  else
    _smoke_fail "MySQL security_events count=${n:-0}"
  fi
else
  _smoke_fail "MySQL security_events (mysql-query-test not running)"
fi

if _fixture_service_running mariadb-query-test; then
  n="$(_sql_tcp_query mariadb-query-test gdc_fixture gdc_fixture_pw gdc_query_fixture \
    'SELECT COUNT(*) FROM security_events;' 2>/dev/null | tail -1 | tr -d '[:space:]')"
  if [[ "${n:-0}" -ge 3 ]]; then
    _smoke_ok "MariaDB security_events count=$n"
  else
    _smoke_fail "MariaDB security_events count=${n:-0}"
  fi
else
  _smoke_fail "MariaDB security_events (mariadb-query-test not running)"
fi

_smoke_minio_object
_smoke_remote_file
_smoke_wiremock_mappings

echo "=== Smoke summary: $PASS passed, $FAIL failed ==="
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
