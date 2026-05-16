# Full backend pytest (reproducible)

Use a single entry point so the full suite does not depend on whatever happened to last leave **`gdc_pytest`** on `127.0.0.1:55432` (schema drift, half-applied migrations, stale objects outside Alembic history).

**Important:** The Docker API and validation lab use catalog **`datarelay`** on the same Postgres port. Host `pytest` must use **`gdc_pytest`** (or allow-listed `gdc_e2e_test` only). `tests/conftest.py` **refuses** `datarelay`, `gdc`, and other non-allow-listed catalogs so TRUNCATE/DROP never hits the running stack DB.

## Command

From the repository root (after `pip install -r requirements.txt`):

```bash
bash scripts/test/run-backend-full.sh
```

With a clean pytest catalog (recommended when Alembic errors or counts swing wildly):

```bash
GDC_BACKEND_FULL_TEST_RESET_CONFIRM=YES_I_RESET_GDC_PYTEST_CATALOG_ONLY \
  bash scripts/test/run-backend-full.sh --fresh-schema
```

## One-time / existing Postgres volumes

If `gdc_pytest` does not exist yet (common on volumes created before this split), create it idempotently:

```bash
export TEST_DATABASE_URL=postgresql://gdc:gdc@127.0.0.1:55432/gdc_pytest
python3 scripts/test/ensure_gdc_pytest_catalog.py
```

New `docker-compose.test.yml` stacks also run `docker/postgres/initdb.d/02-create-gdc-pytest.sql` on **first** data directory init.

## What the script does

1. **Pins URLs** — Sets `TEST_DATABASE_URL` and `DATABASE_URL` to exactly:

   `postgresql://gdc:gdc@127.0.0.1:55432/gdc_pytest`

2. **Refuses non-test targets** — Host must be `127.0.0.1`, port `55432`, database **`gdc_pytest`**, user/password `gdc` (lab defaults from `docker-compose.test.yml`).

3. **Starts dependencies** — When Docker is available, runs `docker compose -f docker-compose.test.yml` with profile `test` for:

   `postgres-test`, `wiremock-test`, `webhook-receiver-test`, `syslog-test`, `minio-test`, `postgres-query-test`, `sftp-test`

4. **Waits** — PostgreSQL server readiness via the always-present **`datarelay`** gateway URL, then **`ensure_gdc_pytest_catalog.py`**, then TCP to **`gdc_pytest`**.

5. **Optional reset** — `--fresh-schema` drops and recreates `public` on **only** `gdc_pytest`. Requires explicit confirmation (env or typed phrase); nothing in this path targets `datarelay` or production catalogs.

6. **Migrates** — `python3 -m alembic upgrade head` against **`gdc_pytest`** (fails the script on error).

7. **Seeds fixtures** — `scripts/testing/source-e2e/seed-fixtures.sh` for deterministic `source_e2e` data (MinIO, fixture PostgreSQL, SFTP).

8. **Runs pytest** — `python3 -m pytest tests/ -q --tb=short` (full tree; no `tail` or other output hiding).

## Running a subset of tests locally

```bash
export TEST_DATABASE_URL=postgresql://gdc:gdc@127.0.0.1:55432/gdc_pytest
python3 scripts/test/ensure_gdc_pytest_catalog.py
python3 -m pytest tests/test_jwt_session_auth.py -v
```

Do **not** export `TEST_DATABASE_URL` to `datarelay` while the API is running on that catalog — pytest will exit early with a clear error, but misconfiguration elsewhere could still be risky.

## PostgreSQL-only

- The platform test catalog is PostgreSQL. The script does not configure SQLite.
- Do not point this script at production hosts or databases; it overwrites the process environment to the canonical pytest URL above.

## CI

GitHub Actions job **Backend tests (CI validation)** runs the same script (see `.github/workflows/backend-tests.yml`) so local runs and CI share bootstrap steps. CI passes `--fresh-schema` with `GDC_BACKEND_FULL_TEST_RESET_CONFIRM=YES_I_RESET_GDC_PYTEST_CATALOG_ONLY` so each job starts from a known schema on the ephemeral Postgres volume. After pytest, CI runs `python3 -m alembic heads` to ensure the revision graph is loadable (no live DB required) and greps core config paths to block accidental SQLite references.

## Troubleshooting

| Symptom | What to try |
|--------|----------------|
| Port `55432` in use | Stop the other process or `docker compose -f docker-compose.test.yml down`, then re-run. |
| Alembic `DuplicateTable` / drift on **gdc_pytest** | Run with `--fresh-schema` and the confirm env (see above). |
| `database "gdc_pytest" does not exist` | Run `python3 scripts/test/ensure_gdc_pytest_catalog.py` with `TEST_DATABASE_URL` set to the pytest URL. |
| WireMock errors | Ensure Docker brought up `wiremock-test`; `WIREMOCK_BASE_URL` defaults to `http://127.0.0.1:28080`. |
| `source_e2e` skips | Confirm MinIO (`59000`), fixture PG (`55433`), and SFTP (`22222`) ports from compose are up; re-run the script so compose starts them. |

## Related

- `tests/conftest.py` — per-test truncation and migration helpers for **`gdc_pytest`** / `gdc_e2e_test` only.
- `tests/db_test_policy.py` — allowlist / guard for host pytest catalogs.
- `scripts/test/ensure_gdc_pytest_catalog.py` — idempotent `CREATE DATABASE` for the pytest catalog.
- `docs/testing/source-adapter-e2e.md` — deeper detail on fixture services.
- `scripts/test/run-source-e2e-tests.sh` — subset `pytest -m source_e2e` only.
