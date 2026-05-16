# Source adapter E2E (S3, DATABASE_QUERY, REMOTE_FILE_POLLING)

This suite exercises non-HTTP sources against **local Docker fixtures** only (MinIO-compatible S3, isolated PostgreSQL for SQL queries, SFTP). It does not use AWS, external SFTP, or the operator production database.

## Services

| Service | Role | Published host port (bind address) |
| --- | --- | --- |
| `postgres-test` | PostgreSQL server: **`gdc_test`** (API/lab) + **`gdc_pytest`** (host pytest) | `127.0.0.1:55432` |
| `wiremock-test` | Webhook sink for delivery assertions | `127.0.0.1:28080` |
| `webhook-receiver-test` | Optional echo server | `127.0.0.1:18091` |
| `minio-test` | S3-compatible object store | `127.0.0.1:59000` (API), `127.0.0.1:59001` (console) |
| `postgres-query-test` | Fixture DB `gdc_query_fixture` for `DATABASE_QUERY` | `127.0.0.1:55433` |
| `sftp-test` | atmoz/sftp (`gdc` / `devlab123`, chroot `upload`) | `127.0.0.1:22222` |

Ports are bound to **loopback** in `docker-compose.test.yml` to avoid unintended exposure on the LAN.

## How to run locally

1. Ensure Docker is running.
2. From the repository root:

```bash
./scripts/test/run-source-e2e-tests.sh
```

Or manually:

```bash
source scripts/testing/_env.sh
docker compose -f docker-compose.test.yml up -d postgres-test wiremock-test webhook-receiver-test syslog-test minio-test postgres-query-test sftp-test
./scripts/testing/source-e2e/seed-fixtures.sh
export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://gdc:gdc@127.0.0.1:55432/gdc_pytest}"
export DATABASE_URL="$TEST_DATABASE_URL"
python3 scripts/test/ensure_gdc_pytest_catalog.py
alembic upgrade head
pytest -m source_e2e tests/test_source_adapter_e2e.py -v
```

## Environment overrides

| Variable | Default | Purpose |
| --- | --- | --- |
| `TEST_DATABASE_URL` | `postgresql://gdc:gdc@127.0.0.1:55432/gdc_pytest` | **Pytest-only** platform catalog (never `gdc_test` while the API uses it) |
| `WIREMOCK_BASE_URL` | `http://127.0.0.1:28080` | Webhook target host for WireMock |
| `SOURCE_E2E_MINIO_ENDPOINT` | `http://127.0.0.1:59000` | MinIO API URL |
| `SOURCE_E2E_MINIO_BUCKET` | `gdc-source-e2e` | Bucket created by the seed script |
| `SOURCE_E2E_PG_FIXTURE_URL` | `postgresql://gdc_fixture:gdc_fixture_pw@127.0.0.1:55433/gdc_query_fixture` | Fixture DB for `DATABASE_QUERY` tests |

## Troubleshooting

- **All tests skipped**: start the compose stack and wait until `postgres-test` is healthy; confirm `curl -sf "$WIREMOCK_BASE_URL/__admin/mappings"` works.
- **MinIO / SFTP / fixture DB skips**: run `./scripts/testing/source-e2e/seed-fixtures.sh` after containers are up; verify ports with `ss -lntp | grep -E '59000|55433|22222'`.
- **Connection errors from pytest to databases**: keep `host` as `127.0.0.1` when running pytest on the host (not inside the `pytest-runner` container unless you switch hosts to service DNS names).
- **Stale MinIO data**: remove the `gdc_minio_test_data` volume (see cleanup below).
- **WireMock 404 on webhook delivery**: the pytest module registers a permissive `POST /source-e2e/*` stub via `ensure_source_e2e_webhook_stub` before each run. For manual runs against WireMock, add the same mapping or send webhooks to `http://127.0.0.1:18091/...` (mendhak echo) which returns HTTP 200.

## Cleanup

Stop test stack (data volumes persist until removed):

```bash
docker compose -f docker-compose.test.yml --profile test down
```

Remove named volumes used by the test stack (destructive; **test data only**):

```bash
docker compose -f docker-compose.test.yml --profile test down -v
```
