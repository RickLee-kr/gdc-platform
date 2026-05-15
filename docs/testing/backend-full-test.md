# Full backend pytest (reproducible)

Use a single entry point so the full suite does not depend on whatever happened to last leave `gdc_test` on `127.0.0.1:55432` (schema drift, half-applied migrations, stale objects outside Alembic history).

## Command

From the repository root (after `pip install -r requirements.txt`):

```bash
bash scripts/test/run-backend-full.sh
```

With a clean catalog (recommended when Alembic errors or counts swing wildly):

```bash
GDC_BACKEND_FULL_TEST_RESET_CONFIRM=YES_I_RESET_GDC_TEST_ONLY \
  bash scripts/test/run-backend-full.sh --fresh-schema
```

## What the script does

1. **Pins URLs** — Sets `TEST_DATABASE_URL` and `DATABASE_URL` to exactly:

   `postgresql://gdc:gdc@127.0.0.1:55432/gdc_test`

2. **Refuses non-test targets** — Host must be `127.0.0.1`, port `55432`, database `gdc_test`, user/password `gdc` (lab defaults from `docker-compose.test.yml`).

3. **Starts dependencies** — When Docker is available, runs `docker compose -f docker-compose.test.yml` with profile `test` for:

   `postgres-test`, `wiremock-test`, `webhook-receiver-test`, `syslog-test`, `minio-test`, `postgres-query-test`, `sftp-test`

4. **Waits** — PostgreSQL TCP readiness (up to ~180s), then WireMock admin HTTP (up to ~60s).

5. **Optional reset** — `--fresh-schema` drops and recreates `public` on **only** `gdc_test` (same scope as `scripts/dev-validation/reset-dev-validation-db.sh`). Requires explicit confirmation (env or typed phrase); nothing runs against production catalogs.

6. **Migrates** — `python3 -m alembic upgrade head` (fails the script on error).

7. **Seeds fixtures** — `scripts/testing/source-e2e/seed-fixtures.sh` for deterministic `source_e2e` data (MinIO, fixture PostgreSQL, SFTP).

8. **Runs pytest** — `python3 -m pytest tests/ -q --tb=short` (full tree; no `tail` or other output hiding).

## PostgreSQL-only

- The platform test catalog is PostgreSQL. The script does not configure SQLite.
- Do not point this script at production hosts or databases; it overwrites the process environment to the canonical lab URL above.

## CI

GitHub Actions job **Backend tests (CI validation)** runs the same script (see `.github/workflows/backend-tests.yml`) so local runs and CI share bootstrap steps. CI passes `--fresh-schema` with `GDC_BACKEND_FULL_TEST_RESET_CONFIRM` so each job starts from a known schema on the ephemeral Postgres volume. After pytest, CI runs `python3 -m alembic heads` to ensure the revision graph is loadable (no live DB required) and greps core config paths to block accidental SQLite references.

## Troubleshooting

| Symptom | What to try |
|--------|----------------|
| Port `55432` in use | Stop the other process or `docker compose -f docker-compose.test.yml down`, then re-run. |
| Alembic `DuplicateTable` / drift | Run with `--fresh-schema` and the confirm env (see above). |
| WireMock errors | Ensure Docker brought up `wiremock-test`; `WIREMOCK_BASE_URL` defaults to `http://127.0.0.1:28080`. |
| `source_e2e` skips | Confirm MinIO (`59000`), fixture PG (`55433`), and SFTP (`22222`) ports from compose are up; re-run the script so compose starts them. |

## Related

- `tests/conftest.py` — per-test truncation and migration helpers for `gdc_test` / `gdc_e2e_test` when pytest runs; the bootstrap script still normalizes **session** state before pytest.
- `docs/testing/source-adapter-e2e.md` — deeper detail on fixture services.
- `scripts/test/run-source-e2e-tests.sh` — subset `pytest -m source_e2e` only.
