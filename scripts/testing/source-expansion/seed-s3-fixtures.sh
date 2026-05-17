#!/usr/bin/env bash
# Seed MinIO objects for dev-validation lab S3_OBJECT_POLLING (delegates to Docker-network seed).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# Host uvicorn may still use 127.0.0.1:59000; fixture bootstrap uses container DNS.
export MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://127.0.0.1:59000}"
bash "$ROOT/scripts/dev-validation/seed-minio-fixtures.sh"
