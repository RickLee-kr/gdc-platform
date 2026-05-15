# 038 — Release candidate deployment packaging

## Purpose

Define **operator-facing** release packaging for the Generic Data Connector Platform: scripted install/upgrade, PostgreSQL backup/restore, TLS material generation for the HTTPS compose path, CI validation workflows, and English deployment documentation.

## Non-goals

- Changing StreamRunner, checkpoint semantics, routing, or RBAC behavior.
- Replacing existing focused GitHub Actions workflows (`backend-focused.yml`, `frontend-focused.yml`, etc.); new workflows are additive CI validation entrypoints.
- Running heavy full E2E on every pull request.
- SQLite or any non-PostgreSQL catalog database.

## Requirements

### Release scripts (`scripts/release/`)

- `install.sh` — validate Docker + Compose v2; ensure `.env` from `.env.example` when missing; validate `DATABASE_URL` is PostgreSQL when set; optional TLS generation; run `alembic upgrade head` in the `api` image; start Compose.
- `upgrade.sh` — mandatory `backup-before-upgrade.sh`; `build --pull`; `alembic upgrade head`; rolling-style `up -d` for postgres → api → reverse-proxy (when defined) without volume deletion; prints rollback guidance.
- `backup-before-upgrade.sh` — `pg_dump` from the Compose `postgres` service; gzip; timestamp; refuse backup directories outside the repository root or obvious system roots.
- `restore.sh` — destructive restore with `RESTORE_CONFIRM=YES_I_UNDERSTAND` and interactive database-name confirmation; allowlisted database names (`gdc`, `gdc_test`); never removes Docker volumes automatically.
- `generate-self-signed-cert.sh` — write `server.crt` / `server.key` under `deploy/tls/` (or `GDC_TLS_OUTPUT_DIR`); refuse overwrite unless `GDC_TLS_OVERWRITE=1`.

### Compose alignment

- `docker-compose.platform.yml` and `deploy/docker-compose.https.yml` remain the canonical production-style stacks; PostgreSQL must not be published on the host in the HTTPS file.
- WireMock and other test-only services stay on Compose **profiles** in `docker-compose.yml`.

### CI

- Add `backend-tests.yml`, `frontend-tests.yml`, and `docker-validate.yml` under `.github/workflows/` for PostgreSQL-backed pytest, frontend test+build, compose `config` validation, optional ShellCheck on release scripts, and a lightweight private-key header scan.

### Documentation

- English guides under `docs/deployment/`: install, upgrade, backup/restore, release checklist; cross-link HTTPS reverse proxy documentation.

## Safety invariants

- PostgreSQL-only platform database policy.
- No automated deletion of user-created connectors, streams, destinations, routes, mappings, checkpoints, or seeds.
- No SQLite fallback.
- Release automation must not run `docker compose down -v` or equivalent volume-destructive commands.
