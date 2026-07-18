#!/usr/bin/env bash
# Idempotent fixture reset for Full E2E Lab (test-only).
# Never touches production catalogs. Only FULL E2E prefixed entities / fixture DBs.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LAB_DIR="$ROOT/e2e/lab"
WIREMOCK_BASE="${WIREMOCK_BASE_URL:-http://127.0.0.1:28080}"
WEBHOOK_COLLECTOR="${GDC_E2E_WEBHOOK_COLLECTOR_URL:-http://127.0.0.1:18192}"
SYSLOG_API="${GDC_E2E_SYSLOG_COLLECTOR_API_URL:-http://127.0.0.1:18193}"
NAME_PREFIX="${GDC_E2E_NAME_PREFIX:-[FULL E2E]}"
PG_FIXTURE_URL="${SOURCE_E2E_PG_FIXTURE_URL:-postgresql://gdc_fixture:gdc_fixture_pw@127.0.0.1:55433/gdc_query_fixture}"
export PLATFORM_DB_URL="${DATABASE_URL:-postgresql://gdc:gdc@127.0.0.1:55441/gdc}"
MINIO_ENDPOINT="${SOURCE_E2E_MINIO_ENDPOINT:-http://127.0.0.1:59000}"
MINIO_ACCESS="${SOURCE_E2E_MINIO_ACCESS_KEY:-gdcminioaccess}"
MINIO_SECRET="${SOURCE_E2E_MINIO_SECRET_KEY:-gdcminioaccesssecret12}"
MINIO_BUCKET="${SOURCE_E2E_MINIO_BUCKET:-gdc-full-e2e}"
SFTP_HOST="${SOURCE_E2E_SFTP_HOST:-127.0.0.1}"
SFTP_PORT="${SOURCE_E2E_SFTP_PORT:-22222}"
SFTP_USER="${SOURCE_E2E_SFTP_USER:-gdc}"
SFTP_PASS="${SOURCE_E2E_SFTP_PASSWORD:-devlab123}"

echo "==> Full E2E fixture reset"
echo "    WireMock=$WIREMOCK_BASE"
echo "    WebhookCollector=$WEBHOOK_COLLECTOR"
echo "    SyslogAPI=$SYSLOG_API"
echo "    NamePrefix=$NAME_PREFIX"

# --- WireMock journal + Full E2E mappings ---
if curl -sf "$WIREMOCK_BASE/__admin/mappings" >/dev/null; then
  curl -sf -X DELETE "$WIREMOCK_BASE/__admin/requests" >/dev/null || true
  curl -sf -X POST "$WIREMOCK_BASE/__admin/scenarios/reset" >/dev/null || true
  for f in "$LAB_DIR"/fixtures/http/mappings/*.json; do
    [[ -f "$f" ]] || continue
    mid="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('id',''))" "$f")"
    [[ -n "$mid" ]] || continue
    curl -sf -X DELETE "$WIREMOCK_BASE/__admin/mappings/$mid" >/dev/null || true
    code="$(curl -s -o /tmp/wm-map-out.json -w '%{http_code}' -X POST "$WIREMOCK_BASE/__admin/mappings" \
      -H 'Content-Type: application/json' --data-binary @"$f")"
    if [[ "$code" != "200" && "$code" != "201" ]]; then
      echo "ERROR: WireMock mapping failed for $(basename "$f"): HTTP $code" >&2
      cat /tmp/wm-map-out.json >&2 || true
      exit 1
    fi
  done
  echo "    WireMock mappings loaded ($(ls "$LAB_DIR"/fixtures/http/mappings/*.json | wc -l))"
else
  echo "ERROR: WireMock not reachable at $WIREMOCK_BASE" >&2
  exit 1
fi

# --- Collectors reset ---
curl -sf -X POST "$WEBHOOK_COLLECTOR/reset" >/dev/null
curl -sf -X POST "$SYSLOG_API/reset" >/dev/null
echo "    Collectors reset"

# --- PostgreSQL fixture ---
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q 'postgres-query-test'; then
  docker exec -i "$(docker ps --format '{{.Names}}' | grep 'postgres-query-test' | head -1)" \
    psql -U gdc_fixture -d gdc_query_fixture -v ON_ERROR_STOP=1 <"$LAB_DIR/fixtures/postgres/seed.sql"
  echo "    PostgreSQL fixture seeded (docker)"
elif command -v psql >/dev/null 2>&1; then
  psql "$PG_FIXTURE_URL" -v ON_ERROR_STOP=1 -f "$LAB_DIR/fixtures/postgres/seed.sql"
  echo "    PostgreSQL fixture seeded (psql)"
else
  echo "WARN: could not seed PostgreSQL fixture" >&2
fi

# --- MinIO ---
export MINIO_ENDPOINT MINIO_ACCESS MINIO_SECRET MINIO_BUCKET
export FIXTURE_S3_DIR="$LAB_DIR/fixtures/s3"
python3 <<'PY'
import os
from pathlib import Path

import boto3
from botocore.client import Config as BotoConfig

endpoint = os.environ["MINIO_ENDPOINT"].rstrip("/")
bucket = os.environ["MINIO_BUCKET"]
client = boto3.session.Session(
    aws_access_key_id=os.environ["MINIO_ACCESS"],
    aws_secret_access_key=os.environ["MINIO_SECRET"],
    region_name="us-east-1",
).client(
    "s3",
    endpoint_url=endpoint,
    use_ssl=endpoint.lower().startswith("https://"),
    config=BotoConfig(signature_version="s3v4", s3={"addressing_style": "path"}),
)
try:
    client.create_bucket(Bucket=bucket)
except Exception:
    pass
# Clear previous full-e2e prefix objects
try:
    listed = client.list_objects_v2(Bucket=bucket, Prefix="full-e2e/")
    for obj in listed.get("Contents") or []:
        client.delete_object(Bucket=bucket, Key=obj["Key"])
except Exception as exc:
    print(f"WARN: MinIO clear: {exc}")

src = Path(os.environ["FIXTURE_S3_DIR"])
mapping = {
    "init.ndjson": "full-e2e/init.ndjson",
    "new.ndjson": "full-e2e/new.ndjson",
    "dup.ndjson": "full-e2e/dup.ndjson",
    "invalid.ndjson": "full-e2e/invalid.ndjson",
    "nested.json": "full-e2e/nested.json",
}
for name, key in mapping.items():
    body = (src / name).read_bytes()
    client.put_object(Bucket=bucket, Key=key, Body=body, ContentType="application/octet-stream")
print(f"    MinIO seeded s3://{bucket}/full-e2e/ at {endpoint}")
PY

# --- SFTP ---
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q 'sftp-test'; then
  SFTP_CTN="$(docker ps --format '{{.Names}}' | grep 'sftp-test' | head -1)"
  docker exec "$SFTP_CTN" sh -c 'rm -rf /home/gdc/upload/full-e2e && mkdir -p /home/gdc/upload/full-e2e' || true
  for f in "$LAB_DIR"/fixtures/sftp/*; do
    [[ -f "$f" ]] || continue
    docker cp "$f" "$SFTP_CTN:/home/gdc/upload/full-e2e/$(basename "$f")"
  done
  docker exec "$SFTP_CTN" chown -R 1001:1001 /home/gdc/upload/full-e2e || true
  echo "    SFTP seeded /upload/full-e2e/"
else
  echo "WARN: sftp-test not running; skip SFTP seed" >&2
fi

# --- Platform catalog cleanup (FULL E2E prefix only; skip if schema not migrated) ---
export NAME_PREFIX="$NAME_PREFIX"
python3 <<'PY'
import os
import sys

url = os.environ.get("PLATFORM_DB_URL") or os.environ.get("DATABASE_URL") or ""
prefix = os.environ.get("NAME_PREFIX", "[FULL E2E]")
if not url:
    print("WARN: no DATABASE_URL; skip catalog cleanup", file=sys.stderr)
    raise SystemExit(0)

try:
    import psycopg
except ImportError:
    try:
        import psycopg2 as psycopg  # type: ignore
    except ImportError:
        print("WARN: psycopg not available; skip platform catalog cleanup", file=sys.stderr)
        raise SystemExit(0)

pattern = prefix + "%"
try:
    conn = psycopg.connect(url)
except Exception as exc:
    print(f"WARN: platform DB connect failed ({exc}); skip catalog cleanup", file=sys.stderr)
    raise SystemExit(0)

try:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM information_schema.tables
            WHERE table_schema='public' AND table_name='streams'
            """
        )
        if cur.fetchone() is None:
            print("    Platform catalog cleanup skipped (streams table missing — run alembic first)")
            raise SystemExit(0)

        def _table_exists(name: str) -> bool:
            cur.execute(
                """
                SELECT 1 FROM information_schema.tables
                WHERE table_schema='public' AND table_name=%s
                """,
                (name,),
            )
            return cur.fetchone() is not None

        def _run(label: str, sql: str, params: tuple) -> None:
            try:
                cur.execute(sql, params)
                print(f"    cleanup {label}: {cur.rowcount} rows")
                conn.commit()
            except Exception as exc:
                print(f"    WARN cleanup {label}: {exc}", file=sys.stderr)
                conn.rollback()

        # Stop FULL E2E streams first so the API scheduler cannot race deletes.
        _run(
            "streams_stop",
            "UPDATE streams SET enabled=false, status='STOPPED' WHERE name LIKE %s",
            (pattern,),
        )

        # Lab catalog is dedicated to Full E2E; TRUNCATE avoids leaving GB-sized empty
        # partitions that make subsequent connector FK checks scan for minutes.
        if _table_exists("delivery_logs"):
            try:
                cur.execute("TRUNCATE TABLE delivery_logs RESTART IDENTITY")
                print("    cleanup delivery_logs: truncated")
                conn.commit()
            except Exception as exc:
                print(f"    WARN cleanup delivery_logs truncate: {exc}", file=sys.stderr)
                conn.rollback()
                _run(
                    "delivery_logs",
                    """
                    DELETE FROM delivery_logs
                    WHERE stream_id IN (SELECT id FROM streams WHERE name LIKE %s)
                       OR route_id IN (
                            SELECT r.id FROM routes r
                            JOIN streams s ON s.id = r.stream_id
                            WHERE s.name LIKE %s
                       )
                    """,
                    (pattern, pattern),
                )
        for table in (
            "checkpoints",
            "mappings",
            "enrichments",
            "stream_protection_rules",
            "stream_policy_rules",
            "runtime_stream_snapshot",
        ):
            if _table_exists(table):
                _run(
                    table,
                    f"DELETE FROM {table} WHERE stream_id IN (SELECT id FROM streams WHERE name LIKE %s)",
                    (pattern,),
                )
        _run("routes", "DELETE FROM routes WHERE stream_id IN (SELECT id FROM streams WHERE name LIKE %s)", (pattern,))
        _run("streams", "DELETE FROM streams WHERE name LIKE %s", (pattern,))
        _run("destinations", "DELETE FROM destinations WHERE name LIKE %s", (pattern,))
        # sources table may not have a name column in all schemas.
        if _table_exists("sources"):
            cur.execute(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='sources' AND column_name='name'
                """
            )
            if cur.fetchone() is not None:
                _run("sources", "DELETE FROM sources WHERE name LIKE %s", (pattern,))
            else:
                _run(
                    "sources",
                    """
                    DELETE FROM sources
                    WHERE connector_id IN (SELECT id FROM connectors WHERE name LIKE %s)
                    """,
                    (pattern,),
                )
        _run("connectors", "DELETE FROM connectors WHERE name LIKE %s", (pattern,))
    print(f"    Platform catalog cleaned for prefix {prefix!r}")
finally:
    try:
        conn.close()
    except Exception:
        pass
PY

echo "==> Fixture reset complete (idempotent)"
