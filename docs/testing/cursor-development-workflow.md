# Cursor development workflow (testing)

This document defines how to validate changes during GDC development. It applies to Cursor-assisted work and human contributors alike.

## Principles

- Use the **isolated test stack** (`docker-compose.test.yml`) for WireMock E2E so the developer platform PostgreSQL (for example `127.0.0.1:5432` from root `docker-compose.yml`) is never targeted by `TEST_DATABASE_URL`. Host pytest uses **`127.0.0.1:55432/gdc_pytest`** (see `tests/db_test_policy.py`); **`gdc_test`** on that port is for the API / validation lab.
- **Never** point `TEST_DATABASE_URL` at production or shared operator databases.
- Prefer **fail-fast** local runs (`-x`) while iterating; use full runs before large merges.

## Change-type matrix (mandatory local gates)

| Change | Local validation |
| --- | --- |
| Small **frontend-only** change | Frontend-focused checks: `cd frontend && npm run build`, plus any focused frontend/unit tests that cover the touched UI or hooks. |
| **Backend non-runtime** change (API, services, models outside execution pipeline) | Focused pytest for the touched area: `./scripts/testing/run-focused-tests.sh` and/or explicit `pytest` paths under `tests/`. |
| **Runtime / auth / mapping / delivery / checkpoint** change | Focused pytest for touched modules **and** smoke E2E: `./scripts/testing/start-test-stack.sh` then `./scripts/testing/run-smoke-tests.sh` (same selection as `e2e_smoke`). |
| **Large architecture or migration** change | Focused pytest **and** full regression: `./scripts/testing/run-full-regression.sh` (or CI `e2e_regression` on `main` / scheduled). |

## Optional continuous smoke (`watch-e2e.sh`)

`./scripts/testing/watch-e2e.sh` loops `e2e_smoke` on an interval (default **300s**; override `E2E_WATCH_INTERVAL_SEC`) and writes history under `.test-history/` (gitignored). See `docs/testing/continuous-test-environment.md` for start/stop and how to read the latest result.

### When a watcher is already running

- Cursor and contributors should **still run focused tests** (frontend build, or focused pytest) for whatever files changed.
- **Smoke** (`./scripts/testing/run-smoke-tests.sh`) or **full regression** (`./scripts/testing/run-full-regression.sh`) may be **skipped manually** only if **all** of the following hold:
  - `./scripts/testing/watch-e2e.sh` (or an equivalent loop) is **running and healthy**, and
  - `.test-history/latest/smoke-last-status.txt` is `PASS`, and
  - `.test-history/latest/smoke-last-success.txt` contains a timestamp **strictly after** the commit time of the code under review (i.e. a green cycle observed **after** your change).
- If there is no watcher, the watcher is stale, or the last PASS predates the change, **run smoke manually** (and full regression when the matrix above requires it).

## CI expectations

- Pull requests: backend-focused + frontend (path-filtered) + `e2e_smoke` where configured.
- `main` / scheduled: full `e2e_regression` workflow.

See also: `docs/testing/continuous-test-environment.md`, `docs/testing/regression-policy.md`, `docs/testing/e2e-regression.md`.
