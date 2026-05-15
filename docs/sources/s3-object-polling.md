# S3 object polling source (S3_OBJECT_POLLING)

Poll an S3-compatible bucket (AWS S3, MinIO, etc.): list object keys under a prefix, fetch object bodies, parse JSON / NDJSON into events, and deliver them through the normal stream pipeline. Checkpoints advance **only after successful destination delivery** (platform-wide rule).

## Required IAM permissions (AWS)

The access key (or IAM user/role) must allow at least:

- `s3:ListBucket` on the target bucket (and prefix, if constrained by bucket policy)
- `s3:GetObject` on object keys under the configured prefix

MinIO uses the same operations with its policy model.

## Connector configuration example (MinIO, local)

| Field | Example | Notes |
| --- | --- | --- |
| Endpoint URL | `http://127.0.0.1:9000` | Match your MinIO API port |
| Bucket | `gdc-test-logs` | Must exist (or be creatable) |
| Region | `us-east-1` | Often ignored for MinIO; keep a sensible default |
| Access key | *(your MinIO user)* | |
| Secret key | *(your MinIO password)* | Never logged or returned by GET; UI masks as `********` when set |
| Prefix | `security/` or `waf/` | Optional filter; trailing slash recommended for “folder” style |
| Path-style access | **On** | Typical for MinIO |
| Use SSL | **Off** | Typical for plain HTTP local MinIO |

## Connector configuration example (AWS S3)

| Field | Example | Notes |
| --- | --- | --- |
| Endpoint URL | `https://s3.amazonaws.com` or regional endpoint | Use virtual-hosted style unless you require path-style |
| Bucket | `my-company-logs` | |
| Region | `eu-west-1` | Should match the bucket region |
| Prefix | `cloudtrail/` | Narrow listing scope |
| Path-style access | **Off** | Default for AWS virtual-hosted URLs |
| Use SSL | **On** | |

## Stream configuration

- **max_objects_per_run** (integer ≥ 1): maximum **objects** to fetch and parse in a single run after applying the checkpoint watermark. A single object may still produce many events (e.g. NDJSON). Additional objects remain for the next run.

- **strict_json_lines** (optional): when `true`, invalid NDJSON lines cause a fetch error instead of being skipped with structured logs.

## Object body formats

- **NDJSON**: one JSON object per non-empty line. By default, invalid lines are skipped and logged (`s3_ndjson_line_skipped`).
- **JSON array**: array of objects; non-object elements are rejected.
- **JSON object**: one record per object.
- **Empty object**: yields zero events (not an error).

## One-command MinIO + PostgreSQL E2E validation

From the repository root, with PostgreSQL and MinIO already running, export the variables below and run:

```bash
export TEST_DATABASE_URL='postgresql://USER:PASS@HOST:PORT/DBNAME'
export MINIO_ENDPOINT='http://127.0.0.1:9000'
export MINIO_ACCESS_KEY='...'
export MINIO_SECRET_KEY='...'
export MINIO_BUCKET='gdc-test-logs'

bash scripts/testing/minio/run-s3-e2e-validation.sh
```

The script checks the database and MinIO, seeds fixtures (`scripts/testing/minio/seed-minio-s3-fixtures.sh`), runs `tests/test_s3_object_polling.py`, then runs checkpoint tests with and without the `@pytest.mark.minio` marker. It stops on the first failure and prints a final OK/FAIL/SKIP summary.

### Required environment variables (E2E script)

| Variable | Purpose |
| --- | --- |
| `TEST_DATABASE_URL` | PostgreSQL URL used by pytest (dedicated test DB; see `tests/conftest.py` / testing docs). |
| `MINIO_ENDPOINT` | S3 API base URL (no trailing slash required), e.g. `http://127.0.0.1:9000`. |
| `MINIO_ACCESS_KEY` | MinIO access key. |
| `MINIO_SECRET_KEY` | MinIO secret key. |
| `MINIO_BUCKET` | Target bucket name (created by the seed script if missing and policy allows). |

Python dependencies are those of the repo test environment (`pytest`, `boto3`, `psycopg2-binary`, etc.; typically `pip install -r requirements.txt`).

### Example local command

```bash
cd ~/gdc-platform
export TEST_DATABASE_URL='postgresql://gdc:gdc@127.0.0.1:55432/gdc_test'
export MINIO_ENDPOINT='http://127.0.0.1:9000'
export MINIO_ACCESS_KEY='minioadmin'
export MINIO_SECRET_KEY='minioadmin'
export MINIO_BUCKET='gdc-test-logs'
bash scripts/testing/minio/run-s3-e2e-validation.sh
```

Adjust host, port, and credentials to match your compose or local services.

## MinIO local testing

1. Start MinIO (for example via your platform compose or a standalone MinIO container) and create an access key.
2. Export credentials and run the seed script from the repository root:

   ```bash
   export MINIO_ACCESS_KEY=...
   export MINIO_SECRET_KEY=...
   export MINIO_ENDPOINT=http://127.0.0.1:9000
   export MINIO_BUCKET=gdc-test-logs
   bash scripts/testing/minio/seed-minio-s3-fixtures.sh
   ```

3. In the UI, create a connector with source type **S3_OBJECT_POLLING**, using the same endpoint, bucket, prefix, path-style, and SSL flags as above.
4. Use **Test S3 connectivity** to confirm HeadBucket + list preview before saving.
5. Create a stream on that connector, complete mapping against sample events, attach a destination, enable the stream, and run once from Runtime (or your operator workflow). Verify delivery and checkpoint advance; a second run should skip already-checkpointed objects.

## Optional automated MinIO tests

For a single reproducible flow (Postgres check, MinIO check, seed, and all S3-related pytest steps), use `scripts/testing/minio/run-s3-e2e-validation.sh` (documented in the **One-command MinIO + PostgreSQL E2E validation** section above).

Pytest tests marked `@pytest.mark.minio` run only when `MINIO_ACCESS_KEY` and `MINIO_SECRET_KEY` are set. They call boto3 and the real `S3ObjectPollingAdapter` against your seeded bucket.

```bash
export MINIO_ACCESS_KEY=...
export MINIO_SECRET_KEY=...
pytest tests/test_s3_stream_runner_checkpoint.py -m minio -v
```

## Troubleshooting

- **403 / Access denied** on probe: check bucket policy and that `s3:ListBucket` / `s3:GetObject` are allowed.
- **NoSuchBucket**: wrong bucket name or wrong endpoint/region pairing.
- **Connection errors**: verify `endpoint_url`, `use_ssl`, and network reachability from the API container/host.

### E2E script and pytest

- **PostgreSQL connection refused** (`could not connect to server`, `Connection refused`): PostgreSQL is not listening on the host/port in `TEST_DATABASE_URL`, or a firewall/container network blocks the client. Confirm `pg_isready` or `psql "$TEST_DATABASE_URL" -c 'SELECT 1'`. For Docker, use the published port (for example `55432` on the host, not only the internal `5432` service name unless you run the script inside the same compose network).
- **MinIO auth failure** (`InvalidAccessKeyId`, `SignatureDoesNotMatch`, `AccessDenied` on `ListBuckets`): wrong `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY`, or clock skew if using TLS with strict validators. Re-check the user created in MinIO and that the endpoint matches the server you configured (no accidental `https` on plain HTTP).
- **Bucket not found** during tests after a successful `ListBuckets`: `MINIO_BUCKET` must match the bucket seeded by `seed-minio-s3-fixtures.sh`. If the seed step failed (policy denies `CreateBucket` / `PutObject`), fix IAM/policy and re-run the E2E script. Wrong bucket name also surfaces as missing keys or empty listings in adapter tests.
- **Pytest marker skip** (`SKIPPED` for `@pytest.mark.minio`): the MinIO integration test skips when `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` are unset inside the test process. The E2E script exports them for subprocesses; if you run pytest manually, export both variables in the same shell. If **no tests** match `-m minio`, register the `minio` marker in `pytest` configuration (see `pyproject.toml` / `pytest.ini`) so collection does not warn or error.
