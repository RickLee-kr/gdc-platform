# Local Docker workflow: platform stack vs development validation lab

This page separates the canonical full platform startup from the older standalone validation-lab workflow. Both use PostgreSQL identity `gdc/gdc/gdc`; host pytest still uses the separate `gdc_pytest` catalog.

| Aspect | Production-style **platform** stack | **Development validation lab** |
| --- | --- | --- |
| **Purpose** | HTTPS reverse proxy + API + Postgres similar to a packaged deploy; optional admin bootstrap | WireMock-backed synthetic connectors/streams/destinations/routes in the UI for local coding feedback |
| **Typical start** | `./scripts/dev/start-platform.sh` | `./scripts/validation-lab/start.sh` |
| **Compose project / files** | Default project name for that `-f` file; `docker-compose.platform.yml` only | Project **`gdc-platform-test`**; `docker-compose.dev-validation.yml` (includes `docker-compose.test.yml`) |
| **API process** | `api` container (`gdc-platform-api`) | Host **uvicorn** on port **8000** (started by the lab script; not the platform `api` image unless you intentionally change it) |
| **PostgreSQL** | Service `postgres`, DB **`gdc`**, host **55432→5432**, volume **`gdc_platform_postgres_data`** | Service `postgres-test`, DB **`gdc`**, host port **55442** by default, separate test volume |
| **`DATABASE_URL` inside API** | `postgresql://gdc:gdc@postgres:5432/gdc` (from compose) | `postgresql://gdc:gdc@127.0.0.1:55442/gdc` (set by lab start script) |
| **`[DEV VALIDATION]` rows** | Auto-seeded by default in `docker-compose.platform.yml`; runtime telemetry is validated by `scripts/dev/validate-platform-ready.sh` | Created after startup when the lab flags and `gdc` DB are in use (see `docs/testing/dev-validation-lab.md`) |
| **Admin user seed** | API startup runs `python -m app.db.seed --platform-admin-only` after migrations; missing `admin` uses password `admin` unless `GDC_SEED_ADMIN_PASSWORD` is explicitly set | After each successful Alembic run on `gdc`, `start-dev-validation-lab.sh` runs `python -m app.db.seed --platform-admin-only`; missing `admin` uses password `admin` unless `GDC_SEED_ADMIN_PASSWORD` is explicitly set |

`docker compose up -d` and `docker compose -f docker-compose.platform.yml up -d` both represent the full development platform. Use `./scripts/dev/validate-platform-ready.sh` when you need the stronger check that UI-facing runtime/logs/analytics data is non-empty.

---

## Production / platform startup

From the repository root:

```bash
./scripts/dev/start-platform.sh
```

- Browser entrypoint (nginx): **http://localhost:18080** (defaults; override with `GDC_HTTP_PORT`)
- Direct API (host): **http://localhost:${GDC_API_HOST_PORT:-8000}** (see `docker-compose.platform.yml` `api` ports)

Details, HTTPS, and smoke script: **`docs/docker-platform.md`**.

**What gets seeded:** platform startup creates the `admin` account only when missing, creates idempotent `[DEV VALIDATION]` inventory, then validation requires real `delivery_logs` through the runtime pipeline and a successful admin JWT login.

---

## Development validation lab startup

**Legacy standalone one command** (Docker test stack, migrations on `gdc`, uvicorn + Vite, API checks for lab markers):

```bash
./scripts/validation-lab/start.sh
```

Equivalent underlying script (same behavior; more verbose):

```bash
scripts/dev-validation/start-dev-validation-lab.sh
```

Supporting commands:

```bash
./scripts/validation-lab/status.sh
./scripts/validation-lab/stop.sh --with-docker
```

Full behavior, safety gates, and topology: **`docs/testing/dev-validation-lab.md`**.

**After a successful lab start,** `start.sh` / the underlying script polls `GET /api/v1/connectors/` and `GET /api/v1/validation/` until `[DEV VALIDATION]` and `dev_lab` markers appear (or prints a failure hint). The seeder is idempotent and creates connectors, streams, destinations, routes, and continuous validation definitions in **`gdc`** only when the lab is enabled and `APP_ENV` is not production.

---

## Reseeding and backups

- **Do not** reset or drop databases that hold real operator data unless you have followed your own backup policy.
- **Dev lab database (`gdc` on port 55442 by default):** If you use `./scripts/validation-lab/reset-db.sh` (or `scripts/dev-validation/reset-dev-validation-db.sh`), take a **backup first** if you care about any custom rows in that DB, for example:

  ```bash
  pg_dump "postgresql://gdc:gdc@127.0.0.1:55442/gdc" --format=custom --file=gdc_test_backup.dump
  ```

- **Platform database (`gdc` in the platform Postgres volume):** For any destructive operation, use your normal `pg_dump` / volume snapshot procedure before proceeding.

---

## Troubleshooting

### Port 8000 already in use

Something else is bound to **8000** (often a host `uvicorn` from the validation lab, or a second stack). Either stop the other process, or for the **platform** API host publish only, set **`GDC_API_HOST_PORT`** (for example `8001`) when starting `docker-compose.platform.yml`. See comments at the top of `docker-compose.platform.yml`.

### API container is running but development connectors are missing

Typical cause: **`ENABLE_DEV_VALIDATION_LAB=false`**, seed startup failed, or no runtime cycle has completed.

**Fix:** Run **`./scripts/dev/validate-platform-ready.sh`** for the canonical platform. Use **`./scripts/validation-lab/start.sh`** only for the older host-uvicorn/Vite lab.

### `gdc-wiremock` orphan container warning

`docker-compose.yml` now aliases the full platform, so stale orphan warnings usually indicate containers from an older checkout or profile. Inspect with `docker ps` and stop the old containers explicitly when needed.

### PostgreSQL is healthy but “seed” / expected data seems missing

Clarify **which** Postgres and **which** seed:

| Symptom | Likely explanation |
| --- | --- |
| Platform **`postgres` healthy**, UI empty of lab/runtime data | Run **`./scripts/dev/validate-platform-ready.sh`**; `/health` is intentionally lighter than the dev readiness contract. |
| Admin exists but login fails | Rebuild/restart through `./scripts/dev/start-platform.sh` or run the platform compose seed command; readiness now fails until `POST /api/v1/auth/login` returns an `access_token`. |
| Admin exists, still no `[DEV VALIDATION]` | Check `ENABLE_DEV_VALIDATION_LAB`, API startup logs, and the validation script output. |
| Lab **`postgres-test` healthy** but API shows no lab rows | Run **`./scripts/validation-lab/status.sh`**; check `.dev-validation-logs/backend.log` for `dev_validation_lab_*` stages. See **`docs/testing/dev-validation-lab.md`** → *UI shows no `[DEV VALIDATION]` items*. |

---

## Related documentation

- `docs/docker-platform.md` — HTTPS proxy stack, admin seed
- `docs/testing/dev-validation-lab.md` — lab commands, configuration, production separation
- `docs/operator-runbook.md` — host uvicorn + Vite (non-Docker) notes
