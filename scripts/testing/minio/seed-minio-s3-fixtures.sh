#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
export GDC_REPO_ROOT="$ROOT"
export MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://127.0.0.1:9000}"
export MINIO_BUCKET="${MINIO_BUCKET:-gdc-test-logs}"

if [[ -z "${MINIO_ACCESS_KEY:-}" || -z "${MINIO_SECRET_KEY:-}" ]]; then
  echo "MINIO_ACCESS_KEY and MINIO_SECRET_KEY must be set in the environment." >&2
  exit 1
fi

python3 -c "import boto3" 2>/dev/null || {
  echo "boto3 is required (pip install -r requirements.txt)." >&2
  exit 1
}

python3 <<'PY'
import os
import sys
from pathlib import Path

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

endpoint = os.environ["MINIO_ENDPOINT"].rstrip("/")
bucket = os.environ["MINIO_BUCKET"].strip()
ak = os.environ["MINIO_ACCESS_KEY"].strip()
sk = os.environ["MINIO_SECRET_KEY"].strip()
use_ssl = endpoint.lower().startswith("https://")

root = Path(os.environ["GDC_REPO_ROOT"])
fixtures = root / "scripts" / "testing" / "minio" / "fixtures"

session = boto3.session.Session(aws_access_key_id=ak, aws_secret_access_key=sk, region_name="us-east-1")
client = session.client(
    "s3",
    endpoint_url=endpoint,
    use_ssl=use_ssl,
    config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
)

try:
    client.head_bucket(Bucket=bucket)
except ClientError:
    try:
        client.create_bucket(Bucket=bucket)
    except ClientError as exc:
        err = exc.response.get("Error", {}).get("Code", "")
        if err == "BucketAlreadyOwnedByYou":
            pass
        else:
            raise
    print(f"created bucket {bucket!r}")
else:
    print(f"bucket {bucket!r} already exists")

uploads = [
    ("security/events-001.ndjson", fixtures / "security" / "events-001.ndjson"),
    ("security/events-002.json", fixtures / "security" / "events-002.json"),
    ("waf/aws-waf-sample.ndjson", fixtures / "waf" / "aws-waf-sample.ndjson"),
]

for key, path in uploads:
    if not path.is_file():
        print(f"missing fixture: {path}", file=sys.stderr)
        sys.exit(2)
    body = path.read_bytes()
    client.put_object(Bucket=bucket, Key=key, Body=body, ContentType="application/octet-stream")
    print(f"uploaded s3://{bucket}/{key} ({len(body)} bytes)")

print("MinIO seed complete.")
PY
