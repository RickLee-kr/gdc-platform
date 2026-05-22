# Database URL resolution (host shell vs Docker Compose)

Platform PostgreSQL uses different hostnames depending on where commands run.

## URLs by environment

| Environment | Typical URL | Host resolves? |
|-------------|-------------|----------------|
| **API container** (`docker compose exec api`) | `postgresql://gdc:gdc@postgres:5432/gdc` | Yes (compose network DNS) |
| **Host shell** (Alembic, seeds, `python3 -m app.db.seed`) | `postgresql://gdc:gdc@127.0.0.1:55432/gdc` | Yes (published port) |
| **Host pytest** | `TEST_DATABASE_URL` → `127.0.0.1:55441/gdc_pytest` | Yes (test stack) |

`.env.example` documents the in-compose default (`@postgres:5432`). That hostname is **not** valid on the host OS unless you add manual DNS.

Published platform port (default **55432**): `GDC_PLATFORM_POSTGRES_HOST_PORT` in `.env` / `docker-compose.platform.yml`.

## Automatic resolution

`app/database_url_resolution.py` provides `resolve_runtime_database_url()`:

1. **pytest** — `TEST_DATABASE_URL` when `context` is `pytest` / `test`.
2. **Explicit host override** — `GDC_HOST_DATABASE_URL` or `DEV_DATABASE_URL`.
3. **Inside container** — `/.dockerenv` or `GDC_RUNTIME_IN_CONTAINER=true` → URL unchanged.
4. **Production** (`APP_ENV=production|prod`) — no silent rewrite.
5. **Development host shell** — if host is `postgres` (or `gdc-platform-postgres`) and DNS fails → `127.0.0.1:<GDC_PLATFORM_POSTGRES_HOST_PORT>`.

Used by:

- `alembic/env.py` (`context=alembic`)
- `app/database.py` (`context=runtime`)

Structured log when fallback applies:

```text
stage=database_url_host_fallback original_host=postgres resolved_host=127.0.0.1 resolved_port=55432
```

Disable fallback: `GDC_DATABASE_URL_HOST_FALLBACK=false`

## Running migrations

### Recommended — inside compose (always uses `postgres` service)

```bash
docker compose -f docker-compose.platform.yml -f docker-compose.platform.dev-validation.yml \
  exec -T api alembic upgrade head
```

Or:

```bash
./scripts/dev/alembic-upgrade.sh --compose
```

### Host shell (Phase 4 validation, local tools)

```bash
./scripts/dev/alembic-upgrade.sh --host
```

Or set an explicit URL and run Alembic:

```bash
export GDC_HOST_DATABASE_URL=postgresql://gdc:gdc@127.0.0.1:55432/gdc
alembic upgrade head
```

Bootstrap already runs compose migrations; host `alembic` is for ad-hoc upgrades when the API container is not used.

## Pytest

`tests/conftest.py` pins `TEST_DATABASE_URL` before imports and passes that URL to Alembic. Do **not** point pytest at catalog `gdc` on port 55432 (live platform DB). Use **55441** / `gdc_pytest`:

```bash
./scripts/testing/start-test-stack.sh
export TEST_DATABASE_URL=postgresql://gdc:gdc@127.0.0.1:55441/gdc_pytest
python3 -m pytest -q
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `could not translate host name "postgres"` | Host Alembic with compose-only `.env` | `./scripts/dev/alembic-upgrade.sh --host` or set `GDC_HOST_DATABASE_URL` |
| Migrations hit wrong catalog | `DATABASE_URL` points at `gdc` while running destructive pytest | Use `TEST_DATABASE_URL` on 55441 |
| Container Alembic fails on `127.0.0.1:55432` | `DATABASE_URL` overridden for host in api container | Remove override; use `@postgres:5432` inside compose |

## Related docs

- [dev-platform-environment-contract.md](./dev-platform-environment-contract.md) — ports, bootstrap, validation
- [../performance/runtime-snapshot-read-model-phase-4.md](../performance/runtime-snapshot-read-model-phase-4.md) — Phase 4 migration `20260522_0024_rt_ops_snap`
