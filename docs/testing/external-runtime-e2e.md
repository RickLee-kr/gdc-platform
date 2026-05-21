# External runtime E2E

Continuous validation that the **StreamRunner** pipeline works end-to-end against real external fixtures (not mock-only adapter unit paths):

`Source → Mapping → Enrichment → Route fan-out → Destination delivery → delivery_logs → checkpoint update`

Polling sources use `POST /api/v1/runtime/streams/{id}/run-once`. **WEBHOOK_RECEIVER** uses `POST /api/v1/ingest/webhook/{receiver_key}` (still StreamRunner-backed).

## Services and ports

| Service | Role | Host port (loopback) |
| --- | --- | --- |
| `postgres-test` | Platform DB (`gdc` + `gdc_pytest` for pytest) | `55441` (default) |
| `wiremock-test` | Webhook delivery sink + failure stubs | `28080` |
| `webhook-receiver-test` | Optional HTTP echo | `18091` |
| `syslog-test` | Optional syslog sink | `15514` / `16514` |
| `minio-test` | S3-compatible object store | `59000` (API), `59001` (console) |
| `postgres-query-test` | `DATABASE_QUERY` fixture DB | `55433` |
| `sftp-test` | `REMOTE_FILE_POLLING` (user `gdc` / `devlab123`) | `22222` |

Compose file: `docker-compose.test.yml` (profiles `test`, `e2e`, `dev-validation`).

## Quick start

```bash
./scripts/testing/start-external-runtime-e2e-stack.sh
./scripts/test/run-external-runtime-e2e-tests.sh
```

Or pytest only (stack already up):

```bash
export TEST_DATABASE_URL="postgresql://gdc:gdc@127.0.0.1:55441/gdc_pytest"
export DATABASE_URL="$TEST_DATABASE_URL"
export WIREMOCK_BASE_URL="http://127.0.0.1:28080"
./scripts/testing/source-e2e/seed-fixtures.sh
python3 scripts/test/ensure_gdc_pytest_catalog.py
alembic upgrade head
python3 -m pytest -m e2e_runtime tests/test_external_runtime_e2e.py -v
```

## Pytest markers

| Marker | Meaning |
| --- | --- |
| `e2e_runtime` | Full external runtime suite (`tests/test_external_runtime_e2e.py`) |
| `e2e_external` | Same bucket (applied together on the module) |
| `minio` | Requires MinIO port open |
| `sftp` | Requires SFTP fixture |
| `webhook` | WEBHOOK_RECEIVER + WireMock delivery |
| `source_e2e` | Legacy/superset file `tests/test_source_adapter_e2e.py` (SYSLOG matrix + overlap) |

### Focused local runs (shorter)

```bash
python3 -m pytest -m "e2e_runtime and minio" tests/test_external_runtime_e2e.py -v
python3 -m pytest -m "e2e_runtime and webhook" tests/test_external_runtime_e2e.py -v
python3 -m pytest -m "e2e_runtime and sftp" tests/test_external_runtime_e2e.py -v
python3 -m pytest tests/test_external_runtime_e2e.py -k database_query -v
```

Default CI/local runner targets **~20 tests** in `test_external_runtime_e2e.py` (typically **2–5 minutes** with warm fixtures). The broader `source_e2e` module adds SYSLOG delivery matrix cases and is slower.

## Scenarios covered

| Area | Scenarios |
| --- | --- |
| **DATABASE_QUERY** | Initial ingest, incremental row insert, no-op poll, destination failure (checkpoint preserved), multi-route partial failure |
| **S3_OBJECT_POLLING** | Listing, `object_key_pattern`, duplicate skip, dynamic object upload, destination failure rollback |
| **REMOTE_FILE_POLLING** | New file, unchanged skip, modified file re-ingest, destination failure rollback |
| **WEBHOOK_RECEIVER** | JSON object/array/NDJSON, multi-route isolation, invalid auth, disabled stream, malformed payload, concurrent burst |
| **Observability** | `delivery_logs` stages, stream metrics, health score, logs page (no fake metric generators) |

## Checkpoint guarantees

- Checkpoint advances only after **successful** destination delivery (constitution / spec 002).
- Failed routes with `PAUSE_STREAM_ON_FAILURE` or unreachable webhooks leave checkpoint JSON unchanged.
- WEBHOOK_RECEIVER ingest does **not** persist checkpoint updates (`checkpoint_updated: false` by design).

## Environment variables

| Variable | Default |
| --- | --- |
| `TEST_DATABASE_URL` | `postgresql://gdc:gdc@127.0.0.1:55441/gdc_pytest` |
| `WIREMOCK_BASE_URL` | `http://127.0.0.1:28080` |
| `SOURCE_E2E_MINIO_ENDPOINT` | `http://127.0.0.1:59000` |
| `SOURCE_E2E_PG_FIXTURE_URL` | `postgresql://gdc_fixture:gdc_fixture_pw@127.0.0.1:55433/gdc_query_fixture` |
| `SOURCE_E2E_SFTP_HOST` / `PORT` | `127.0.0.1` / `22222` |
| `E2E_POLL_TIMEOUT_SEC` | `30` (helper polling) |
| `E2E_WAIT_TIMEOUT_SEC` | `90` (startup script) |

## Troubleshooting

- **All tests skipped**: run `./scripts/testing/start-external-runtime-e2e-stack.sh` and `./scripts/testing/wait-external-services.sh`.
- **WireMock 404**: tests register `POST /source-e2e/*` and use `/wiremock-integration/receiver-fail` for failure routes (see `tests/wiremock/mappings/template-receiver-fail.json`).
- **Stale MinIO/SFTP data**: `docker compose -f docker-compose.test.yml --profile test down -v` (test volumes only).
- **pytest refuses `gdc` catalog**: host pytest must use `gdc_pytest` (see `tests/conftest.py`).

## Related docs

- [Source adapter E2E](./source-adapter-e2e.md) — overlapping fixtures and `source_e2e` marker
- [Continuous test environment](./continuous-test-environment.md) — WireMock smoke/regression
- [E2E regression](./e2e-regression.md) — HTTP polling WireMock suite

## Limitations

- **PostgreSQL only** for platform and `DATABASE_QUERY` fixture (no SQLite).
- MySQL/MariaDB query fixtures are dev-validation-only, not in this suite.
- HTTP_API_POLLING vendor connectors are covered by WireMock regression, not this file.
- No browser/UI automation; API + fixture services only.
- Concurrent webhook burst is best-effort (5 parallel posts); not a load test.
