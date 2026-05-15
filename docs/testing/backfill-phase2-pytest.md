# Backfill Phase 2 — PostgreSQL test environment

This project uses **PostgreSQL only** for the application database (no SQLite). Backend pytest, Alembic migrations, and the Data Backfill Phase 2 tests must target the **isolated test database** unless you explicitly override the URL.

## Standard connection string

```text
postgresql://gdc:gdc@127.0.0.1:55432/gdc_test
```

Set as `TEST_DATABASE_URL` and/or `DATABASE_URL` when running migrations or pytest against the test stack.

## Docker test stack

Start the test-profile PostgreSQL service (published to the host as **55432**):

```bash
docker compose -f docker-compose.test.yml --profile test up -d postgres-test
```

Wait until `pg_isready` succeeds on `127.0.0.1:55432` (the compose file includes a container healthcheck).

## Helper script

From the repository root:

```bash
./scripts/test/run-backfill-tests.sh
```

This script:

1. Exports `TEST_DATABASE_URL` (defaulting to the standard URL above) and sets `DATABASE_URL` to the same value.
2. Drops and recreates the `public` schema on that database so `alembic upgrade head` is reliable after metadata-only pytest runs (use **only** on dedicated `gdc_test`; do not point at a shared development catalog).
3. Runs `python3 -m alembic upgrade head`.
4. Runs `pytest tests/test_backfill_foundation.py tests/test_backfill_worker_progress.py -q`.

Override the target database only when intentional:

```bash
TEST_DATABASE_URL='postgresql://gdc:gdc@127.0.0.1:55432/gdc_test' ./scripts/test/run-backfill-tests.sh
```

Do not set `TEST_DATABASE_URL` to a database that holds production or shared operator configuration; the helper script prepares `public` for migrations.

## Manual equivalents

```bash
export TEST_DATABASE_URL='postgresql://gdc:gdc@127.0.0.1:55432/gdc_test'
export DATABASE_URL="$TEST_DATABASE_URL"
python3 -m alembic upgrade head
python3 -m pytest tests/test_backfill_foundation.py tests/test_backfill_worker_progress.py -q
```

## CI alignment

GitHub Actions workflows map the job service PostgreSQL to host port **55432** and use the same `TEST_DATABASE_URL` pattern as local runs (`127.0.0.1:55432/gdc_test`).

## Related documentation

- [`docs/testing/continuous-test-environment.md`](continuous-test-environment.md) — full WireMock / regression stack.
- [`tests/conftest.py`](../../tests/conftest.py) — `TEST_DATABASE_URL` / schema reset fixtures.
