# 036 Source adapter E2E (development platform)

## Purpose

Continuously verify `S3_OBJECT_POLLING`, `DATABASE_QUERY`, and `REMOTE_FILE_POLLING` through the normal **Connector → Source → Stream → Mapping → Enrichment → Route → Destination → Checkpoint** pipeline using **local fixtures only** (no AWS, no external SFTP, no production databases).

Direct **SYSLOG_UDP**, **SYSLOG_TCP**, and **SYSLOG_TLS** destination coverage (same pipeline assertions as webhook: `run-once`, `route_send_success`, checkpoint only after delivery) lives in `tests/test_source_adapter_e2e.py` alongside WEBHOOK_POST cases; TLS uses in-process self-signed material under `tmp_path` (see `tests/syslog_tls_helpers.py`), not committed certificates.

## Rules

- Fixture services live in `docker-compose.test.yml` under profiles **`test`** and **`dev-validation`** (MinIO, `postgres-query-test`, `sftp-test`).
- Platform catalog database remains `datarelay` on `postgres-test`; relational query fixtures use the isolated **`gdc_query_fixture`** database on `postgres-query-test`.
- Checkpoint semantics follow `specs/002-runtime-pipeline/spec.md` (update only after successful destination delivery).
- Tests are opt-in via pytest marker `source_e2e` and the script `scripts/test/run-source-e2e-tests.sh`.

## Operator entry points

- Documentation: `docs/testing/source-adapter-e2e.md`
- Seed: `scripts/testing/source-e2e/seed-fixtures.sh`
- Run: `scripts/test/run-source-e2e-tests.sh`
