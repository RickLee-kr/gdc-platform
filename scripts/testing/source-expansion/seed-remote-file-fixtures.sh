#!/usr/bin/env bash
# Seed SFTP/SCP test containers with NDJSON, JSON, CSV, line logs, malformed, empty, rotated files.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
COMPOSE="${GDC_DEV_VALIDATION_COMPOSE_FILE:-$ROOT/docker-compose.dev-validation.yml}"
PROJECT="${GDC_DEV_VALIDATION_COMPOSE_PROJECT:-gdc-platform-test}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found; cannot seed remote file fixtures."
  exit 1
fi

if ! docker compose -p "$PROJECT" -f "$COMPOSE" --profile dev-validation ps sftp-test 2>/dev/null | grep -q sftp-test; then
  echo "sftp-test container not running; start dev-validation compose profile first."
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat >"$TMP/lab-001.ndjson" <<'EOF'
{"id":"rf-1","message":"sftp ndjson","severity":"info"}
{"id":"rf-2","message":"second","severity":"low"}
EOF
echo '[{"id":"ja","message":"json array","severity":"info"}]' >"$TMP/lab-002.json"
cat >"$TMP/lab-003.csv" <<'EOF'
event_id,message,severity
csv-1,row one,info
csv-2,row two,low
EOF
cat >"$TMP/lab-004.log" <<'EOF'
plain line one
plain line two
EOF
printf '%s\n' '{"ok":true}' '{NOT JSON' >"$TMP/lab-bad.ndjson"
: >"$TMP/lab-empty.ndjson"
echo '{"id":"rot-1","message":"rotated","severity":"info"}' >"$TMP/lab-rotated-1.ndjson"

docker cp "$TMP/lab-001.ndjson" gdc-sftp-test:/home/gdc/upload/lab-001.ndjson
docker cp "$TMP/lab-002.json" gdc-sftp-test:/home/gdc/upload/lab-002.json
docker cp "$TMP/lab-003.csv" gdc-sftp-test:/home/gdc/upload/lab-003.csv
docker cp "$TMP/lab-004.log" gdc-sftp-test:/home/gdc/upload/lab-004.log
docker cp "$TMP/lab-bad.ndjson" gdc-sftp-test:/home/gdc/upload/lab-bad.ndjson
docker cp "$TMP/lab-empty.ndjson" gdc-sftp-test:/home/gdc/upload/lab-empty.ndjson
docker cp "$TMP/lab-rotated-1.ndjson" gdc-sftp-test:/home/gdc/upload/lab-rotated-1.ndjson

if docker compose -p "$PROJECT" -f "$COMPOSE" --profile dev-validation ps ssh-scp-test 2>/dev/null | grep -q ssh-scp-test; then
  echo '[{"id":"scp-1","message":"scp json","severity":"info"}]' >"$TMP/lab-scp-001.json"
  echo '{"id":"scp-nd","message":"scp nd","severity":"low"}' >"$TMP/lab-scp-002.ndjson"
  docker cp "$TMP/lab-scp-001.json" gdc-ssh-scp-test:/home/gdc2/upload/lab-scp-001.json
  docker cp "$TMP/lab-scp-002.ndjson" gdc-ssh-scp-test:/home/gdc2/upload/lab-scp-002.ndjson
fi

echo "Remote file fixtures written under sftp-test:/home/gdc/upload and (if running) ssh-scp-test:/home/gdc2/upload."
