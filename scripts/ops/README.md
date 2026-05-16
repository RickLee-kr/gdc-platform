# Operational helper scripts

All scripts in this directory are **non-destructive by default**: they either issue **read-only** HTTP calls or print documentation.

## `validate-migrations.sh`

Read-only Alembic / `alembic_version` consistency check (orphan revisions, head drift, `gdc` vs `gdc_test` URL warnings).

```bash
./scripts/ops/validate-migrations.sh --pre-upgrade
./scripts/ops/validate-migrations.sh --json --strict
```

Wraps `python -m app.db.validate_migrations` in the api container when Docker compose is available.

See `docs/operations/migration-recovery-runbook.md`.

## `audit-database-urls.sh`

Static grep of `DATABASE_URL` references and compose `POSTGRES_DB` values (no database connection).

## `retention_operator_helpers.sh`

Thin wrappers around the retention HTTP API:

- `retention_preview` — `GET /api/v1/retention/preview` (row counts and cutoffs).
- `retention_status` — `GET /api/v1/retention/status`.
- `retention_dry_run` — `POST /api/v1/retention/run` with `{"dry_run": true}`.

### Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `GDC_API_BASE` | `http://127.0.0.1:8000` | API origin (no trailing slash). |
| `GDC_API_TOKEN` | *(empty)* | Optional `Authorization: Bearer …` when `REQUIRE_AUTH=true`. |

### Examples

```bash
export GDC_API_BASE=https://gdc.example:18443
export GDC_API_TOKEN=your-jwt
./scripts/ops/retention_operator_helpers.sh retention_preview
./scripts/ops/retention_operator_helpers.sh retention_dry_run
```

See also `docs/operations/retention-policies.md`.
