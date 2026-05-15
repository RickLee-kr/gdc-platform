# 014 WireMock template E2E

## Purpose

Extend opt-in WireMock-backed pytest coverage so **template instantiation** materializes normal platform rows, then **run-once** validates the full pipeline against stubbed HTTP vendors, **WEBHOOK_POST** receivers (WireMock), and **SYSLOG_UDP** / **SYSLOG_TCP** receivers (**local in-process listeners**, not WireMock syslog).

## Rules

- Templates remain **configuration generators only** (see `specs/013-template-connector-system/spec.md`); tests call `POST /api/v1/templates/{id}/instantiate` then standard runtime APIs.
- No StreamRunner transaction ownership changes; checkpoint semantics follow `specs/002-runtime-pipeline/spec.md`.
- Tests require Docker WireMock (`docker compose --profile test up -d wiremock`) and optional `WIREMOCK_BASE_URL`; they skip when WireMock is unreachable.
- `TEST_DATABASE_URL` / `tests/conftest.py` isolated DB patterns apply; tests must not target operator production databases.

## Mappings

Additional stubs under `tests/wiremock/mappings/` complement `specs/005-wiremock-integration/spec.md`. Each `template-*.json` file carries a stable WireMock mapping `id` (UUID string) so pytest can **upsert** stubs at runtime via `POST /__admin/mappings` (Docker containers otherwise only load JSON from disk at process start).

- Generic REST template paths (`/api/v1/events`, optional `/generic/events`).
- Stellar Malop `POST` search path used by the Malop template.
- Okta OAuth2 token and System Log `GET` paths.
- Webhook receiver variants (success, hard failure, scenario-based retry-once).

## Syslog delivery E2E (local TCP/UDP)

- `tests/syslog_receiver.py` — lightweight UDP/TCP listeners on `127.0.0.1` with **ephemeral high ports** (no privileged **514**), safe for pytest parallel runs when each test binds its own port.
- `tests/e2e_syslog_helpers.py` — fixtures (`syslog_udp_receiver`, `syslog_tcp_receiver`, flaky TCP), destination factory helpers, wait helpers.
- `tests/test_e2e_syslog_delivery.py` — HTTP source (WireMock) → mapping → enrichment → syslog delivery; fan-out with webhook; `PAUSE_STREAM_ON_FAILURE` without checkpoint advance; **TCP retry success** uses a real local TCP receiver plus `RETRY_AND_BACKOFF`, with a **pytest monkeypatch** that forces the **first** `socket.create_connection` call to fail once (transport only; `SyslogSender` / adapters unchanged) so `route_retry_success` and checkpoint advance are deterministic.

## Assertions

Success paths assert created IDs, `run-once` success, `delivery_logs` stages (`run_started`, `route_send_success`, `checkpoint_update`, `run_complete`), `run_id` correlation, checkpoint `last_success_event`, WireMock-received JSON containing mapped and enrichment fields, and read-only analytics/health where applicable.

Auth failure (HTTP 4xx on source fetch) asserts `run-once` HTTP error, no checkpoint advance, and **no persisted `delivery_logs`** for that run (exception rollback per runtime policy); API error detail must use masked outbound headers when present.

Destination failure with a blocking failure policy asserts no checkpoint advance, `route_send_failed` in logs, and analytics failure counts.

Retry path uses `RETRY_AND_BACKOFF` with destination `retry_count: 0` so StreamRunner performs the retry loop; WireMock scenario yields fail then success. Syslog TCP retry path uses a **local TCP listener** plus a **one-shot** `socket.create_connection` monkeypatch (see `tests/test_e2e_syslog_delivery.py`) instead of WireMock.

## Limitations

- `LOG_AND_CONTINUE` absorbs delivery failures but may still advance checkpoint when other routes succeed; blocking-failure tests use `PAUSE_STREAM_ON_FAILURE` (or similar) to assert no checkpoint advance.
- Root `delivery_logs` auth failure rows are not expected on exception rollback; observability is via HTTP error payload and application logger.
- Syslog E2E does not cover **SYSLOG_TLS**, CEF/LEEF wire formats, or syslog over the public internet (localhost-only).
- Syslog **TCP retry success** uses a **scoped** `socket.create_connection` monkeypatch for the destination `(host, port)` so the first TCP attempt fails deterministically without replacing `SyslogSender` or destination adapters.

## Regression markers

Pytest markers (registered in `pytest.ini`) group WireMock E2E coverage:

- `e2e_smoke` — minimal post-change verification (template generic happy path).
- `e2e_regression` — full WireMock regression selection (used with `wiremock_integration`).
- `e2e_auth`, `e2e_delivery`, `e2e_checkpoint`, `e2e_retry` — focused subsets for targeted runs.

Shell entry points (fail fast, no volume teardown):

- `scripts/test-e2e-smoke.sh`
- `scripts/test-e2e-full.sh`
- `scripts/test-e2e-auth.sh`
- `scripts/test-e2e-checkpoint.sh`
- `scripts/test-e2e-syslog.sh` — `pytest -m "e2e_delivery and e2e_regression" tests/test_e2e_syslog_delivery.py -v`

Operator documentation: `docs/testing/e2e-regression.md`.

## Cursor change verification

After modifying runtime, connector auth, delivery, checkpoint, or mapping code:

1. Run focused unit tests for touched modules.
2. Run `./scripts/test-e2e-smoke.sh` (or `pytest -m e2e_smoke -v`).

Before completing a milestone or large merge-quality change:

1. Run `./scripts/test-e2e-full.sh` (or `pytest -m e2e_regression -v` for the WireMock suite listed in `docs/testing/e2e-regression.md`).
