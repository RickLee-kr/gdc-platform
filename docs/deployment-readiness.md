# Deployment readiness and development admin bootstrap

This page defines the readiness contract for supported development platform rebuilds.

## Canonical development admin contract

- Username: `admin`
- Default password: `admin`
- Optional password source: `GDC_SEED_ADMIN_PASSWORD`

`docker-compose.platform.yml`, `scripts/dev/start-platform.sh`, and `scripts/dev/validate-platform-ready.sh` all use the same source. If `GDC_SEED_ADMIN_PASSWORD` is unset, bootstrap creates `admin/admin` with `must_change_password=true`. Existing PostgreSQL volumes keep their current admin password.

## Deterministic startup order

The development platform startup contract is:

1. PostgreSQL service is healthy.
2. API container runs `alembic upgrade head`.
3. API container runs `python -m app.db.seed --platform-admin-only`.
4. FastAPI starts and bootstraps development validation inventory when enabled.
5. Runtime telemetry is populated by the scheduler or by the readiness script's real `run-once` fallback.
6. `scripts/dev/validate-platform-ready.sh` validates service health, Alembic head, admin login, runtime activity, logs, and analytics.

Readiness is not allowed to pass only because an `admin` row exists. By default it must successfully call `POST /api/v1/auth/login` with `admin` and the configured bootstrap password (from the environment, `.env`, or the first-install default `admin`), then verify that `access_token` is present.

When the persisted admin password no longer matches bootstrap sources (for example after an in-UI password change or a regenerated `.env`), validation reports **bootstrap credential drift** with recovery steps instead of a generic auth failure. Options:

- `./scripts/dev/validate-platform-ready.sh --admin-password '<current password>'` — full readiness including runtime APIs
- `./scripts/dev/validate-platform-ready.sh --skip-auth-check` — service/DB/Alembic/inventory checks only
- `./scripts/admin/reset-admin-password.sh` — interactive reset of the `admin` hash to `GDC_SEED_ADMIN_PASSWORD` (never automatic)

## Production safety

Production bootstrap uses the fixed default `admin/admin` when `GDC_SEED_ADMIN_PASSWORD` is unset, and immediately gates normal access with `must_change_password=true`.

Existing production admin password hashes are not reconciled by default. Use `--reconcile-admin-password` or `--reset-platform-admin-password` only for an explicit recovery operation. Both require `GDC_SEED_ADMIN_PASSWORD` when an existing admin hash is changed.
