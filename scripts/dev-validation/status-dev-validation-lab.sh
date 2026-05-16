#!/usr/bin/env bash
# Show Dev Validation Lab stack status, API/migration/lab counts, and recent seeder logs.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="$ROOT/.dev-validation-logs"
COMPOSE_FILE="$ROOT/docker-compose.dev-validation.yml"
LAB_COMPOSE_PROJECT="${GDC_DEV_VALIDATION_COMPOSE_PROJECT:-gdc-platform-test}"
API_ROOT="${DEV_VALIDATION_API_ROOT:-http://127.0.0.1:8000}"
API_PREFIX="${DEV_VALIDATION_API_PREFIX:-/api/v1}"

echo "=== Docker Compose (dev-validation profile, project: $LAB_COMPOSE_PROJECT) ==="
docker compose -p "$LAB_COMPOSE_PROJECT" -f "$COMPOSE_FILE" --profile dev-validation ps -a || true

echo ""
echo "=== Backend ($API_ROOT) ==="
if curl -fsS -o /dev/null --max-time 3 "$API_ROOT/docs" 2>/dev/null; then
  echo "  /docs: OK"
else
  echo "  /docs: not reachable (uvicorn running?)"
fi
if curl -fsS -o /dev/null --max-time 3 "$API_ROOT/health" 2>/dev/null; then
  echo "  /health: OK"
else
  echo "  /health: not reachable"
fi

echo ""
echo "=== Frontend http://127.0.0.1:5173 ==="
if curl -fsS -o /dev/null --max-time 3 http://127.0.0.1:5173/ 2>/dev/null; then
  echo "OK (HTTP response received)"
else
  echo "Not reachable (is npm run dev / Vite running?)"
fi

echo ""
echo "=== Lab test database (direct SQL; TEST_DATABASE_URL) ==="
export GDC_STATUS_DB_URL="${TEST_DATABASE_URL:-postgresql://gdc:gdc@127.0.0.1:55432/datarelay}"
export GDC_REPO_ROOT="$ROOT"
python3 <<'PY'
import os
import subprocess
import sys
from urllib.parse import urlparse

url = os.environ.get("GDC_STATUS_DB_URL", "")
root = os.environ.get("GDC_REPO_ROOT", ".")
try:
    u = urlparse(url)
    db = (u.path or "").strip("/").split("/")[0]
    print(f"  database: {db}")
    print(f"  host: {u.hostname!r}  port: {u.port!r}  user: {u.username!r}")
except Exception as exc:
    print(f"  (could not parse URL: {exc})")
    sys.exit(0)

try:
    import psycopg2
except ImportError:
    print("  (psycopg2 not installed — install backend deps for direct DB diagnostics)")
    sys.exit(0)

try:
    conn = psycopg2.connect(url)
    cur = conn.cursor()
    cur.execute("SELECT current_database()")
    print(f"  current_database(): {cur.fetchone()[0]!r}")
    cur.execute(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = 'public' AND table_name = 'alembic_version')"
    )
    has_av = bool(cur.fetchone()[0])
    print(f"  alembic_version table present: {has_av}")
    if has_av:
        cur.execute("SELECT version_num FROM alembic_version LIMIT 1")
        row = cur.fetchone()
        print(f"  alembic current (DB): {row[0]!r}" if row else "  alembic current (DB): (empty)")
    else:
        print("  alembic current (DB): (no alembic_version table)")
    cur.execute(
        "SELECT COUNT(*) FROM information_schema.tables "
        "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
    )
    nt = int(cur.fetchone()[0])
    print(f"  public base tables: {nt}")
    if not has_av and nt > 0:
        print("  WARNING: application tables exist but alembic_version is missing — migrations may fail.")
        print("           Consider: ./scripts/dev-validation/reset-dev-validation-db.sh")
    cur.close()
    conn.close()
except Exception as exc:
    print(f"  (direct DB inspection failed: {exc})")

for cmd in (["alembic", "heads"], [sys.executable, "-m", "alembic", "heads"]):
    try:
        r = subprocess.run(cmd, cwd=root, capture_output=True, text=True, timeout=45)
    except FileNotFoundError:
        continue
    if r.returncode == 0 and (r.stdout or "").strip():
        print(f"  alembic heads (scripts): {(r.stdout or '').strip().replace(chr(10), ' | ')}")
        break
else:
    print("  alembic heads (scripts): (could not run alembic)")
PY

echo ""
echo "=== Migrations / schema (GET ${API_PREFIX}/runtime/status) ==="
curl -fsS --max-time 4 "$API_ROOT${API_PREFIX}/runtime/status" 2>/dev/null | python3 -c "
import json, sys
raw = sys.stdin.read()
if not raw.strip():
    sys.exit(1)
try:
    d = json.loads(raw)
except Exception as e:
    print('  (parse error:', e, ')')
    sys.exit(1)
db = d.get('database') or {}
print('  schema_ready:', d.get('schema_ready'))
print('  scheduler_active:', d.get('scheduler_active'))
print('  alembic_revision:', repr(d.get('alembic_revision')))
mt = d.get('missing_tables')
print('  missing_tables count:', len(mt) if isinstance(mt, list) else mt)
print('  degraded_reason:', d.get('degraded_reason'))
print('  database dbname:', db.get('dbname'))
rev = d.get('alembic_revision')
ready = d.get('schema_ready') is True
if ready and rev:
    print('  migrations: likely applied (schema ready + alembic revision present)')
elif ready and not rev:
    print('  migrations: schema ready but no alembic_version row (run alembic upgrade head)')
else:
    print('  migrations: schema not ready — run start script or alembic upgrade against TEST_DATABASE_URL')
" 2>/dev/null || echo "  (API not reachable or runtime/status parse failed)"

echo ""
echo "=== Lab entity counts (API) ==="
curl -fsS --max-time 4 "$API_ROOT${API_PREFIX}/connectors/" 2>/dev/null | python3 -c "
import json, sys
raw = sys.stdin.read()
if not raw.strip():
    sys.exit(1)
try:
    data = json.loads(raw)
except Exception:
    print('  [DEV VALIDATION] connectors: (unparseable response)')
    sys.exit(1)
if not isinstance(data, list):
    print('  [DEV VALIDATION] connectors: (unexpected JSON shape)')
    sys.exit(1)
n = sum(1 for x in data if isinstance(x, dict) and '[DEV VALIDATION]' in str(x.get('name', '')))
print(f'  [DEV VALIDATION] connectors: {n}')
" 2>/dev/null || echo "  [DEV VALIDATION] connectors: (API error or parse failed)"

curl -fsS --max-time 4 "$API_ROOT${API_PREFIX}/validation/" 2>/dev/null | python3 -c "
import json, sys
raw = sys.stdin.read()
if not raw.strip():
    sys.exit(1)
try:
    data = json.loads(raw)
except Exception:
    print('  dev_lab validations: (unparseable response)')
    sys.exit(1)
if not isinstance(data, list):
    print('  dev_lab validations: (unexpected JSON shape)')
    sys.exit(1)
n = sum(
    1
    for x in data
    if isinstance(x, dict)
    and str(x.get('template_key') or '').startswith('dev_lab')
)
print(f'  dev_lab validation definitions (template_key): {n}')
" 2>/dev/null || echo "  dev_lab validation definitions: (API error or parse failed)"

echo ""
echo "=== Optional lab fixtures (MinIO / query DBs / SFTP) — host ports ==="
check_tcp() {
  local host="$1" port="$2" label="$3"
  if command -v python3 >/dev/null 2>&1; then
    if python3 - <<PY
import socket
s=socket.socket()
s.settimeout(1.0)
try:
    s.connect(("$host", int("$port")))
    s.close()
    raise SystemExit(0)
except Exception:
    raise SystemExit(1)
PY
    then
      echo "  $label: OK (${host}:${port})"
    else
      echo "  $label: FAIL (no TCP listener on ${host}:${port})"
    fi
  else
    echo "  $label: (skipped — python3 unavailable for TCP probe)"
  fi
}

check_tcp 127.0.0.1 59000 "MinIO API (minio-test)"
check_tcp 127.0.0.1 55433 "PostgreSQL query fixture (postgres-query-test)"
check_tcp 127.0.0.1 33306 "MySQL query fixture (mysql-query-test)"
check_tcp 127.0.0.1 33307 "MariaDB query fixture (mariadb-query-test)"
check_tcp 127.0.0.1 22222 "SFTP test (sftp-test)"
check_tcp 127.0.0.1 22223 "SSH/SCP test (ssh-scp-test)"

echo ""
echo "=== Seed scripts (optional) ==="
for rel in \
  scripts/testing/source-expansion/seed-s3-fixtures.sh \
  scripts/testing/source-expansion/seed-database-fixtures.sh \
  scripts/testing/source-expansion/seed-remote-file-fixtures.sh; do
  if [[ -f "$ROOT/$rel" ]]; then
    echo "  present: $rel"
  else
    echo "  missing: $rel"
  fi
done

echo ""
echo "=== Latest validation runner row (SQL — requires psql on TEST_DATABASE_URL) ==="
export GDC_STATUS_DB_URL="${TEST_DATABASE_URL:-postgresql://gdc:gdc@127.0.0.1:55432/datarelay}"
python3 <<'PY' 2>/dev/null || echo "  (psql snapshot skipped)"
import os, subprocess, sys
url = os.environ.get("GDC_STATUS_DB_URL", "")
if not url:
    sys.exit(0)
q = """
SELECT id, validation_id, status, latency_ms, left(message, 120) AS msg
FROM validation_runs
WHERE validation_stage = 'runner_summary'
ORDER BY id DESC LIMIT 3;
"""
try:
    out = subprocess.check_output(["psql", url, "-At", "-c", q], text=True, timeout=6)
    for line in (out or "").strip().splitlines():
        print(" ", line.replace("|", " | "))
except Exception as exc:
    print("  (psql failed:", exc, ")")
PY

echo ""
echo "=== PID files ==="
for name in backend frontend; do
  f="$LOG_DIR/${name}.pid"
  if [[ -f "$f" ]]; then
    pid="$(tr -d ' \n\r\t' <"$f" | head -c 32)"
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      echo "$name: PID $pid (running)"
    else
      echo "$name: stale or dead ($f)"
    fi
  else
    echo "$name: no pid file"
  fi
done

echo ""
echo "=== Recent dev_validation_lab / startup_database (backend.log) ==="
if [[ -f "$LOG_DIR/backend.log" ]]; then
  (grep -E 'dev_validation_lab|startup_database' "$LOG_DIR/backend.log" 2>/dev/null || true) | tail -n 20
  if ! grep -qE 'dev_validation_lab|startup_database' "$LOG_DIR/backend.log" 2>/dev/null; then
    echo "  (no matching lines yet — see full log at $LOG_DIR/backend.log)"
  fi
else
  echo "  (no backend.log — lab not started yet)"
fi

echo ""
echo "=== Latest logs under $LOG_DIR ==="
if [[ -d "$LOG_DIR" ]]; then
  shopt -s nullglob
  log_files=( "$LOG_DIR"/*.log )
  shopt -u nullglob
  if ((${#log_files[@]})); then
    ls -t "${log_files[@]}" | head -8 | while IFS= read -r path; do
      echo "  $path"
    done
  else
    echo "  (no .log files yet)"
  fi
else
  echo "  (directory missing — lab not started yet)"
fi
