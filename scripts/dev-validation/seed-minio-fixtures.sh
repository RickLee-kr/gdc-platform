#!/usr/bin/env bash
# Seed MinIO lab objects via boto3 on the fixture Docker network (no host mc/awscli).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/dev-validation/lib/fixture-compose.sh
source "$ROOT/scripts/dev-validation/lib/fixture-compose.sh"

export MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://gdc-minio-test:9000}"
export MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-gdcminioaccess}"
export MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-gdcminioaccesssecret12}"
export MINIO_BUCKET="${MINIO_BUCKET:-gdc-test-logs}"

if ! _fixture_service_running minio-test; then
  echo "minio-test not running; skip MinIO fixture seed." >&2
  exit 0
fi

echo "Seeding MinIO fixtures at $MINIO_ENDPOINT (bucket=$MINIO_BUCKET) …"
docker run --rm \
  --network "$DEV_VALIDATION_DOCKER_NETWORK" \
  -e MINIO_ENDPOINT \
  -e MINIO_ACCESS_KEY \
  -e MINIO_SECRET_KEY \
  -e MINIO_BUCKET \
  -v "$ROOT/scripts/dev-validation/seed_minio_boto.py:/seed.py:ro" \
  python:3.12-slim \
  bash -ec 'pip install -q --no-cache-dir boto3 && python /seed.py'
