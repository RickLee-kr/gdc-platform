#!/usr/bin/env bash
# Deterministic fixture data for source adapter E2E (MinIO, fixture PostgreSQL, SFTP).
# Requires: docker compose stack with minio-test, postgres-query-test, sftp-test (see docker-compose.test.yml).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
COMPOSE_FILE="${GDC_TEST_COMPOSE_FILE:-$ROOT/docker-compose.test.yml}"
export PYTHONPATH="$ROOT"

SQL="$(cat <<'SQL'
CREATE TABLE IF NOT EXISTS source_e2e_rows (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL,
  event_ts TIMESTAMPTZ NOT NULL,
  ordering_seq INT NOT NULL
);
DELETE FROM source_e2e_rows;
INSERT INTO source_e2e_rows (event_id, message, severity, event_ts, ordering_seq) VALUES
 ('e2e-db-1', 'first row', 'low', '2020-01-01T00:00:00Z', 1),
 ('e2e-db-2', 'second row', 'medium', '2020-01-01T00:00:01Z', 1),
 ('e2e-db-3', 'third row', 'high', '2020-01-01T00:00:02Z', 1);
SQL
)"

if command -v docker >/dev/null 2>&1; then
  if docker ps --format '{{.Names}}' | grep -q '^gdc-postgres-query-test$'; then
    echo "Seeding postgres-query-test (source_e2e_rows) …"
    docker exec -i gdc-postgres-query-test psql -U gdc_fixture -d gdc_query_fixture -v ON_ERROR_STOP=1 -c "$SQL"
  else
    echo "WARN: gdc-postgres-query-test not running; skip DB fixture seed (psql fallback below)."
  fi
else
  echo "WARN: docker not found."
fi

PG_URL="${SOURCE_E2E_PG_FIXTURE_URL:-postgresql://gdc_fixture:gdc_fixture_pw@127.0.0.1:55433/gdc_query_fixture}"
if command -v psql >/dev/null 2>&1; then
  if pg_isready -h 127.0.0.1 -p 55433 -U gdc_fixture -d gdc_query_fixture >/dev/null 2>&1; then
    echo "Seeding fixture DB via psql …"
    psql "$PG_URL" -v ON_ERROR_STOP=1 -c "$SQL"
  fi
fi

export MINIO_ENDPOINT="${SOURCE_E2E_MINIO_ENDPOINT:-http://127.0.0.1:59000}"
export MINIO_ACCESS_KEY="${SOURCE_E2E_MINIO_ACCESS_KEY:-gdcminioaccess}"
export MINIO_SECRET_KEY="${SOURCE_E2E_MINIO_SECRET_KEY:-gdcminioaccesssecret12}"
export MINIO_BUCKET="${SOURCE_E2E_MINIO_BUCKET:-gdc-source-e2e}"

python3 <<'PY'
import os
import time

import boto3
from botocore.client import Config as BotoConfig

endpoint = os.environ["MINIO_ENDPOINT"].rstrip("/")
access = os.environ["MINIO_ACCESS_KEY"]
secret = os.environ["MINIO_SECRET_KEY"]
bucket = os.environ["MINIO_BUCKET"]

session = boto3.session.Session(aws_access_key_id=access, aws_secret_access_key=secret, region_name="us-east-1")
client = session.client(
    "s3",
    endpoint_url=endpoint,
    use_ssl=endpoint.lower().startswith("https://"),
    config=BotoConfig(signature_version="s3v4", s3={"addressing_style": "path"}),
)

try:
    client.create_bucket(Bucket=bucket)
except Exception:
    pass

def put(key: str, body: bytes) -> None:
    client.put_object(Bucket=bucket, Key=key, Body=body, ContentType="application/octet-stream")


put(
    "e2e-s3/aaa.ndjson",
    b'{"id":"e2e-s3-a1","message":"aaa first","severity":"info"}\n',
)
time.sleep(0.05)
put(
    "e2e-s3/bbb.ndjson",
    b'{"id":"e2e-s3-b1","message":"bbb second","severity":"info"}\n',
)
put(
    "e2e-s3/mixed.ndjson",
    b'{"id":"e2e-s3-ok","message":"valid","severity":"low"}\nNOT_JSON_LINE\n{"id":"e2e-s3-ok2","message":"after skip","severity":"low"}\n',
)
put("e2e-s3/array.json", b'[{"id":"e2e-arr-1","message":"from array","severity":"info"}]')
put("e2e-s3/bad-only.ndjson", b"NOT_JSON_AT_ALL\n")
put("e2e-s3-strict/bad.ndjson", b"NOT_JSON_AT_ALL\n")
print(f"Seeded MinIO bucket s3://{bucket}/e2e-s3/ at {endpoint}")
PY

if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -q '^gdc-sftp-test$'; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  cat >"$TMP/e2e-remote.ndjson" <<'EOF'
{"id":"e2e-rf-1","message":"remote ndjson one","severity":"info"}
{"id":"e2e-rf-2","message":"remote ndjson two","severity":"low"}
EOF
  cat >"$TMP/e2e-remote.csv" <<'EOF'
event_id,message,severity
e2e-csv-1,csv row one,info
e2e-csv-2,csv row two,low
EOF
  docker cp "$TMP/e2e-remote.ndjson" gdc-sftp-test:/home/gdc/upload/e2e-remote.ndjson
  docker cp "$TMP/e2e-remote.csv" gdc-sftp-test:/home/gdc/upload/e2e-remote.csv
  echo "Seeded SFTP files under upload/e2e-remote.ndjson and e2e-remote.csv"
else
  echo "WARN: gdc-sftp-test not running; skip SFTP file copy."
fi

echo "Source E2E fixture seed complete."
