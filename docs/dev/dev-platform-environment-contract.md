# Developer platform environment contract

Single source of truth for local GDC Platform validation after reboot or rebuild.
Preserves Docker volumes, persisted admin passwords, and operator-created entities.

## One-command bootstrap

```bash
./scripts/dev/bootstrap-dev-platform.sh
```

Equivalent legacy entry (delegates to the same script):

```bash
./scripts/dev/start-platform.sh
```

Readiness check only:

```bash
./scripts/dev/validate-platform-ready.sh
```

## PostgreSQL catalogs and ports

| Port | Catalog | Role |
|------|---------|------|
| **55432** | `gdc` | Platform dev DB (API, Alembic default, UI, `[DEV VALIDATION]` / `[DEV E2E]` on platform) |
| **55440** | `gdc_ontology_test` | Ontology / metric pytest (isolated) |
| **55441** | `gdc_pytest` | Host smoke pytest default (`scripts/testing/_env.sh`) |

**Not** used for platform dev validation on the canonical workflow: port **55442** is the optional isolated validation-lab stack only (`scripts/validation-lab/start.sh`).

Host URLs:

- Platform: `postgresql://gdc:gdc@127.0.0.1:55432/gdc`
- Ontology pytest: `postgresql://gdc_ontology:gdc_ontology_pw@127.0.0.1:55440/gdc_ontology_test`
- Smoke pytest: `postgresql://gdc:gdc@127.0.0.1:55441/gdc_pytest`

## Fixture services and hostnames

Started by bootstrap on Docker network `gdc-dev-validation` (project `gdc-platform-test`, profile `dev-validation`):

| Service | Container DNS | Host port (when published) |
|---------|---------------|----------------------------|
| WireMock | `gdc-wiremock-test` | 28080 |
| Webhook echo | `gdc-webhook-receiver-test` | 18091 |
| Syslog sink | `gdc-syslog-test` | 15514 tcp/udp, 16514 tls |
| MinIO | `gdc-minio-test` | 59000 API, 59001 console |
| PostgreSQL query fixture | `gdc-postgres-query-test` | 55433 |
| MySQL / MariaDB query | `gdc-mysql-query-test`, `gdc-mariadb-query-test` | internal |
| SFTP / SCP | `gdc-sftp-test`, `gdc-ssh-scp-test` | 22222 |

Platform API (with overlay) resolves fixture hostnames on `gdc-dev-validation`. Embedded WireMock/webhook/syslog in `docker-compose.platform.yml` are not used for `[DEV VALIDATION]` when the overlay is active.

## Compose files and profiles

| Stack | Files | Notes |
|-------|-------|-------|
| Platform | `docker-compose.platform.yml` + `docker-compose.platform.dev-validation.yml` | Postgres 55432, api, frontend, reverse-proxy |
| Test / fixtures | `docker-compose.dev-validation.yml` → includes `docker-compose.test.yml`, profile `dev-validation` | Fixture services only (no `postgres-test` on 55432) |
| Pytest DBs | `docker-compose.test.yml`, profile `test` | `postgres-ontology-test` (55440), `postgres-test` (55441) |

Bootstrap does **not** run `docker compose down -v` or truncate platform data.

## Browser and API entrypoints

| Endpoint | Default |
|----------|---------|
| UI (nginx) | `http://127.0.0.1:18080` (`GDC_HTTP_PORT`) |
| HTTPS | `https://127.0.0.1:18443` |
| API direct | `http://127.0.0.1:8000` |

## Admin credential policy

- First install: username `admin`, password `admin` unless `GDC_SEED_ADMIN_PASSWORD` is set in `.env`.
- Bootstrap and API startup **never** overwrite an existing admin password hash.
- `must_change_password=true` remains after bootstrap reset (by design).
- Validation treats **credential drift** (admin exists, bootstrap password fails) as a **warning**, not a hard failure. Non-auth checks (DB, Alembic, fixtures, pytest DBs) still run.
- Hard failure: admin user missing.
- Override for auth/runtime checks:
  - `GDC_VALIDATE_ADMIN_PASSWORD='...' ./scripts/dev/validate-platform-ready.sh`
  - `./scripts/dev/validate-platform-ready.sh --admin-password '...'`
  - `./scripts/dev/validate-platform-ready.sh --skip-auth-check`

### Manual password reset (explicit only)

```bash
./scripts/admin/reset-admin-password.sh --username admin --password '<new-password-min-8-chars>'
```

Interactive prompt is used when `--password` is omitted. Requires typing `YES` unless `--yes`. Does not wipe the database.

## Dev validation seed behavior

| Prefix | Seeder | Idempotent |
|--------|--------|------------|
| `[DEV VALIDATION]` | API lab (`ENABLE_DEV_VALIDATION_LAB=true`) after fixtures are reachable | Yes — updates lab streams only |
| `[DEV E2E]` | `scripts/dev-validation/seed-visible-e2e-fixtures.sh` → `app.dev_validation_lab.visible_e2e_seed` | Yes — prefix-scoped rows only |
| External objects | `scripts/dev-validation/seed-lab-fixtures.sh` (MinIO, query DBs, SFTP) | Yes |

Bootstrap runs `alembic upgrade head`, seeds external fixtures, seeds `[DEV E2E]` when fewer than five streams exist, and restarts API once if `[DEV VALIDATION]` streams are missing.

## Validation sections

`validate-platform-ready.sh` reports:

1. Compose status  
2. DB readiness  
3. Alembic revision  
4. API health  
5. Admin auth  
6. Dev validation fixtures  
7. E2E visible fixtures  
8. Topology visibility  
9. pytest DB readiness  
10. Authenticated runtime API checks (when auth succeeds)

Exit: **FAIL** on API/DB down, migration not at head, missing required fixtures, missing admin user; **PASS with warnings** on credential drift only.

## Database URL (host vs container)

| Where you run commands | URL host | Docs |
|------------------------|----------|------|
| `docker compose exec api` | `postgres:5432` | In-network service name |
| Host shell / `alembic upgrade head` | `127.0.0.1:55432` (or auto-fallback from `@postgres`) | [database-url-resolution.md](./database-url-resolution.md) |

Helper: `./scripts/dev/alembic-upgrade.sh` (`--compose` or `--host`).

## Recovery commands

| Situation | Command |
|-----------|---------|
| Full rebuild after reboot | `./scripts/dev/bootstrap-dev-platform.sh` |
| Readiness only | `./scripts/dev/validate-platform-ready.sh` |
| Admin password unknown | `./scripts/admin/reset-admin-password.sh` then validate with `GDC_VALIDATE_ADMIN_PASSWORD` |
| Pytest DBs down | `./scripts/testing/start-test-stack.sh` |
| Ontology stack only | `./scripts/testing/start-ontology-test-stack.sh` |
| Stale API image / migration drift | `./scripts/dev/bootstrap-dev-platform.sh` (rebuilds api) |
| Optional isolated lab (55442) | `./scripts/validation-lab/start.sh` |

## Pytest and frontend

```bash
./scripts/testing/start-test-stack.sh   # if not already up from bootstrap
export TEST_DATABASE_URL=postgresql://gdc:gdc@127.0.0.1:55441/gdc_pytest
python3 -m pytest -q tests/test_audit_logs.py tests/test_visible_e2e_seed.py
cd frontend && npm run build
```

Ontology-only tests: `export TEST_METRIC_ONTOLOGY=true` (uses `.env.test.ontology` on port 55440).

Smoke/full backend: `TEST_DATABASE_URL` must target **55441** / `gdc_pytest`, not 55432.
