# Continuous validation (synthetic operational checks)

## Purpose

Continuous validation exercises **real** `StreamRunner.run()` cycles against existing platform configuration (streams, routes, destinations, checkpoints). It answers: “Does auth → fetch → mapping → enrichment → delivery → checkpoint still behave as expected over time?”

This is **not** a substitute for unit tests or the WireMock-backed **E2E regression** suite (`docs/testing/e2e-regression.md`). Those prove correctness of isolated logic and vendor stubs. Continuous validation is **synthetic operations monitoring**: scheduled or on-demand probes that reuse production-like paths without inventing alternate runtimes.

## How it differs from E2E regression

| Aspect | E2E regression (WireMock) | Continuous validation |
| --- | --- | --- |
| Trigger | pytest, CI, operator scripts | In-process scheduler + REST `POST .../run` |
| Data | Dedicated `TEST_DATABASE_URL`, reset schema | Operator PostgreSQL (additive tables only) |
| Scope | Deterministic matrix across templates | Operator-defined streams + validation types |
| Evidence | `delivery_logs`, checkpoints, WireMock journals | Same runtime artifacts **plus** `validation_runs` history |

## Runtime rules (non-negotiable)

- **StreamRunner** is the only transaction owner for pipeline writes (`delivery_logs`, checkpoints). Validation code **never** commits inside the runner transaction.
- Validation persists **only** to `continuous_validations` and `validation_runs` after the runner session closes.
- **No checkpoint resets**, no synthetic shortcuts, no SQLite.

## Scheduler behavior

- A dedicated **Continuous validation scheduler** thread runs independently from the stream polling scheduler.
- Default supervisor interval: `VALIDATION_SUPERVISOR_INTERVAL_SEC` (see `app/config.py`).
- Each definition has `schedule_seconds`; a run is attempted when `now >= last_run_at + schedule_seconds` (or `last_run_at` is null).
- **Per-definition lock** prevents overlapping runs for the same validation id; concurrent attempts record a `validation_lock` stage row with `WARN` status.

## Validation types

- **AUTH_ONLY** — committed run without transport/auth failure; `no_events` is acceptable when fetch/auth succeeded.
- **FETCH_ONLY** — requires extracted events (`extracted_event_count > 0`); `no_events` yields `WARN`.
- **FULL_RUNTIME** — requires delivery success signals in `delivery_logs` for the correlated `run_id`, `run_complete`, and checkpoint movement when `expect_checkpoint_advance` is true.

## Failure interpretation

- **Consecutive failures** increment on `FAIL`, reset on `PASS`, unchanged on `WARN`.
- **Health** (`HEALTHY` / `DEGRADED` / `FAILING` / `DISABLED`) weights auth/source failures and checkpoint drift more heavily (see `app/validation/health.py`).
- **Drift** — `FULL_RUNTIME` flags failure when events were delivered but `checkpoint_updated` is false while advance is expected (matches platform semantics: checkpoint only after successful delivery).

## Internal webhook echo

Optional `VALIDATION_ECHO_QUERY_KEY` enables `POST /api/v1/validation/echo?key=...` for safe WEBHOOK_POST receipt checks. Operators prepend their public API base URL to the returned path. Without a key configured, echo endpoints reject requests.

## Safe production usage

- Use **dedicated validation streams** (or clones) when possible so probe traffic does not surprise upstream vendors.
- Prefer **echo** or non-production receivers for webhook/syslog targets.
- Do **not** point `TEST_DATABASE_URL` style reset tooling at production.
- Validation does **not** disable routes, pause streams, or mutate unrelated entities; it only reads and runs the configured stream.

## APIs

See `GET/POST /api/v1/validation*` in `app/validation/router.py` for list/detail/runs/manual run/enable/disable and built-in template metadata.

## UI

The SPA exposes **Continuous validation** under Operations with Overview, Runs, Failing, Auth, Delivery, and Checkpoints views (`frontend/src/components/validation/*`).
