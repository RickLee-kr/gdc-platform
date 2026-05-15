#!/usr/bin/env bash
# One-command S3_OBJECT_POLLING validation against PostgreSQL + MinIO.
# Requires: TEST_DATABASE_URL, MINIO_*, boto3, psycopg2, pytest (see docs).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO_ROOT"

PG_SUM="SKIP"
MINIO_SUM="SKIP"
SEED_SUM="SKIP"
UNIT_SUM="SKIP"
DB_CKPT_SUM="SKIP"
MINIO_INT_SUM="SKIP"

die() {
  echo "" >&2
  echo "ERROR: $*" >&2
  exit 1
}

print_summary() {
  echo ""
  echo "================================================================"
  echo " FINAL SUMMARY (S3 MinIO E2E validation)"
  echo "================================================================"
  echo "  PostgreSQL:              $PG_SUM"
  echo "  MinIO:                   $MINIO_SUM"
  echo "  Seed fixtures:           $SEED_SUM"
  echo "  S3 object polling tests: $UNIT_SUM"
  echo "  DB checkpoint tests:     $DB_CKPT_SUM"
  echo "  MinIO integration tests: $MINIO_INT_SUM"
  echo "================================================================"
}

require_env() {
  local missing=()
  for name in TEST_DATABASE_URL MINIO_ENDPOINT MINIO_ACCESS_KEY MINIO_SECRET_KEY MINIO_BUCKET; do
    if [[ -z "${!name:-}" ]]; then
      missing+=("$name")
    fi
  done
  if ((${#missing[@]})); then
    die "Missing required environment variables: ${missing[*]}"
  fi
}

section() {
  echo ""
  echo "----------------------------------------------------------------"
  echo " $*"
  echo "----------------------------------------------------------------"
}

verify_postgres() {
  section "1/6 Verify PostgreSQL (TEST_DATABASE_URL)"
  python3 <<'PY'
import os
import sys

import psycopg2

url = os.environ.get("TEST_DATABASE_URL", "").strip()
if not url:
    print("TEST_DATABASE_URL is empty", file=sys.stderr)
    sys.exit(1)
try:
    conn = psycopg2.connect(url, connect_timeout=10)
except Exception as exc:
    print(f"PostgreSQL connection failed: {exc}", file=sys.stderr)
    sys.exit(1)
try:
    cur = conn.cursor()
    cur.execute("SELECT 1")
    cur.fetchone()
finally:
    conn.close()
print("PostgreSQL OK: SELECT 1 succeeded.")
PY
  PG_SUM="OK"
}

verify_minio() {
  section "2/6 Verify MinIO (ListBuckets — auth + endpoint; bucket may not exist yet)"
  python3 <<'PY'
import os
import sys

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

endpoint = os.environ["MINIO_ENDPOINT"].rstrip("/")
bucket = os.environ["MINIO_BUCKET"].strip()
ak = os.environ["MINIO_ACCESS_KEY"].strip()
sk = os.environ["MINIO_SECRET_KEY"].strip()
use_ssl = endpoint.lower().startswith("https://")

session = boto3.session.Session(aws_access_key_id=ak, aws_secret_access_key=sk, region_name="us-east-1")
client = session.client(
    "s3",
    endpoint_url=endpoint,
    use_ssl=use_ssl,
    config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
)
try:
    resp = client.list_buckets()
except ClientError as exc:
    code = exc.response.get("Error", {}).get("Code", "")
    print(f"MinIO ListBuckets failed ({code}): {exc}", file=sys.stderr)
    sys.exit(1)
except OSError as exc:
    print(f"MinIO network error: {exc}", file=sys.stderr)
    sys.exit(1)
names = {b.get("Name") for b in resp.get("Buckets", []) if isinstance(b, dict)}
if bucket in names:
    print(f"MinIO OK: ListBuckets succeeded; bucket {bucket!r} exists.")
else:
    print(f"MinIO OK: ListBuckets succeeded; bucket {bucket!r} not present yet (seed step will create or upload).")
PY
  MINIO_SUM="OK"
}

run_seed() {
  section "3/6 Seed MinIO S3 fixtures"
  bash "$REPO_ROOT/scripts/testing/minio/seed-minio-s3-fixtures.sh"
  SEED_SUM="OK"
}

run_pytest_s3_polling() {
  section "4/6 Pytest: tests/test_s3_object_polling.py"
  python3 -m pytest tests/test_s3_object_polling.py -v --tb=short -x
  UNIT_SUM="OK"
}

run_pytest_checkpoint_db() {
  section "5/6 Pytest: checkpoint tests (exclude @pytest.mark.minio)"
  python3 -m pytest tests/test_s3_stream_runner_checkpoint.py -m "not minio" -v --tb=short -x
  DB_CKPT_SUM="OK"
}

run_pytest_checkpoint_minio() {
  section "6/6 Pytest: MinIO integration (@pytest.mark.minio)"
  python3 -m pytest tests/test_s3_stream_runner_checkpoint.py -m minio -v --tb=short -x
  MINIO_INT_SUM="OK"
}

require_env

verify_postgres || { PG_SUM="FAIL"; print_summary; exit 1; }
verify_minio || { MINIO_SUM="FAIL"; print_summary; exit 1; }
run_seed || { SEED_SUM="FAIL"; print_summary; exit 1; }
run_pytest_s3_polling || { UNIT_SUM="FAIL"; print_summary; exit 1; }
run_pytest_checkpoint_db || { DB_CKPT_SUM="FAIL"; print_summary; exit 1; }
run_pytest_checkpoint_minio || { MINIO_INT_SUM="FAIL"; print_summary; exit 1; }

print_summary
echo ""
echo "All steps completed successfully."
exit 0
