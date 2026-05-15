#!/usr/bin/env bash
# Run the full E2E validation matrix across all currently supported sources
# (HTTP_API_POLLING, S3_OBJECT_POLLING, DATABASE_QUERY, REMOTE_FILE_POLLING) and
# destinations (SYSLOG_UDP, SYSLOG_TCP, SYSLOG_TLS, WEBHOOK_POST).
#
# This script wraps existing pytest markers/files rather than duplicating tests:
#   - source_e2e            -> tests/test_source_adapter_e2e.py
#                              (S3 / DATABASE_QUERY / REMOTE_FILE_POLLING -> WEBHOOK_POST
#                               and SYSLOG_UDP / SYSLOG_TCP / SYSLOG_TLS)
#   - e2e_delivery+regression -> tests/test_e2e_syslog_delivery.py
#                              (HTTP_API_POLLING -> SYSLOG_UDP / SYSLOG_TCP)
#   - e2e_smoke             -> tests/test_wiremock_template_e2e.py
#                              (HTTP_API_POLLING -> WEBHOOK_POST)
#   - syslog_tls            -> tests/test_syslog_tls_destination.py
#                              (HTTP_API_POLLING -> SYSLOG_TLS, in-process TLS receiver)
#
# Each test exercises the full StreamRunner pipeline (Source -> Mapping ->
# Enrichment -> Route -> Destination -> Checkpoint -> delivery_logs) and
# verifies the checkpoint-after-delivery rule per specs/002-runtime-pipeline.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="$ROOT/.dev-validation-logs"
mkdir -p "$LOG_DIR"

TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://gdc:gdc@127.0.0.1:55432/gdc_test}"
export TEST_DATABASE_URL
export DATABASE_URL="${DATABASE_URL:-$TEST_DATABASE_URL}"
export WIREMOCK_BASE_URL="${WIREMOCK_BASE_URL:-http://127.0.0.1:28080}"
export SOURCE_E2E_MINIO_ENDPOINT="${SOURCE_E2E_MINIO_ENDPOINT:-http://127.0.0.1:59000}"
export SOURCE_E2E_MINIO_BUCKET="${SOURCE_E2E_MINIO_BUCKET:-gdc-source-e2e}"
export SOURCE_E2E_PG_FIXTURE_URL="${SOURCE_E2E_PG_FIXTURE_URL:-postgresql://gdc_fixture:gdc_fixture_pw@127.0.0.1:55433/gdc_query_fixture}"
export SOURCE_E2E_SFTP_HOST="${SOURCE_E2E_SFTP_HOST:-127.0.0.1}"
export SOURCE_E2E_SFTP_PORT="${SOURCE_E2E_SFTP_PORT:-22222}"

usage() {
  cat <<EOF
Usage: $0 [--keep-going] [--only <bucket>] [--list]

Runs the full E2E coverage matrix wrapping existing pytest suites.

Buckets:
  http_webhook   tests/test_wiremock_template_e2e.py            (-m e2e_smoke)
  http_syslog    tests/test_e2e_syslog_delivery.py              (-m "e2e_delivery and e2e_regression")
  http_tls       tests/test_syslog_tls_destination.py
  source_e2e     tests/test_source_adapter_e2e.py               (-m source_e2e)

Options:
  --keep-going   Run all buckets even if an earlier one fails (exit non-zero
                 if any bucket failed).
  --only B       Run a single bucket B (one of: http_webhook, http_syslog,
                 http_tls, source_e2e). May be passed multiple times.
  --list         Print the coverage matrix and exit.

Pre-requisites: Docker lab stack is up with WireMock, MinIO, fixture PostgreSQL, and SFTP
reachable. Use either:

- `./scripts/validation-lab/start.sh` (UI + backend + automatic `[DEV E2E]` seed by default), or
- `./scripts/dev-validation/start-full-e2e-lab.sh` (containers + migrations + optional `--seed-visible-fixtures`).
EOF
}

KEEP_GOING=false
SELECTED=()
LIST_ONLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
  --keep-going) KEEP_GOING=true; shift ;;
  --only) SELECTED+=("$2"); shift 2 ;;
  --list) LIST_ONLY=true; shift ;;
  -h | --help) usage; exit 0 ;;
  *) echo "Unknown option: $1 (try --help)" >&2; exit 1 ;;
  esac
done

# --- Coverage matrix (printed before and after the run) ---
print_matrix() {
  cat <<'MATRIX'

  Source x Destination coverage matrix (D = direct StreamRunner E2E test)
  -----------------------------------------------------------------------------------------
  Source                  | SYSLOG_UDP | SYSLOG_TCP | SYSLOG_TLS | WEBHOOK_POST
  HTTP_API_POLLING        |     D      |     D      |     D      |     D
  S3_OBJECT_POLLING       |     D      |     D      |     D      |     D
  DATABASE_QUERY          |     D      |     D      |     D      |     D
  REMOTE_FILE_POLLING     |     D      |     D      |     D      |     D
  -----------------------------------------------------------------------------------------
  D = at least one pytest exercises this source+destination pair end-to-end
      (Source -> Mapping -> Enrichment -> Route -> Destination -> Checkpoint -> delivery_logs).
MATRIX
}

if [[ "$LIST_ONLY" == true ]]; then
  print_matrix
  exit 0
fi

# --- Safety gate (same allow-list as conftest.py / start-full-e2e-lab.sh) ---
python3 - <<'PY' || { echo "  Refusing to run E2E suite." >&2; exit 1; }
import os, sys
from urllib.parse import urlparse
u = urlparse(os.environ.get("DATABASE_URL", ""))
db = (u.path or "").lstrip("/").split("/")[0]
host = (u.hostname or "").lower()
allowed = {"gdc_test", "gdc_e2e_test"}
errors = []
if u.scheme not in ("postgresql", "postgres"):
    errors.append(f"DATABASE_URL must be postgresql:// (got {u.scheme!r})")
if db not in allowed:
    errors.append(f"DATABASE_URL database must be one of {sorted(allowed)} (got {db!r})")
if u.port != 55432:
    errors.append(f"DATABASE_URL port must be 55432 (got {u.port!r})")
if host not in ("127.0.0.1", "localhost", "::1"):
    errors.append(f"DATABASE_URL host must be loopback (got {host!r})")
if errors:
    print("ERROR: full E2E run safety gate refused:", file=sys.stderr)
    for e in errors:
        print(f"  - {e}", file=sys.stderr)
    sys.exit(1)
print(f"  Safety gate OK (db={db}, host={host}, port={u.port}).")
PY

# --- Pre-flight: WireMock, MinIO, fixture PG, SFTP must be reachable ---
preflight_ok=true
echo ""
echo "Pre-flight fixture checks:"
if curl -sf "$WIREMOCK_BASE_URL/__admin/mappings" >/dev/null 2>&1; then
  echo "  WireMock:        OK ($WIREMOCK_BASE_URL)"
else
  echo "  WireMock:        FAIL ($WIREMOCK_BASE_URL) — http_webhook/http_syslog will be skipped"
  preflight_ok=false
fi
if curl -sf "$SOURCE_E2E_MINIO_ENDPOINT/minio/health/ready" >/dev/null 2>&1; then
  echo "  MinIO:           OK ($SOURCE_E2E_MINIO_ENDPOINT)"
else
  echo "  MinIO:           FAIL ($SOURCE_E2E_MINIO_ENDPOINT) — S3 source_e2e cases will be skipped"
fi
if python3 -c "import socket; s=socket.socket(); s.settimeout(1.0); s.connect(('127.0.0.1', 55433)); s.close()" 2>/dev/null; then
  echo "  Fixture Postgres: OK (127.0.0.1:55433)"
else
  echo "  Fixture Postgres: FAIL (127.0.0.1:55433) — DATABASE_QUERY source_e2e cases will be skipped"
fi
if python3 -c "import socket; s=socket.socket(); s.settimeout(1.0); s.connect(('$SOURCE_E2E_SFTP_HOST', $SOURCE_E2E_SFTP_PORT)); s.close()" 2>/dev/null; then
  echo "  SFTP:            OK ($SOURCE_E2E_SFTP_HOST:$SOURCE_E2E_SFTP_PORT)"
else
  echo "  SFTP:            FAIL ($SOURCE_E2E_SFTP_HOST:$SOURCE_E2E_SFTP_PORT) — REMOTE_FILE_POLLING source_e2e cases will be skipped"
fi
if [[ "$preflight_ok" != true ]]; then
  echo ""
  echo "Hint: run ./scripts/validation-lab/start.sh or ./scripts/dev-validation/start-full-e2e-lab.sh first."
fi

print_matrix
echo ""

# --- Bucket definitions ---
declare -A BUCKET_DESC=(
  [http_webhook]="HTTP_API_POLLING -> WEBHOOK_POST (e2e_smoke)"
  [http_syslog]="HTTP_API_POLLING -> SYSLOG_UDP/TCP (e2e_delivery + e2e_regression)"
  [http_tls]="HTTP_API_POLLING -> SYSLOG_TLS (syslog TLS destination)"
  [source_e2e]="S3 / DATABASE_QUERY / REMOTE_FILE_POLLING -> WEBHOOK_POST + SYSLOG_UDP/TCP/TLS (source_e2e)"
)
ALL_BUCKETS=(http_webhook http_syslog http_tls source_e2e)

if [[ ${#SELECTED[@]} -eq 0 ]]; then
  SELECTED=("${ALL_BUCKETS[@]}")
fi
for b in "${SELECTED[@]}"; do
  if [[ -z "${BUCKET_DESC[$b]:-}" ]]; then
    echo "ERROR: unknown bucket '$b' (allowed: ${ALL_BUCKETS[*]})" >&2
    exit 1
  fi
done

run_bucket() {
  local name="$1"
  local log_file="$LOG_DIR/e2e_${name}.log"
  echo ""
  echo "================================================================"
  echo " Bucket: $name — ${BUCKET_DESC[$name]}"
  echo " Log:    $log_file"
  echo "================================================================"
  cd "$ROOT"
  case "$name" in
  http_webhook)
    python3 -m pytest -m e2e_smoke -v --tb=short \
      tests/test_wiremock_template_e2e.py 2>&1 | tee "$log_file"
    return "${PIPESTATUS[0]}"
    ;;
  http_syslog)
    python3 -m pytest -m "e2e_delivery and e2e_regression" -v --tb=short \
      tests/test_e2e_syslog_delivery.py 2>&1 | tee "$log_file"
    return "${PIPESTATUS[0]}"
    ;;
  http_tls)
    python3 -m pytest -v --tb=short \
      tests/test_syslog_tls_destination.py 2>&1 | tee "$log_file"
    return "${PIPESTATUS[0]}"
    ;;
  source_e2e)
    python3 -m pytest -m source_e2e -v --tb=short \
      tests/test_source_adapter_e2e.py 2>&1 | tee "$log_file"
    return "${PIPESTATUS[0]}"
    ;;
  esac
  return 1
}

declare -A BUCKET_STATUS=()
overall=0

for bucket in "${SELECTED[@]}"; do
  set +e
  run_bucket "$bucket"
  ec=$?
  set -e
  if [[ "$ec" -eq 0 ]]; then
    BUCKET_STATUS[$bucket]="PASS"
  else
    BUCKET_STATUS[$bucket]="FAIL(exit=$ec)"
    overall=$ec
    if [[ "$KEEP_GOING" != true ]]; then
      break
    fi
  fi
done

echo ""
echo "================================================================"
echo " Full E2E validation summary"
echo "================================================================"
for bucket in "${SELECTED[@]}"; do
  printf "  %-14s : %s\n" "$bucket" "${BUCKET_STATUS[$bucket]:-NOT RUN}"
done
echo ""

if [[ "$overall" -eq 0 ]]; then
  echo "Result: ALL PASS"
else
  echo "Result: FAILURES (overall exit $overall)"
fi
exit "$overall"
