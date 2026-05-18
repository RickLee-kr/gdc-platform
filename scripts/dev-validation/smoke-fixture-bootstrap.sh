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

_smoke_lab_stream_health_flags() {
  if ! docker ps --format '{{.Names}}' | grep -qx 'gdc-platform-postgres'; then
    _smoke_ok "lab stream health flags (skip — gdc-platform-postgres not running)"
    return
  fi
  local lab_count missing_excl expected_fail wrong_expected
  lab_count="$(
    docker exec gdc-platform-postgres psql -U gdc -d gdc -t -A \
      -c "SELECT COUNT(*) FROM streams WHERE name LIKE '[DEV VALIDATION]%';" 2>/dev/null | tr -d '[:space:]'
  )"
  if [[ "${lab_count:-0}" -lt 1 ]]; then
    _smoke_fail "lab stream health flags (no [DEV VALIDATION] streams — API seed pending?)"
    return
  fi
  missing_excl="$(
    docker exec gdc-platform-postgres psql -U gdc -d gdc -t -A \
      -c "SELECT COUNT(*) FROM streams WHERE name LIKE '[DEV VALIDATION]%' AND COALESCE(config_json->>'exclude_from_health_scoring','false') <> 'true';" \
      2>/dev/null | tr -d '[:space:]'
  )"
  expected_fail="$(
    docker exec gdc-platform-postgres psql -U gdc -d gdc -t -A \
      -c "SELECT COUNT(*) FROM streams WHERE name LIKE '[DEV VALIDATION]%' AND COALESCE(config_json->>'validation_expected_failure','false') = 'true';" \
      2>/dev/null | tr -d '[:space:]'
  )"
  wrong_expected="$(
    docker exec gdc-platform-postgres psql -U gdc -d gdc -t -A \
      -c "SELECT COUNT(*) FROM streams WHERE name LIKE '[DEV VALIDATION]%' AND COALESCE(config_json->>'validation_expected_failure','false') = 'true' AND name NOT IN (
        '[DEV VALIDATION] Stream empty-response',
        '[DEV VALIDATION] Stream auth-only',
        '[DEV VALIDATION] Stream OAuth2 token-exchange-failure'
      );" 2>/dev/null | tr -d '[:space:]'
  )"
  if [[ "${missing_excl:-1}" -eq 0 && "${expected_fail:-0}" -eq 3 && "${wrong_expected:-1}" -eq 0 ]]; then
    _smoke_ok "lab stream health flags (exclude=all ${lab_count}, expected_failure=3)"
  else
    _smoke_fail "lab stream health flags (streams=${lab_count} missing_exclude=${missing_excl:-?} expected_fail=${expected_fail:-?} wrong_expected=${wrong_expected:-?})"
  fi
}

_smoke_lab_source_expansion_contract() {
  if ! docker ps --format '{{.Names}}' | grep -qx 'gdc-platform-postgres'; then
    _smoke_ok "lab source-expansion fixtures (skip — gdc-platform-postgres not running)"
    return
  fi
  local rows missing
  rows="$(
    docker exec gdc-platform-postgres psql -U gdc -d gdc -t -A -c "
WITH expected(label, source_type) AS (
  VALUES
    ('HTTP_API_POLLING', 'HTTP_API_POLLING'),
    ('DATABASE_QUERY', 'DATABASE_QUERY'),
    ('S3_OBJECT', 'S3_OBJECT_POLLING'),
    ('REMOTE_FILE', 'REMOTE_FILE_POLLING')
),
actual AS (
  SELECT sources.source_type, COUNT(*)::int AS count
  FROM streams
  JOIN sources ON sources.id = streams.source_id
  WHERE streams.name LIKE '[DEV VALIDATION] %'
  GROUP BY sources.source_type
)
SELECT expected.label || '=' || COALESCE(actual.count, 0)::text
FROM expected
LEFT JOIN actual ON actual.source_type = expected.source_type
ORDER BY expected.label;
" 2>/dev/null | tr '\n' ' '
  )"
  missing="$(printf '%s\n' "$rows" | tr ' ' '\n' | awk -F= '$2 == "0" {print $1}' | tr '\n' ' ')"
  if [[ -z "${missing// }" ]]; then
    _smoke_ok "lab source-expansion fixtures ($rows)"
  else
    _smoke_fail "lab source-expansion fixtures missing: $missing (counts: $rows)"
  fi
}

_smoke_operational_summary_endpoint() {
  if ! docker ps --format '{{.Names}}' | grep -qx 'gdc-platform-api'; then
    _smoke_ok "operational-summary API (skip — gdc-platform-api not running)"
    return
  fi
  local body code
  local http_code body
  http_code="$(
    docker exec gdc-platform-api wget -qS -O /tmp/gdc-op-summary.json \
      'http://127.0.0.1:8000/api/v1/runtime/validation/operational-summary?scoring_mode=current_runtime&window=1h' \
      2>&1 | awk '/HTTP\// {print $2}' | tail -1
  )"
  body="$(docker exec gdc-platform-api cat /tmp/gdc-op-summary.json 2>/dev/null || true)"
  if [[ "${http_code:-}" != "200" ]]; then
    _smoke_fail "operational-summary API (HTTP ${http_code:-unknown}, expected 200 — set REQUIRE_AUTH=false in dev-validation overlay?)"
    return
  fi
  if [[ -z "$body" ]]; then
    _smoke_fail "operational-summary API (empty body)"
    return
  fi
  if printf '%s' "$body" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("open_auth_failure_alerts") is not None' 2>/dev/null; then
    _smoke_ok "operational-summary API (alert fields present)"
  else
    _smoke_fail "operational-summary API (missing alert count fields)"
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
_smoke_lab_stream_health_flags
_smoke_lab_source_expansion_contract
_smoke_operational_summary_endpoint

echo "=== Smoke summary: $PASS passed, $FAIL failed ==="
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
