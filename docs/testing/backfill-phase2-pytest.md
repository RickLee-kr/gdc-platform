# Backfill Phase 2 — PostgreSQL test environment

This project uses **PostgreSQL only** for the application database (no SQLite). Backend pytest, Alembic migrations, and the Data Backfill Phase 2 tests must target the **isolated pytest catalog** (`gdc_pytest`) unless you explicitly override the URL with another **allow-listed** pytest database (see `tests/db_test_policy.py`).

## Standard connection string

```text
postgresql://gdc:gdc@127.0.0.1:55432/gdc_pytest
```

Set as `TEST_DATABASE_URL` and/or `DATABASE_URL` when running migrations or pytest against the test stack. Do **not** use `datarelay` for host pytest — that catalog is for the running API / validation lab.

## Docker test stack

Start the test-profile PostgreSQL service (published to the host as **55432**):

```bash
docker compose -f docker-compose.test.yml --profile test up -d postgres-test
```

Wait until `pg_isready` succeeds on `127.0.0.1:55432` (the compose file includes a container healthcheck). Then ensure the pytest catalog exists:

```bash
export TEST_DATABASE_URL=postgresql://gdc:gdc@127.0.0.1:55432/gdc_pytest
python3 scripts/test/ensure_gdc_pytest_catalog.py
```

## Helper script

From the repository root:

```bash
./scripts/test/run-backfill-tests.sh
```

This script:

1. Validates `TEST_DATABASE_URL` against the pytest allowlist (`tests/db_test_policy.py`), then exports `DATABASE_URL` to the same value.
2. Drops and recreates the `public` schema on that database so `alembic upgrade head` is reliable after metadata-only pytest runs (use **only** on **`gdc_pytest`** or `gdc_e2e_test`; do not point at `datarelay` or production catalogs).
3. Runs `python3 -m alembic upgrade head`.
4. Runs `pytest tests/test_backfill_foundation.py tests/test_backfill_worker_progress.py -q`.

Override the target database only when intentional:

```bash
TEST_DATABASE_URL='postgresql://gdc:gdc@127.0.0.1:55432/gdc_pytest' ./scripts/test/run-backfill-tests.sh
```

Do not set `TEST_DATABASE_URL` to a database that holds production or shared operator configuration; the helper script prepares `public` for migrations.

## Manual equivalents

```bash
export TEST_DATABASE_URL='postgresql://gdc:gdc@127.0.0.1:55432/gdc_pytest'
export DATABASE_URL="$TEST_DATABASE_URL"
python3 scripts/test/ensure_gdc_pytest_catalog.py
python3 -m alembic upgrade head
python3 -m pytest tests/test_backfill_foundation.py tests/test_backfill_worker_progress.py -q
```

## CI alignment

GitHub Actions workflows map the job service PostgreSQL to host port **55432** and use `127.0.0.1:55432/gdc_pytest` for pytest jobs, with `scripts/test/ensure_gdc_pytest_catalog.py` creating the catalog when needed.

## Related documentation

- [`docs/testing/continuous-test-environment.md`](continuous-test-environment.md) — full WireMock / regression stack.
- [`docs/testing/backend-full-test.md`](backend-full-test.md) — full backend pytest bootstrap.
- [`tests/conftest.py`](../../tests/conftest.py) — `TEST_DATABASE_URL` / schema reset fixtures.
