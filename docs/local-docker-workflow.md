# Local Docker workflow: platform stack vs development validation lab

This page separates two **different** local workflows. They use **different databases** and **different seeding**. Starting one does not configure the other.

| Aspect | Production-style **platform** stack | **Development validation lab** |
| --- | --- | --- |
| **Purpose** | HTTPS reverse proxy + API + Postgres similar to a packaged deploy; optional admin bootstrap | WireMock-backed synthetic connectors/streams/destinations/routes in the UI for local coding feedback |
| **Typical start** | `docker compose -f docker-compose.platform.yml up -d --build` (then migrations + optional admin seed — see below) | `./scripts/validation-lab/start.sh` |
| **Compose project / files** | Default project name for that `-f` file; `docker-compose.platform.yml` only | Project **`gdc-platform-test`**; `docker-compose.dev-validation.yml` (includes `docker-compose.test.yml`) |
| **API process** | `api` container (`gdc-platform-api`) | Host **uvicorn** on port **8000** (started by the lab script; not the platform `api` image unless you intentionally change it) |
| **PostgreSQL** | Service `postgres`, DB **`datarelay`**, host **55432→5432**, external volume **`gdc-platform-test_gdc_test_postgres_data`** | Service `postgres-test`, DB **`datarelay`**, host port **55432**, separate test volume |
| **`DATABASE_URL` inside API** | `postgresql://gdc:…@postgres:5432/datarelay` (from compose) | `postgresql://gdc:gdc@127.0.0.1:55432/datarelay` (set by lab start script) |
| **`[DEV VALIDATION]` rows** | Optional auto-seed when **`ENABLE_DEV_VALIDATION_LAB=true`** (default in `docker-compose.platform.yml`) and external **`gdc-test`** network exists — not the same as running **`./scripts/validation-lab/start.sh`** | Created after startup when the lab flags and `datarelay` DB are in use (see `docs/testing/dev-validation-lab.md`) |
| **Admin user seed** | Documented: `exec api python -m app.db.seed` after migrations | After each successful Alembic run on `datarelay`, `start-dev-validation-lab.sh` runs `python -m app.db.seed --platform-admin-only` (create-only `admin`; default password `Stellar1!` unless `GDC_SEED_ADMIN_PASSWORD` is set before start — see `docs/testing/dev-validation-lab.md`) |

If you only run `docker compose -f docker-compose.platform.yml up -d` (with or without `--force-recreate api`) without the **`gdc-test`** lab network and lab containers, the UI will **not** show full development validation lab connectors — that is expected unless the optional dev-validation seed path is satisfied.

---

## Production / platform startup

From the repository root:

```bash
docker compose -f docker-compose.platform.yml up -d --build
docker compose -f docker-compose.platform.yml run --rm api alembic upgrade head
docker compose -f docker-compose.platform.yml exec api python -m app.db.seed
```

- Browser entrypoint (nginx): **http://localhost:18080** (defaults; override with `GDC_ENTRY_HTTP_PORT`)
- Direct API (host): **http://localhost:${GDC_API_HOST_PORT:-8000}** (see `docker-compose.platform.yml` `api` ports)

Details, HTTPS, and smoke script: **`docs/docker-platform.md`**.

**What gets seeded:** `python -m app.db.seed` installs **application bootstrap** data (for example the admin account documented in `docs/docker-platform.md`). It does **not** install the WireMock **development validation lab** inventory (`[DEV VALIDATION]` names, `dev_lab_*` validation keys). Those exist only when you run the lab workflow against **`datarelay`**.

---

## Development validation lab startup

**Recommended one command** (Docker test stack, migrations on `datarelay`, uvicorn + Vite, API checks for lab markers):

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

**After a successful lab start,** `start.sh` / the underlying script polls `GET /api/v1/connectors/` and `GET /api/v1/validation/` until `[DEV VALIDATION]` and `dev_lab` markers appear (or prints a failure hint). The seeder is idempotent and creates connectors, streams, destinations, routes, and continuous validation definitions in **`datarelay`** only when the lab is enabled and `APP_ENV` is not production.

---

## Reseeding and backups

- **Do not** reset or drop databases that hold real operator data unless you have followed your own backup policy.
- **Dev lab database (`datarelay` on port 55432):** If you use `./scripts/validation-lab/reset-db.sh` (or `scripts/dev-validation/reset-dev-validation-db.sh`), take a **backup first** if you care about any custom rows in that DB, for example:

  ```bash
  pg_dump "postgresql://gdc:gdc@127.0.0.1:55432/datarelay" --format=custom --file=gdc_test_backup.dump
  ```

- **Platform database (`datarelay` in the platform Postgres volume):** For any destructive operation, use your normal `pg_dump` / volume snapshot procedure before proceeding.

---

## Troubleshooting

### Port 8000 already in use

Something else is bound to **8000** (often a host `uvicorn` from the validation lab, or a second stack). Either stop the other process, or for the **platform** API host publish only, set **`GDC_API_HOST_PORT`** (for example `8001`) when starting `docker-compose.platform.yml`. See comments at the top of `docker-compose.platform.yml`.

### API container is running but development connectors are missing

Typical cause: you started **`docker-compose.platform.yml`** without the lab’s Docker network/containers, or **`ENABLE_DEV_VALIDATION_LAB=false`**, so the full lab inventory never appears.

**Fix:** Run **`./scripts/validation-lab/start.sh`** when you need `[DEV VALIDATION]` entities. Stop the platform `api` container (or use another host port) if it conflicts with the lab’s host uvicorn on 8000.

### `gdc-wiremock` orphan container warning

- **`gdc-wiremock`** is the fixed `container_name` for the **default** `docker-compose.yml` **WireMock** service (profile **`test`**, host port **18080**). It is **not** part of `docker-compose.platform.yml` and **not** the lab’s WireMock (**`gdc-wiremock-test`** on **28080**).
- Warnings often appear when Compose sees containers from another project/profile. Clean up explicitly, for example:

  ```bash
  docker compose --profile test down
  # or: docker stop gdc-wiremock
  ```

Use **`docs/testing/dev-validation-lab.md`** for the lab’s ports (**28080** WireMock, **55432** Postgres). Optional **source expansion** fixtures (not started by the platform stack) publish **59000** MinIO, **55433** Postgres query DB, **33306**/**33307** MySQL/MariaDB, **22222** SFTP, **22223** SSH/SCP — see the same doc under *Optional source expansion*.

### PostgreSQL is healthy but “seed” / expected data seems missing

Clarify **which** Postgres and **which** seed:

| Symptom | Likely explanation |
| --- | --- |
| Platform **`postgres` healthy**, UI empty of lab items | Expected unless the validation lab (or optional platform dev-validation prerequisites) is running — see **`docs/docker-platform.md`** and **`docs/testing/dev-validation-lab.md`**. |
| Ran **`app.db.seed`** on platform, still no `[DEV VALIDATION]` | Expected: admin seed ≠ lab seed. |
| Lab **`postgres-test` healthy** but API shows no lab rows | Run **`./scripts/validation-lab/status.sh`**; check `.dev-validation-logs/backend.log` for `dev_validation_lab_*` stages. See **`docs/testing/dev-validation-lab.md`** → *UI shows no `[DEV VALIDATION]` items*. |

---

## Related documentation

- `docs/docker-platform.md` — HTTPS proxy stack, admin seed
- `docs/testing/dev-validation-lab.md` — lab commands, configuration, production separation
- `docs/operator-runbook.md` — host uvicorn + Vite (non-Docker) notes
