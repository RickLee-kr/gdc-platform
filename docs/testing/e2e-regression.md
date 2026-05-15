# WireMock E2E regression

PostgreSQL-backed end-to-end checks that exercise **StreamRunner**, HTTP sources, connector auth strategies, mapping, enrichment, route fan-out, **WEBHOOK_POST** delivery, `delivery_logs`, checkpoints, analytics, and health. Tests live under `tests/` and opt in via pytest markers.

For an isolated Docker test stack (alternate ports, dedicated volume) and watch-mode scripts, see `docs/testing/continuous-test-environment.md`.

## When to run

| Situation | Command |
| --- | --- |
| After small runtime / auth / delivery / checkpoint / mapping changes | `./scripts/test-e2e-smoke.sh` plus focused unit tests for touched modules |
| Before milestone or release-quality merges | `./scripts/test-e2e-full.sh` |
| Syslog TCP/UDP delivery against local receivers | `./scripts/test-e2e-syslog.sh` (also included in full regression) |
| Auth-only changes | `./scripts/test-e2e-auth.sh` |
| Checkpoint / pause / retry semantics | `./scripts/test-e2e-checkpoint.sh` |

Markers (see `pytest.ini`):

- `e2e_smoke` — one fast happy-path template run
- `e2e_regression` — full WireMock regression bucket (combined with other markers)
- `e2e_auth`, `e2e_delivery`, `e2e_checkpoint`, `e2e_retry` — focused subsets

Direct pytest examples:

```bash
pytest -m e2e_smoke -v
pytest -m e2e_regression -v
```

## Required services

1. **PostgreSQL** — set `TEST_DATABASE_URL` to a **dedicated** test database (recommended). `tests/conftest.py` resets the `public` schema per test function; never point this at production data.
2. **WireMock** — `docker compose --profile test up -d wiremock` (default admin URL `http://127.0.0.1:18080`, override with `WIREMOCK_BASE_URL`). Required for HTTP source stubs in both WireMock matrix tests and Syslog delivery E2E.

Scripts **do not** run `docker compose down -v` or remove named volumes.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Tests skipped (`WireMock not reachable`) | `docker compose --profile test ps` and port `18080` |
| DB connection errors | `TEST_DATABASE_URL` / `pg_isready`; schema tests use `reset_db` (PostgreSQL metadata sync per `tests/conftest.py`), migrated tests use `migrated_db_session` |
| Mapping upsert failures on WireMock | Ensure `tests/wiremock/mappings/template-*.json` each include a stable string `id` (UUID) |
| Flaky HTTP | Increase WireMock container resources; avoid sharing the test DB with a running API server |

## Adding a vendor / auth / data scenario

1. Add or extend **WireMock** JSON under `tests/wiremock/mappings/` (`template-*.json` with a unique `id`).
2. At runtime, tests call `ensure_template_wiremock_mappings` (see `tests/e2e_wiremock_helpers.py`) so Docker picks up new stubs without restarting the container.
3. Prefer **template instantiate** (`POST /api/v1/templates/{id}/instantiate`) or existing CRUD APIs so StreamRunner stays the execution path.
4. Assert **masked** secrets in connector reads and HTTP error payloads; never commit live credentials.
5. Register pytest markers on new tests (`e2e_regression` plus the narrow markers that apply).

## Syslog TCP/UDP (local receivers)

`tests/test_e2e_syslog_delivery.py` exercises **real** Syslog UDP/TCP delivery through **StreamRunner** (`POST /runtime/streams/{id}/run-once`) using in-process listeners (`tests/syslog_receiver.py`). Receivers bind to `127.0.0.1` with **ephemeral high ports** (no privileged port **514**), require no root, and do not use the public internet.

- Markers: `e2e_regression`, `e2e_delivery`, optional `e2e_smoke` (one fast UDP case), `e2e_checkpoint` / `e2e_retry` where applicable.
- Entry point: `./scripts/test-e2e-syslog.sh` or `pytest -m "e2e_delivery and e2e_regression" tests/test_e2e_syslog_delivery.py -v`.

**WEBHOOK_POST** coverage remains on WireMock; **SYSLOG_UDP** / **SYSLOG_TCP** are now additionally guarded by the same regression harness pattern (WireMock HTTP source + PostgreSQL `TEST_DATABASE_URL`).

### Remaining gaps

- **SYSLOG_TLS** and non-JSON syslog framing are not covered here (not in MVP adapters).
- **LOG_AND_CONTINUE** with syslog-only failure is not duplicated beyond existing webhook matrix cases.
- Multi-event batches and destination rate-limit throttling are not specifically asserted in the syslog file (covered elsewhere or unit-level).
- The **TCP retry success** case uses a **scoped pytest monkeypatch** on `socket.create_connection` for the syslog destination endpoint only (first attempt fails, second uses the real stack); it does not replace `SyslogSender` or destination adapters.
