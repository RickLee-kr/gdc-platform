# Fresh install (release candidate)

This guide covers installing the platform using Docker Compose and the release helper scripts under `scripts/release/`. It complements `docs/deployment/https-reverse-proxy.md` and `docs/operator-runbook.md`.

## Preconditions

- Docker Engine and **Docker Compose v2** (`docker compose version`).
- Repository checkout on the target host.
- **PostgreSQL only** — the stack ships PostgreSQL in Compose; SQLite is not supported.

## Quick path (automated)

From the repository root:

```bash
chmod +x scripts/release/*.sh
./scripts/release/install.sh
```

What `install.sh` does:

1. Verifies `docker` and `docker compose` are available.
2. Creates `deploy/tls/` and `deploy/backups/` if missing.
3. Copies `.env.example` to `.env` when `.env` is absent.
4. Validates that `DATABASE_URL` in `.env` (if present) is a `postgresql://` or `postgres://` URL (rejects SQLite-style values).
5. Optionally generates TLS material when `GDC_INSTALL_GENERATE_TLS=1` (runs `generate-self-signed-cert.sh`; output under `deploy/tls/`).
6. Builds images, starts PostgreSQL, waits for readiness, runs `alembic upgrade head` inside the `api` image.
7. Runs `python -m app.db.seed --platform-admin-only` inside the `api` image (create-only `admin` user when missing). Default first sign-in is **`admin` / `admin`** unless `GDC_SEED_ADMIN_PASSWORD` is set in the environment or `.env` (minimum 8 characters). The default password path requires an immediate password change on first login; see `specs/039-default-admin-bootstrap/spec.md` and `app/db/seed.py`. Existing `admin` rows are never overwritten.
8. Starts the full stack (`docker compose up -d`).

For platform-style compose files, `install.sh` warns when `.env` still points `DATABASE_URL` at the local lab catalog (`gdc_test` / port `55432`) so host-side tools are not misconfigured.

`scripts/release/backup-before-upgrade.sh` and `restore.sh` infer the PostgreSQL catalog from the merged Compose `postgres` service `POSTGRES_DB` (same default as `install.sh` / `upgrade.sh` when `GDC_RELEASE_COMPOSE_FILE` is aligned).

### Choose the Compose stack

| Goal | Set before `install.sh` |
|------|---------------------------|
| Default platform (DB + API + nginx, dev-friendly API host port) | _(default)_ `GDC_RELEASE_COMPOSE_FILE=docker-compose.platform.yml` |
| Production-style HTTPS (no DB/API ports on host; TLS bind-mount) | `GDC_RELEASE_COMPOSE_FILE=deploy/docker-compose.https.yml` |

Example HTTPS install (production-style defaults publish **80** / **443** on the host; ensure those ports are free or override `GDC_ENTRY_*`):

```bash
export GDC_RELEASE_COMPOSE_FILE=deploy/docker-compose.https.yml
export GDC_INSTALL_GENERATE_TLS=1
./scripts/release/install.sh
```

## Manual secrets checklist (production)

Before serving real traffic, set at least:

- `JWT_SECRET_KEY` — long random string (JWT signing).
- `SECRET_KEY` and `ENCRYPTION_KEY` — strong values consistent with your key management policy.
- `GDC_PROXY_RELOAD_TOKEN` — long random string shared with the reverse proxy reload hook.
- `POSTGRES_PASSWORD` — strong password; must match `DATABASE_URL` / compose interpolation for `deploy/docker-compose.https.yml` and `docker-compose.platform.yml` (both use `${POSTGRES_PASSWORD:-gdc}` for the database role).

Optional administrator password override:

- Set `GDC_SEED_ADMIN_PASSWORD` (minimum 8 characters) in `.env` or the shell so the **first** created `admin` user uses that password instead of `admin`, and **does not** require a forced password change. The install script passes this into the seed container when present. Create-only: an existing `admin` row is never updated.

## URLs after install

The completion banner from `install.sh` prefers `GDC_PUBLIC_URL` (environment or `.env`, full URL including scheme and trailing path convention), then derives `http://<detected-host>:<GDC_ENTRY_HTTP_PORT host port>/` from the server. Override `GDC_PUBLIC_URL` when operators reach the UI through DNS, TLS termination, or a different port than the detected LAN address.

- **Platform compose** (`docker-compose.platform.yml`): nginx is the normal browser entry (default host port **18080** via `GDC_ENTRY_HTTP_PORT`, HTTPS **18443** via `GDC_ENTRY_HTTPS_PORT`).
- **HTTPS compose** (`deploy/docker-compose.https.yml`): after TLS material exists and Admin HTTPS is enabled, browsers use HTTPS on **`GDC_ENTRY_HTTPS_PORT`** (default **443**; see `docs/deployment/https-reverse-proxy.md`).

## Validation lab separation

The **development validation lab** (`gdc_test`, WireMock, fixture containers, `[DEV VALIDATION]` / `[DEV E2E]` seeds) is **not** started by `install.sh`. Use `scripts/validation-lab/start.sh` and `docs/testing/dev-validation-lab.md` for that workflow. Production-style stacks set `ENABLE_DEV_VALIDATION_LAB=false` in Compose.

## Safety guardrails (unchanged architecture)

- Connector ≠ Stream; Source ≠ Destination; Stream is the execution unit; Route connects Stream to Destination.
- Checkpoint updates only after successful destination delivery (StreamRunner transaction ownership).
- RBAC enforcement remains server-side (`specs/035-rbac-lite/spec.md`).
- Release scripts do **not** delete Docker volumes or reset production databases automatically.

## Next steps

- Upgrades: `docs/deployment/upgrade-guide.md`
- Backups: `docs/deployment/backup-restore.md`
- Release verification: `docs/deployment/release-checklist.md`
