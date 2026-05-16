# 037 — Visible dev E2E UI fixtures

Path: `specs/037-visible-dev-e2e-fixtures/spec.md`

## Purpose

Provide an **optional, idempotent** workflow so operators can see and manually exercise
E2E-ready **Connector → Source → Stream → Mapping → Enrichment → Destination → Route**
chains in the product UI for all supported source kinds, using **only local lab services**.

## Scope

- **In scope**: PostgreSQL catalog rows with the `[DEV E2E] ` name prefix; loopback
  WireMock, MinIO, fixture PostgreSQL, SFTP test container, local webhook echo, and
  local syslog listeners (UDP/TCP/plain and TLS on the lab syslog container).
- **Out of scope**: Changing `StreamRunner`, checkpoint semantics, automatic DB reset,
  deleting or modifying user-created entities without the lab prefix, production
  databases, or any dependency on the public internet.

## Safety

- `DATABASE_URL` must be PostgreSQL on **127.0.0.1 / localhost / ::1** with user `gdc`.
- Allowed catalog database names: `datarelay`, `gdc_e2e_test` (port **55432**), or `gdc`
  (ports **5432** or **55432**) **only** when `--local-dev-mode` is passed explicitly.
- The seed refuses URLs that resemble managed/cloud hosts (heuristic substring checks).
- Implementation: `app/dev_validation_lab/visible_e2e_seed.py` and
  `scripts/dev-validation/seed-visible-e2e-fixtures.sh`.

## Operator docs

See `docs/testing/visible-dev-e2e-fixtures.md`.
