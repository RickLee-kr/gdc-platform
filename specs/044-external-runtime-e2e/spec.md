# 044 External runtime E2E (real fixtures)

## Purpose

Opt-in pytest coverage that validates the **StreamRunner** runtime pipeline against real external services (MinIO, fixture PostgreSQL, SFTP, WireMock), not mock-only adapter shortcuts.

## Scope

- `tests/test_external_runtime_e2e.py` with markers `e2e_runtime`, `e2e_external`, `minio`, `sftp`, `webhook`
- Shared helpers `tests/e2e_runtime_helpers.py`
- Compose profile `e2e` on `docker-compose.test.yml` (same services as `test` fixtures)
- Scripts: `scripts/testing/start-external-runtime-e2e-stack.sh`, `scripts/testing/wait-external-services.sh`, `scripts/test/run-external-runtime-e2e-tests.sh`
- Operator doc: `docs/testing/external-runtime-e2e.md`

## Non-goals

- Bypassing StreamRunner or alternate E2E-only execution paths
- SQLite or non-PostgreSQL platform DB
- Fake runtime metric generators

## Architecture alignment

- Checkpoint after successful delivery only (`specs/002-runtime-pipeline/spec.md`)
- Source adapters via `SourceAdapterRegistry` (`specs/001-core-architecture/spec.md`)
- Mapping / Enrichment separation preserved
- Structured `delivery_logs` for committed outcomes

## Overlap

`tests/test_source_adapter_e2e.py` (`source_e2e`) remains for SYSLOG delivery matrix and historical CI; new work should prefer `e2e_runtime` for pipeline + observability scenarios.
