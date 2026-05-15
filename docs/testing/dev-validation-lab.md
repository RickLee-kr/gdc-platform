# Development validation lab

## Purpose

The **development validation lab** is an **additive, development-only** subsystem that seeds WireMock-backed connectors, streams, routes, destinations, and `continuous_validations` definitions so operators can **see synthetic health directly in the GDC UI** (Connectors, Streams, Runtime, Validation, Logs, Analytics). It exercises **real** `StreamRunner` cycles and the continuous validation scheduler — it does **not** bypass the runtime, fake executions, or change checkpoint semantics.

This is **not** production customer data and **not** a substitute for the pytest WireMock E2E suite (`docs/testing/e2e-regression.md`). E2E remains the regression harness; the lab is for **local visual feedback** while coding.

**If you started `docker compose -f docker-compose.platform.yml …` and the lab UI is empty:** that stack points at **`gdc`** with lab seeding **disabled** by design. Switch to **`./scripts/validation-lab/start.sh`** for `[DEV VALIDATION]` data. Full comparison: **`docs/local-docker-workflow.md`**.

## TL;DR — three commands

Operators only need three commands. All other steps (Docker stack up, Alembic migrations, backend, frontend, API verification) happen inside `start.sh`.

```bash
# Start everything (Docker, migrations, backend, frontend, API checks)
./scripts/validation-lab/start.sh

# Check health (Docker, backend, frontend, [DEV VALIDATION] counts, latest failures)
./scripts/validation-lab/status.sh

# Stop backend + frontend, optionally also Docker (volumes always preserved)
./scripts/validation-lab/stop.sh --with-docker
```

Troubleshooting (only when `start.sh` explicitly reports schema drift on `gdc_test`):

```bash
./scripts/validation-lab/reset-db.sh
```

`reset-db.sh` is **destructive** and is **never auto-invoked**. It refuses to run unless the URL points at the isolated lab DB (`gdc_test` on `127.0.0.1:55432`, user `gdc`) and requires typing `RESET GDC TEST DB` to confirm. Docker volumes are not removed.

## What each command does

### `start.sh`

1. Brings up the Docker test stack via `docker-compose.dev-validation.yml` with project name **`gdc-platform-test`**: PostgreSQL **55432**, WireMock **28080**, HTTP echo **18091**, syslog sink **15514**.
2. Waits until PostgreSQL accepts connections.
3. Runs **`alembic upgrade head`** against `TEST_DATABASE_URL`. On schema drift (duplicate-table / missing `alembic_version` / "target database is not up to date") it **stops** and prints exactly one reset command — it never silently continues or auto-resets.
4. Exports the lab environment to the API process:
   - `ENABLE_DEV_VALIDATION_LAB=true`
   - `DEV_VALIDATION_AUTO_START=true`
   - `TEST_DATABASE_URL=postgresql://gdc:gdc@127.0.0.1:55432/gdc_test` (also used as `DATABASE_URL` for this process)
   - `WIREMOCK_BASE_URL=http://127.0.0.1:28080`
   - `DEV_VALIDATION_WIREMOCK_BASE_URL=http://127.0.0.1:28080`
   - `DEV_VALIDATION_WEBHOOK_BASE_URL=http://127.0.0.1:18091`
   - `DEV_VALIDATION_SYSLOG_HOST=127.0.0.1`, `DEV_VALIDATION_SYSLOG_PORT=15514`
5. Ensures **`platform_users` admin** exists (create-only via `python -m app.db.seed --platform-admin-only` against `gdc_test`). Default password is **`Stellar1!`** unless you export **`GDC_SEED_ADMIN_PASSWORD`** before starting. Existing `admin` rows are never overwritten.
6. Starts **uvicorn** on `0.0.0.0:8000`, waits for `/health`.
7. Polls `GET /api/v1/connectors/` and `GET /api/v1/validation/` for the lab markers (`[DEV VALIDATION]`, `template_key` starting with `dev_lab`).
8. Starts Vite with `VITE_API_BASE_URL=http://127.0.0.1:8000` so the SPA at `http://127.0.0.1:5173` talks to the lab API.
9. Prints the URLs and the `status` / `stop` / `restart` commands. PID files live under `.dev-validation-logs/`.

Ctrl+C stops the backend and frontend processes. Docker containers keep running unless you also pass `--with-docker` to `stop.sh`.

### `status.sh` (read-only)

Single-screen triage view:

- Docker test stack (containers and host ports)
- Backend reachable (`/docs`, `/health`)
- Frontend reachable (`http://127.0.0.1:5173`)
- Direct DB diagnostics for `gdc_test` (Alembic version, public table count)
- `GET /api/v1/runtime/status` schema readiness summary
- **`[DEV VALIDATION]` connector count** from `GET /api/v1/connectors/`
- **`dev_lab` validation definition count** from `GET /api/v1/validation/`
- **Latest validation failures** from `GET /api/v1/validation/failures/summary` (failing/degraded counts, open alert counts, top 10 open alerts)
- Recent `dev_validation_lab_*` / `startup_database_*` lines from `backend.log`
- Newest log files under `.dev-validation-logs/`

### `stop.sh`

Stops the backend and frontend processes using PID files in `.dev-validation-logs/`. With `--with-docker`, also runs `docker compose stop` on the test stack. **Never** removes Docker volumes; `gdc_test` data is preserved between sessions.

### `reset-db.sh` (destructive, manual only)

`DROP SCHEMA public CASCADE` / `CREATE SCHEMA public` on `gdc_test`, then `alembic upgrade head`. Refuses to run against anything other than the lab DB. Requires typing `RESET GDC TEST DB`. Use only when `start.sh` told you to.

## Optional source expansion (S3 / DATABASE_QUERY / REMOTE_FILE)

Beyond WireMock HTTP traffic, the lab can exercise **object polling**, **relational query sources**, and **SFTP remote file polling** when you opt in with **separate flags** (all default `false` in `app/config.py`; `scripts/dev-validation/start-dev-validation-lab.sh` exports the same defaults unless you override them).

1. Ensure the **`dev-validation`** Compose profile is up so optional containers exist (`minio-test`, `postgres-query-test`, `mysql-query-test`, `mariadb-query-test`, `sftp-test`, `ssh-scp-test`). They live only in `docker-compose.test.yml` and never ship with `docker-compose.platform.yml`.
2. Export the slice flags you need, for example:

   ```bash
   export ENABLE_DEV_VALIDATION_S3=true
   export ENABLE_DEV_VALIDATION_DATABASE_QUERY=true
   export ENABLE_DEV_VALIDATION_REMOTE_FILE=true
   export ENABLE_DEV_VALIDATION_PERFORMANCE=true
   ```

3. Run fixture scripts (published ports match `docker-compose.test.yml`):

   ```bash
   ./scripts/testing/source-expansion/seed-s3-fixtures.sh
   ./scripts/testing/source-expansion/seed-database-fixtures.sh
   ./scripts/testing/source-expansion/seed-remote-file-fixtures.sh
   ```

4. Restart the lab API so `seed_dev_validation_lab` runs again. The **Validation** overview includes a **“Dev validation — S3 / database / remote file smoke”** table. With `ENABLE_DEV_VALIDATION_PERFORMANCE=true`, each `dev_lab_*` validation stores `last_perf_snapshot_json` (run duration, extracted/delivered counts, average route latency, error count) after scheduled or manual runs — **smoke only**, not a benchmark harness.

When a slice flag is `false`, the scheduler and lab auto-start **skip** matching `dev_lab_*` rows so disabled integrations do not generate noise.

Normative one-pager: `specs/032-dev-validation-lab-source-expansion/spec.md`.

## Production separation

This subsystem is **development-only** by construction. Multiple independent guards prevent the lab from running in production:

| Layer | Guard |
| --- | --- |
| `app/config.py` | `ENABLE_DEV_VALIDATION_LAB` defaults to **`False`**. |
| `app/dev_validation_lab/seeder.py:lab_effective()` | Returns `False` whenever `APP_ENV` is `production` or `prod`, **regardless** of `ENABLE_DEV_VALIDATION_LAB`. |
| `app/dev_validation_lab/runtime.py` | Logs `dev_validation_lab_seed_skipped` with reason `production_app_env` or `lab_disabled`; no seeding, no auto-start. |
| Compose split | `docker-compose.yml` (production-flavored) contains only `postgres`; WireMock is gated behind the `test` profile and is **not** in the default service set. The lab stack (`postgres-test`, `wiremock-test`, `webhook-receiver-test`, `syslog-test`) lives in `docker-compose.test.yml` / `docker-compose.dev-validation.yml` with project name `gdc-platform-test`, so it never shares the production project. |
| Database isolation | Lab seeding only runs against `gdc_test` on `127.0.0.1:55432`. `reset-db.sh` refuses any other URL. |

### Production checklist

When packaging or deploying production:

- **Do NOT set** `ENABLE_DEV_VALIDATION_LAB=true` in the production environment.
- **Do NOT set** `DEV_VALIDATION_AUTO_START=true` in the production environment.
- Set `APP_ENV=production` (or `prod`) — this is a hard kill-switch even if the lab flag is accidentally enabled.
- **Do NOT include** WireMock, the HTTP echo receiver (`mendhak/http-https-echo`), the syslog test sink, or any other lab-only test service in production Compose / Helm / Kubernetes manifests. The `wiremock` service in `docker-compose.yml` is intentionally behind the `test` profile and must not be promoted by removing the profile.
- The **validation engine itself (`continuous_validations`)** stays in production — it is general infrastructure used for real connector health checks. Only the seeded `[DEV VALIDATION]` rows and the supporting WireMock/echo/syslog mocks are dev-only.
- After deploy, confirm by hitting `GET /api/v1/connectors/` — it must contain **zero** rows whose name starts with `[DEV VALIDATION] `. If any appear, the production DB was contaminated by an earlier non-production run; clean by `DELETE FROM connectors WHERE name LIKE '[DEV VALIDATION]%'` (scoped to the operator's normal release process). The seeder will not recreate them when the lab is disabled.

## Configuration reference

| Variable | Default | Description |
| --- | --- | --- |
| `ENABLE_DEV_VALIDATION_LAB` | `false` | Master switch; must be explicit. **Leave unset/false in production.** |
| `DEV_VALIDATION_AUTO_START` | `false` | After seed + WireMock sync, run each lab `continuous_validations` row once (fail-open). |
| `DEV_VALIDATION_WIREMOCK_BASE_URL` | `http://127.0.0.1:18080` | WireMock admin + stubs (use `28080` for the isolated lab stack). |
| `DEV_VALIDATION_WEBHOOK_BASE_URL` | `http://127.0.0.1:18091` | `http-https-echo` receiver. |
| `DEV_VALIDATION_SYSLOG_HOST` | `127.0.0.1` | Syslog UDP/TCP test sink host. |
| `DEV_VALIDATION_SYSLOG_PORT` | `15514` | Mapped port for `syslog-test`. |
| `ENABLE_DEV_VALIDATION_S3` | `false` | Optional MinIO slice; requires `MINIO_*` credentials. |
| `ENABLE_DEV_VALIDATION_DATABASE_QUERY` | `false` | Optional fixture Postgres/MySQL/MariaDB lab streams. |
| `ENABLE_DEV_VALIDATION_REMOTE_FILE` | `false` | Optional SFTP + SFTP-compatible SCP lab streams; requires `DEV_VALIDATION_SFTP_PASSWORD` / `DEV_VALIDATION_SSH_SCP_PASSWORD`. |
| `ENABLE_DEV_VALIDATION_PERFORMANCE` | `false` | When `true`, persist `last_perf_snapshot_json` on validation rows for dev smoke metrics. |
| `MINIO_ENDPOINT` | `http://127.0.0.1:9000` | Override to `http://127.0.0.1:59000` for `minio-test`. |
| `DEV_VALIDATION_PG_QUERY_HOST` / `DEV_VALIDATION_PG_QUERY_PORT` | `127.0.0.1` / `55433` | Fixture PostgreSQL (not `gdc_test`). |
| `DEV_VALIDATION_MYSQL_QUERY_PORT` | `33306` | Fixture MySQL. |
| `DEV_VALIDATION_MARIADB_QUERY_PORT` | `33307` | Fixture MariaDB. |
| `DEV_VALIDATION_SFTP_*` / `DEV_VALIDATION_SSH_SCP_*` | see `app/config.py` | SSH endpoints for remote file lab (SCP slice uses `protocol: sftp_compatible_scp`). |
| `GDC_SEED_ADMIN_PASSWORD` | (unset → lab default `Stellar1!` in `start-dev-validation-lab.sh`) | Used only when creating missing `admin` user (create-only). Override before `./scripts/validation-lab/start.sh` if you want a different password on **first** creation. |
| `APP_ENV` | `development` | Set to `production` or `prod` to force-disable lab seeding regardless of other flags. |

## Seeded topology (summary)

- **7 connectors** — auth variants (Generic REST, Basic, API Key, Bearer, Vendor JWT, OAuth2, Session) against WireMock.
- **4 destinations** — echo webhook, syslog UDP/TCP, WireMock retry webhook.
- **11 streams** — cover single-object, array, nested array, empty array, POST JSON, pagination, auth probe, delivery fan-out, vendor Malop, Okta logs, session cookie fetch.
- **Routes** — mostly echo webhook; **delivery-only** fan-out (retry webhook + syslog UDP + syslog TCP); vendor stream fan-out to echo + syslog TCP.
- **Continuous validations** — include `AUTH_ONLY`, `FETCH_ONLY`, and multiple `FULL_RUNTIME` rows bound to lab streams. One row (`dev_lab_full_delivery`) is intentionally DEGRADED to exercise the alert path.

## UI surfaces

- **Streams / Runtime:** Lab streams are named `[DEV VALIDATION] Stream …` and run on the normal polling scheduler.
- **Validation:** Definitions are prefixed `[DEV VALIDATION]` and use `template_key` values starting with `dev_lab_`. Use the **"Dev validation lab only"** filter on the Validation overview page.
- **Connectors / Streams lists:** A **Dev lab** badge appears next to lab-scoped names, and the Connectors page has a **"Dev validation lab only"** filter.
- **Logs / Analytics:** Use existing runtime log search and analytics views filtered by lab stream IDs.

## Troubleshooting

### Port 8000 already in use

The lab starts **host uvicorn** on **8000**. Stop the conflicting process (often a leftover lab backend, or the platform `api` container publishing **8000**). For platform-only runs, set **`GDC_API_HOST_PORT`** to another host port (see `docker-compose.platform.yml` header comments). Details: **`docs/local-docker-workflow.md`**.

### API runs in Docker (e.g. `gdc-platform-api`) but lab connectors are missing

The **platform** `api` service uses **`postgresql://gdc:gdc@postgres:5432/gdc`** and **`ENABLE_DEV_VALIDATION_LAB=false`**. It will never show `[DEV VALIDATION]` rows unless you deliberately change that (not recommended on `gdc`). Run **`./scripts/validation-lab/start.sh`** instead, or point a **development** API at **`gdc_test`** with the lab flags as documented here.

### `gdc-wiremock` orphan container warning

**`gdc-wiremock`** comes from **`docker-compose.yml`** with **`--profile test`** (host **18080**). It is unrelated to **`docker-compose.platform.yml`** and unrelated to the lab’s **`gdc-wiremock-test`** (**28080**). Remove stray containers with `docker compose --profile test down` or `docker stop gdc-wiremock` as appropriate. See **`docs/local-docker-workflow.md`**.

### PostgreSQL container healthy but lab seed data missing

Confirm you are on **`gdc_test`** (**127.0.0.1:55432**), not the platform **`gdc`** database. If `postgres-test` is up but the API still has no lab rows, use **`./scripts/validation-lab/status.sh`** and inspect **`dev_validation_lab_*`** lines in **`.dev-validation-logs/backend.log`**. If **`reset-db.sh`** is required after schema drift, **back up `gdc_test` first** (example in **`docs/local-docker-workflow.md`**).

### `start.sh` reported schema drift

Run exactly the command it printed (`./scripts/validation-lab/reset-db.sh`) and re-start. This is the only supported recovery path for a drifted `gdc_test`; do not delete volumes or run ad-hoc DDL.

### UI shows no `[DEV VALIDATION]` items

1. `./scripts/validation-lab/status.sh` — check that the backend is reachable, schema is ready, and the connector / validation counts are non-zero.
2. Confirm the lab markers over HTTP:

   ```bash
   curl -fsS http://127.0.0.1:8000/api/v1/connectors/ | grep -F 'DEV VALIDATION' | head
   curl -fsS http://127.0.0.1:8000/api/v1/validation/ | grep -F 'dev_lab' | head
   ```

3. Open DevTools on `http://127.0.0.1:5173` and confirm the one-time `[gdc] API base resolved: …` log. If you set `localStorage` key `gdc.apiBaseUrlOverride`, clear it.
4. Inspect backend logs:

   ```bash
   tail -n 120 .dev-validation-logs/backend.log
   grep -E 'dev_validation_lab|startup_database' .dev-validation-logs/backend.log | tail -n 80
   ```

   Look for `dev_validation_lab_config_snapshot`, `dev_validation_lab_seed_complete` (with `inventory`), or `dev_validation_lab_seed_failed`.

### Lab keeps re-seeding the same rows

The seeder is **idempotent**: existing `[DEV VALIDATION]` rows are not duplicated and user rows are never deleted. Re-running `start.sh` is safe.

## Internal scripts (advanced)

The `scripts/validation-lab/*.sh` commands are thin wrappers over the implementation under `scripts/dev-validation/`. Operators should normally not need to call the underlying scripts directly; they exist for backwards compatibility and granular debugging.

```bash
scripts/dev-validation/start-dev-validation-lab.sh   # underlying start (verbose)
scripts/dev-validation/stop-dev-validation-lab.sh    # underlying stop
scripts/dev-validation/status-dev-validation-lab.sh  # underlying status (no failures summary)
scripts/dev-validation/reset-dev-validation-db.sh    # underlying destructive reset
scripts/dev-validation/test_reset_dev_validation_db.sh  # safety-only checks (no DB writes)
```
