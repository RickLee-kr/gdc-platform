# 018 Continuous test environment (development infrastructure)

## Purpose

Provide **isolated** Docker Compose services, shell entry points, CI workflows, and local history for **pytest WireMock E2E** and related regression checks during GDC development. This is **not** a product/runtime feature: no platform APIs or operator UI are added for watch mode.

## Rules

- **PostgreSQL only** for the test database; never SQLite as a shortcut.
- Test stack must **not** bind or overwrite the default developer `postgres:5432` / `wiremock:18080` ports; use `docker-compose.test.yml` port mappings.
- **No** changes to StreamRunner transaction ownership, checkpoint semantics, or delivery order (see constitution and `specs/002-runtime-pipeline/spec.md`).
- **No** destructive operations against operator databases; `reset-test-stack.sh` only removes compose-managed **test** volumes for this project name.
- E2E remains **real pytest execution** against WireMock and PostgreSQL; no bypass of the regression harness.

## Deliverables

- `docker-compose.test.yml` — `postgres-test`, `wiremock-test`, `webhook-receiver-test`, `syslog-test` (raw TCP/UDP sink), `pytest-runner`.
- `scripts/testing/` — start/stop/reset, smoke/regression/focused runners, `watch-e2e.sh`.
- `.test-history/` — local artifacts (gitignored); optional flaky transition files.
- `.github/workflows/` — backend-focused, frontend build, `e2e-smoke`, `e2e-regression`.
- Operator docs under `docs/testing/continuous-test-environment.md`, `regression-policy.md`, `cursor-development-workflow.md`.

## References

- WireMock E2E scope: `specs/014-wiremock-template-e2e/spec.md`
- Operator E2E notes: `docs/testing/e2e-regression.md`
