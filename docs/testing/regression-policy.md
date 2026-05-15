# Regression testing policy

## Goals

- Catch regressions in **StreamRunner-backed** HTTP, auth, delivery, checkpoint, and mapping flows without changing product runtime semantics.
- Keep feedback loops short during development while preserving a stronger gate on `main` and nightly schedules.

## Suites

| Suite | Marker / scope | When |
| --- | --- | --- |
| Focused backend | `not wiremock_integration` | Most PRs touching `app/` without vendor HTTP stubs |
| E2E smoke | `e2e_smoke` | After runtime/auth/delivery/checkpoint/mapping changes |
| E2E full regression | `e2e_regression` (+ listed files) | Before large merges; nightly / `main` CI |

## Cursor-assisted work (testing matrix)

Align local runs with `docs/testing/cursor-development-workflow.md`:

- **Frontend-only**: frontend build + focused frontend tests when present.
- **Backend non-runtime**: focused pytest for the touched area.
- **Runtime / auth / mapping / delivery / checkpoint**: focused pytest + `./scripts/testing/run-smoke-tests.sh` (test stack required).
- **Large architecture or migration**: focused pytest + `./scripts/testing/run-full-regression.sh`.

### Continuous watch vs manual smoke

- `./scripts/testing/watch-e2e.sh` is a **development convenience**; it does not replace focused pytest for edited modules.
- Treat the watcher as a **trusted smoke signal** only when `smoke-last-status.txt` is `PASS` and `smoke-last-success.txt` is newer than the change under review; otherwise run `./scripts/testing/run-smoke-tests.sh` yourself.

## Infrastructure rules

- **PostgreSQL only** for E2E and CI services; no SQLite fallback.
- **Dedicated test database** via `TEST_DATABASE_URL` (see `tests/conftest.py`).
- **WireMock** required for HTTP source and webhook assertions; default local test stack uses port **28080** (`docker-compose.test.yml`).
- **Syslog E2E** uses in-process listeners inside pytest (see `docs/testing/e2e-regression.md`); the `syslog-test` compose service is a lightweight TCP/UDP sink for manual or network isolation checks only.

## Artifacts

- Local scripts write junit summaries and log tails under `.test-history/` (see `docs/testing/continuous-test-environment.md`).
- Failure-only artifact dirs: `run-smoke-tests.sh` and `watch-e2e.sh` populate `.test-history/artifacts/smoke/<timestamp>/` only when pytest exits non-zero.
- CI jobs print WireMock container logs on failure.

## Flaky signals

- `./scripts/testing/py/flaky_tracker.py` records **PASS→FAIL** transitions per test name into `.test-history/flaky-state.json` with a short human summary in `.test-history/flaky-summary.txt`. This is a heuristic, not analytics infrastructure.
- `watch-e2e.sh` prints coarse transition hints (`REGRESSION: PASS → FAIL`, `RECOVERY: FAIL → PASS`) when the previous cycle had a known `PASS`/`FAIL` state (see `scripts/testing/py/regression_transition.py`).

## Related specs

- `specs/014-wiremock-template-e2e/spec.md` — WireMock E2E scope
- `specs/018-continuous-test-environment/spec.md` — dev-only continuous test stack
