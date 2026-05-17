# Deployment readiness and development admin bootstrap

This page defines the readiness contract for supported development platform rebuilds.

## Canonical development admin contract

- Username: `admin`
- Password source: `GDC_SEED_ADMIN_PASSWORD`
- Development compose/start default: `Stellar1!`

`docker-compose.platform.yml`, `scripts/dev/start-platform.sh`, and `scripts/dev/validate-platform-ready.sh` all use the same source. If `GDC_SEED_ADMIN_PASSWORD` is unset in development, the compose/start path supplies `Stellar1!` so a persisted PostgreSQL volume cannot drift away from the expected login.

## Deterministic startup order

The development platform startup contract is:

1. PostgreSQL service is healthy.
2. API container runs `alembic upgrade head`.
3. API container runs `python -m app.db.seed --platform-admin-only --reconcile-admin-password`.
4. FastAPI starts and bootstraps development validation inventory when enabled.
5. Runtime telemetry is populated by the scheduler or by the readiness script's real `run-once` fallback.
6. `scripts/dev/validate-platform-ready.sh` validates service health, Alembic head, admin login, runtime activity, logs, and analytics.

Readiness is not allowed to pass only because an `admin` row exists. It must successfully call `POST /api/v1/auth/login` with `admin` and `GDC_SEED_ADMIN_PASSWORD`, then verify that `access_token` is present.

## Production safety

Production mode must not use default credentials. If `APP_ENV=production` or `APP_ENV=prod`, creating a missing `admin` requires `GDC_SEED_ADMIN_PASSWORD`.

Existing production admin password hashes are not reconciled by default. Use `--reconcile-admin-password` only for an explicit recovery operation, or `--reset-platform-admin-password` for the legacy forced reset path. Both require `GDC_SEED_ADMIN_PASSWORD` when an existing admin hash is changed.
