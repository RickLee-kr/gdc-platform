# Continuous test environment (development only)

This repository provides **development and CI infrastructure** for automated regression checks. It is **not** a product feature: there are no platform APIs or UI for “E2E watch mode”.

## Components

| Component | Purpose |
| --- | --- |
| `docker-compose.test.yml` | Isolated Docker network, PostgreSQL **55432→5432**, WireMock **28080→8080**, HTTP echo **18091**, raw TCP/UDP sink **15514** (not a full syslog daemon), optional `pytest-runner` image |
| `scripts/testing/*.sh` | Start/stop/reset stack, smoke/regression runners, focused pytest, watch loop |
| `scripts/testing/py/*.py` | JUnit summaries, flaky transition tracker, watch stats |
| `.github/workflows/*.yml` | PR-focused tests, frontend build, `e2e_smoke`, scheduled / `main` `e2e_regression` |
| `.test-history/` (gitignored) | Local junit, logs, smoke history, compose log tails |

## Quick start

```bash
export COMPOSE_PROFILES=test
./scripts/testing/start-test-stack.sh
export TEST_DATABASE_URL=postgresql://gdc:gdc@127.0.0.1:55432/gdc_test
export WIREMOCK_BASE_URL=http://127.0.0.1:28080
./scripts/testing/run-smoke-tests.sh
```

Stop without deleting data:

```bash
./scripts/testing/stop-test-stack.sh
```

Explicit reset (removes **test** compose volumes only):

```bash
./scripts/testing/reset-test-stack.sh
```

## Watch mode (`watch-e2e.sh`)

`./scripts/testing/watch-e2e.sh` runs `e2e_smoke` on a loop (default interval **300s**, override with `E2E_WATCH_INTERVAL_SEC`).

- Writes per-cycle logs under `.test-history/smoke/` (`run-<UTC-timestamp>.log`, plus `latest.log`).
- Updates `.test-history/latest/smoke-last-status.txt` (`PASS` / `FAIL`).
- Updates `.test-history/latest/smoke-last-success.txt` on each successful cycle (ISO UTC timestamp).
- Sets `.test-history/latest/smoke-first-failure-ts.txt` when a failing streak starts; removed on the next `PASS`.
- Prints **REGRESSION: PASS → FAIL** / **RECOVERY: FAIL → PASS** when the prior stored status was `PASS` or `FAIL` and the new aggregate status **differs** (same-state cycles log `state PASS` / `state FAIL` in the `note=` field).
- On pytest non-zero exit, captures log tails and compose logs under `.test-history/artifacts/smoke/<timestamp>/`. **Artifacts are only created on failure** (same policy as `run-smoke-tests.sh`).
- JUnit for the latest cycle: `.test-history/latest/smoke-junit.xml`; human summary: `.test-history/latest/smoke-summary.md`.
- Flaky heuristic: `.test-history/flaky-summary.txt` (updated each cycle).

### Operational notes

| Task | How |
| --- | --- |
| **Start watch mode** | From repo root: `export COMPOSE_PROFILES=test` (if not already), ensure the test stack is up, then `./scripts/testing/watch-e2e.sh`. Optional: `E2E_WATCH_INTERVAL_SEC=60 ./scripts/testing/watch-e2e.sh` for faster feedback while iterating. |
| **Stop watch mode** | **Ctrl+C** in the terminal running the script. No extra cleanup is required for `.test-history/` (gitignored). |
| **Inspect latest result** | `cat .test-history/latest/smoke-summary.md` and `cat .test-history/latest/smoke-last-status.txt`. Full last run log: `.test-history/latest/smoke-last.log`. Archived runs: `ls .test-history/smoke/`. |
| **Know if Cursor can rely on the watcher** | Rely on it **only** for skipping a *manual* smoke rerun if: watcher is still running, `smoke-last-status.txt` reads `PASS`, and `smoke-last-success.txt` is **newer than** the code change under review. Otherwise run `./scripts/testing/run-smoke-tests.sh`. See `docs/testing/cursor-development-workflow.md`. |
| **Recommended interval (local dev)** | Default **300s** (5 min) balances CPU and fast enough drift detection. Use **60s** only for short validation windows or active debugging (more load on Docker + DB). |
| **Recommended interval (shared dev server)** | **600–900s** (10–15 min) or nightly smoke via CI, to avoid constant contention on shared `55432` / `28080` and shared `gdc_test` data. |

## Running pytest inside Docker

```bash
export COMPOSE_PROFILES=test
docker compose -f docker-compose.test.yml build pytest-runner
docker compose -f docker-compose.test.yml run --rm pytest-runner \
  python3 -m pytest -m e2e_smoke -v --tb=short \
  tests/test_wiremock_template_e2e.py tests/test_e2e_syslog_delivery.py
```

Internal URLs use service names (`postgres-test`, `wiremock-test`).

## Debugging failures

1. Read `.test-history/latest/smoke-last.log` or the archived `.test-history/smoke/run-*.log`.
2. Open `.test-history/latest/smoke-summary.md` (markdown junit summary).
3. Inspect `.test-history/artifacts/smoke/*/pytest-tail.txt` and `compose-tail.txt`.
4. Verify WireMock: `curl -sSf "$WIREMOCK_BASE_URL/__admin/mappings" | head`.
5. Verify PostgreSQL: `pg_isready -h 127.0.0.1 -p 55432 -U gdc -d gdc_test`.

## Relationship to continuous validation (product)

Synthetic operational validation (`continuous_validations`, `validation_runs`) is a **separate product subsystem** (see `docs/testing/continuous-validation.md`). The compose test stack here is **only** for pytest/CI and must not be confused with that scheduler.

## Development validation lab (optional UI + API seed)

For **additive** WireMock-backed lab entities that appear in the product UI while developing, see `docs/testing/dev-validation-lab.md` and `docker-compose.dev-validation.yml` (merges this test stack; use `--profile dev-validation`). This is distinct from the E2E watcher: it runs inside a live API process when explicitly enabled.

## Related documents

- `docs/testing/cursor-development-workflow.md`
- `docs/testing/regression-policy.md`
- `docs/testing/e2e-regression.md`
