"""Idempotent MinIO object seed for dev-validation (invoked inside Docker network)."""

from __future__ import annotations

import os

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


def put(key: str, body: bytes, ctype: str = "application/octet-stream") -> None:
    client.put_object(Bucket=bucket, Key=key, Body=body, ContentType=ctype)


nd = (
    b'{"id":"s3-lab-1","message":"ndjson security","severity":"info"}\n'
    b'{"id":"s3-lab-2","message":"second line","severity":"low"}\n'
)
put("security/lab-sample.ndjson", nd, "application/x-ndjson")
put("security/lab-array.json", b'[{"id":"ja-1","message":"array row","severity":"info"}]', "application/json")
put("security/lab-malformed.ndjson", b'{"ok":true}\n{NOT JSON\n', "application/x-ndjson")
put("security/lab-empty.ndjson", b"", "application/x-ndjson")
print(f"Seeded s3://{bucket}/security/ against {endpoint}")
