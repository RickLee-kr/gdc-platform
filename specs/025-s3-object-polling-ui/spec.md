# 025 S3 object polling — UI and validation

## Purpose

Define how **S3_OBJECT_POLLING** is exposed in the connector and stream wizards, how connectivity testing behaves without leaking secrets, and how this aligns with existing runtime rules.

## Constraints (non-negotiable)

- **Connector ≠ Stream ≠ Source**: S3 credentials and endpoint live on the connector/source configuration; `max_objects_per_run` is stream-level execution tuning.
- **Checkpoint updates only after successful destination delivery** (unchanged; StreamRunner owns this).
- **Never expose** `secret_key`, signed URLs, or raw credentials in API responses, logs, UI copy, or auth-test output.
- **HTTP_API_POLLING** flows must remain unchanged for existing connectors.
- **English-only** product strings in UI, API messages, and this spec’s normative text.

## Connector UI

- Source kind **S3_OBJECT_POLLING** is selectable at connector creation; edit page shows S3 fields when the stored source type is S3.
- Fields: `endpoint_url`, `bucket`, `region`, `access_key`, `secret_key` (masked), `prefix`, `path_style_access`, `use_ssl`.
- Defaults favor **MinIO local**: path-style on, SSL off; placeholders document `http://127.0.0.1:9000` and `https://s3.amazonaws.com`.
- Client-side validation before save: required fields and secret when none is configured server-side.

## Stream UI

- Streams backed by S3 expose **max_objects_per_run** with numeric validation, default hint, and helper text describing per-run object batching (not record-level cap when one object expands to many events).

## Connectivity test (probe)

- Non-destructive **HeadBucket** + capped **ListObjectsV2** under `prefix`.
- Response includes: endpoint reachability, auth/bucket outcome, object count preview, sample keys — **no secrets**.

## Testing

- Unit tests cover NDJSON lenience, empty bodies, `max_objects_per_run` cap, and strict line mode.
- Optional `@pytest.mark.minio` tests require `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` and a seeded bucket (see `docs/sources/s3-object-polling.md`).

## Documentation

- Operator-facing configuration and IAM permissions are documented under `docs/sources/s3-object-polling.md`.
