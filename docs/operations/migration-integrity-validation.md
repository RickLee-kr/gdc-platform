# Migration integrity validation and admin password recovery

Operational checklist for confirming Alembic/`alembic_version` alignment with this repository, validating **`migration_integrity`** in the API, and safely recovering platform admin login. This page documents **procedures only** — it does not replace migrations, StreamRunner, or `delivery_logs` schema work.

**Related:** `docs/operations/migration-recovery-runbook.md` (orphan revisions, `validate-migrations`, backups).

---

## 1. Admin password reset (platform `admin` only)

The seed CLI can **create** `admin` when missing (create-only) or **reset the password hash** for the existing platform admin when explicitly requested.

| Goal | Command (inside `api` container or equivalent env) |
|------|------------------------------------------------------|
| Create `admin` only if absent | `python -m app.db.seed --platform-admin-only` |
| Reset password if `admin` exists, or create if missing | `GDC_SEED_ADMIN_PASSWORD='…'` (8+ characters) + `python -m app.db.seed --platform-admin-only --reset-platform-admin-password` |

Rules:

- **`--reset-platform-admin-password` requires `--platform-admin-only`** (CLI rejects otherwise).
- When **updating an existing** `admin` row, **`GDC_SEED_ADMIN_PASSWORD` must be set** and at least 8 characters.
- Only the **`admin`** platform user row is touched; no full DB seed, no demo connector data, no truncation.
- Successful reset bumps **`token_version`** on that user (outstanding JWTs for that account are invalidated).

Example (platform Compose):

```bash
docker compose -f docker-compose.platform.yml exec \
  -e GDC_SEED_ADMIN_PASSWORD='YourSecurePw1!' \
  api \
  python -m app.db.seed --platform-admin-only --reset-platform-admin-password
```

See also: `docs/deployment/install-guide.md` (bootstrap admin), `app/db/seed.py` module docstring.

---

## 2. Rebuild the API image when `app/db/seed.py` changes

The **`api` image bakes application code** (`COPY app ./app` in `docker/Dockerfile.api`). The running container does **not** bind-mount the repo’s `app/` tree by default.

After changing **`app/db/seed.py`** (or any module the seed uses), operators must **rebuild and redeploy** `api` so `python -m app.db.seed` inside the container sees the new flags and logic:

```bash
docker compose -f docker-compose.platform.yml build api
docker compose -f docker-compose.platform.yml up -d api
```

Until then, `docker compose … exec api python -m app.db.seed …` may report **unknown arguments** or behave like the old image.

---

## 3. Alembic `upgrade head`

Apply the migration chain to the **same** database URL the API uses (see Compose `DATABASE_URL` and `docs/operations/migration-recovery-runbook.md` for catalog naming).

**One-off (typical):**

```bash
docker compose -f docker-compose.platform.yml run --rm api alembic upgrade head
# or, if the api container is already running and has the repo revision baked in:
docker compose -f docker-compose.platform.yml exec api alembic upgrade head
```

**Pre-check (recommended):**

```bash
./scripts/ops/validate-migrations.sh --pre-upgrade
```

Do **not** skip a failing orphan/unknown revision without following `migration-recovery-runbook.md`.

---

## 4. API restart after migration or stamp changes

`GET /api/v1/runtime/status` and **`migration_integrity`** (and related fields such as `alembic_revision`) reflect a **startup snapshot** captured when the API process evaluated DB readiness (`evaluate_startup_readiness`).

If you:

- run `alembic upgrade head`, or  
- change `alembic_version` (including `alembic stamp`),

the live database is updated **immediately**, but the **in-memory snapshot may still show the old state** (`db_revision: null`, stale errors) until the process restarts.

**After migration or stamp operations, restart `api`:**

```bash
docker compose -f docker-compose.platform.yml restart api
```

Wait for `/health` (and container health) before re-checking `migration_integrity`.

---

## 5. Verifying `migration_integrity` (authenticated endpoints)

Obtain a JWT (e.g. administrator login), then:

| Endpoint | Purpose |
|---------|---------|
| `GET /api/v1/runtime/status` | Top-level `migration_integrity`, `alembic_revision`, `schema_ready`, `degraded_reason` |
| `GET /api/v1/admin/maintenance/health` | **Administrator** maintenance dashboard payload; `panels.migrations.migration_integrity` and `overall` |

**Healthy baseline (current repo head):**

- HTTP **200**
- `migration_integrity.ok` **true**, `migration_integrity.status` **`ok`**
- `migration_integrity.errors` **empty**
- `alembic_revision` matches repository head (see `migration-recovery-runbook.md` — e.g. `20260513_0019_must_change_pw`)

Example (replace `TOKEN`):

```bash
curl -sS -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8000/api/v1/runtime/status
curl -sS -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8000/api/v1/admin/maintenance/health
```

---

## 6. Playwright operator smoke (steady password)

The **operator-auth-runtime-smoke** test probes live auth (`REQUIRE_AUTH=true`) and UI flows. Set the steady-state operator password used after bootstrap:

```bash
cd frontend
PLAYWRIGHT_E2E_PASSWORD='Stellar1!' npx playwright test operator-auth-runtime-smoke
```

Optional: `PLAYWRIGHT_API_BASE_URL` (defaults to `http://127.0.0.1:8000`). The suite uses Vite’s dev server with `/api` proxy; ensure the API is reachable.

---

## 7. Forbidden operations (safety)

Unless explicitly approved for a **dedicated disposable** environment, **do not**:

- Reset or drop the database (`db reset`, wipe volume data, etc.).
- Run **`docker compose down -v`** (destroys named volumes and data).
- **Truncate** `delivery_logs` (or other production tables) as a “quick fix” for migration or auth issues.
- Run **`git reset`** or delete migration files to silence Alembic errors.

Use backups, `migration-recovery-runbook.md`, and stamped upgrades instead.

---

## 8. Troubleshooting

### `USER_AUTH_FAILED` on `POST /api/v1/auth/login`

- Wrong password, or **no `admin` row** yet.
- **Fix:** Ensure `admin` exists (`python -m app.db.seed --platform-admin-only`) and password matches; use **`--reset-platform-admin-password`** with `GDC_SEED_ADMIN_PASSWORD` if you must set a known password (see §1).
- After a reset, **re-login**; old JWTs may be invalid due to `token_version` bump.

### `GET /api/v1/runtime/status` returns **401** `AUTH_REQUIRED`

- Expected when **no `Authorization` header**; the smoke test asserts this for unauthenticated access.
- **Fix:** Log in and pass `Authorization: Bearer <access_token>`.

### `migration_integrity` shows stale `db_revision` / “No row in alembic_version” after upgrade

- **Cause:** API process still serving the **startup** snapshot from before the stamp/upgrade.
- **Fix:** Confirm `SELECT version_num FROM alembic_version;` in Postgres, then **restart `api`** (§4).

### Orphan revision **`20260513_0021_dl_parts`**

- **`alembic_version`** references a revision **not present** in this repository’s `alembic/versions/`.
- **Symptom:** `migration_integrity` errors, `alembic upgrade` / `alembic current` failures, maintenance migrations panel **ERROR**.
- **Fix:** Follow **`docs/operations/migration-recovery-runbook.md` § Orphan revision** (backup, inspect schema, validate, stamp or restore chain — never `down -v` / truncate / `git reset` as first resort).

---

## Validation snapshot (post-checklist)

A full green run typically includes:

- `admin` login OK with intended password
- `GET /api/v1/runtime/status` **200**, `migration_integrity` **ok**
- `GET /api/v1/admin/maintenance/health` **200**, `overall` **OK**
- `PLAYWRIGHT_E2E_PASSWORD=… npx playwright test operator-auth-runtime-smoke`
- `frontend`: `npm run build`, targeted Vitest as needed
- `pytest tests/test_seed_data.py tests/test_migration_integrity.py`
