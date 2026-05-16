#!/usr/bin/env bash
# Seed MinIO / fixture DB / SFTP+SCP objects for [DEV VALIDATION] lab streams (idempotent).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export PYTHONPATH="$ROOT"

echo "Seeding dev-validation lab fixtures (S3 / DATABASE_QUERY / REMOTE_FILE) …"
bash "$ROOT/scripts/testing/source-expansion/seed-database-fixtures.sh"
bash "$ROOT/scripts/testing/source-expansion/seed-s3-fixtures.sh"
bash "$ROOT/scripts/testing/source-expansion/seed-remote-file-fixtures.sh"
echo "Dev-validation lab fixture seed complete."
