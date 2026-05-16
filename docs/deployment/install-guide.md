# Fresh install (release candidate)

This guide covers installing the platform on a **clean Ubuntu 24.04** server using Docker Compose and `scripts/release/install.sh`. It complements `docs/deployment/https-reverse-proxy.md` and `docs/operator-runbook.md`.

## One-command clean install

On a fresh server with Git only:

```bash
git clone <repository-url> gdc-platform
cd gdc-platform
git checkout rc-2026.05-operational-validation   # or your release tag
chmod +x scripts/release/*.sh
./scripts/release/install.sh
```

No separate Docker install, volume creation, or network creation is required. `install.sh`:

1. Installs **Docker Engine** and the **Compose v2 plugin** on Ubuntu 24.04 when missing (`scripts/install-docker-ubuntu2404.sh` via `sudo`).
2. Verifies the Docker daemon is running and the current user can run `docker` (if not, prints `newgrp docker` and exits).
3. Validates host memory, disk, and that ports **18080**, **18443**, and **55432** are free.
4. Creates `.env` from `.env.example` when `.env` is absent (never overwrites an existing `.env`).
5. Validates required `.env` keys (`POSTGRES_*`, `DATABASE_URL`).
6. Starts PostgreSQL (compose volume **`datarelay_postgres_data`**, catalog **`datarelay`**, role **`datarelay`**).
7. Runs `alembic upgrade head` and create-only admin seed.
8. Starts API, frontend, and reverse-proxy; verifies `/health` and `POST /api/v1/auth/login` via the proxy.

Pre-flight static checks (no Docker required):

```bash
./scripts/release/validate-clean-install.sh
```

## Preconditions

- **Ubuntu 24.04** for automatic Docker installation (other distros: install Docker Engine + Compose v2 manually).
- Repository checkout on the target host.
- **PostgreSQL only** — SQLite is not supported.

## Compose stack

| Goal | `GDC_RELEASE_COMPOSE_FILE` |
|------|----------------------------|
| Default platform (DB host **55432**, UI **18080** / **18443**) | `docker-compose.platform.yml` (default) |
| Production-style HTTPS (no DB/API on host) | `deploy/docker-compose.https.yml` |

Example HTTPS install:

```bash
export GDC_RELEASE_COMPOSE_FILE=deploy/docker-compose.https.yml
export GDC_INSTALL_GENERATE_TLS=1
./scripts/release/install.sh
```

## Production ports and data

| Item | Default |
|------|---------|
| HTTP (browser) | Host **18080** → reverse-proxy **80** (`GDC_ENTRY_HTTP_PORT`) |
| HTTPS (after Admin TLS) | Host **18443** → **443** (`GDC_ENTRY_HTTPS_PORT`) |
| PostgreSQL (host tools) | **55432** → container **5432** |
| Database catalog | **`datarelay`** |
| Database role | **`datarelay`** |
| Compose volume | **`datarelay_postgres_data`** (created on first `up`) |

Set strong values in `.env` before exposure: `POSTGRES_PASSWORD`, `JWT_SECRET_KEY`, `SECRET_KEY`, `ENCRYPTION_KEY`, `GDC_PROXY_RELOAD_TOKEN`.

## Initial administrator

- Username: **`admin`**
- Password: **`admin`** unless `GDC_SEED_ADMIN_PASSWORD` is set in `.env` or the environment (minimum 8 characters).
- Default password requires change on first login; seeded password from `GDC_SEED_ADMIN_PASSWORD` does not.

## Legacy `gdc_test` volume / catalog migration

Older development installs may still use Docker volume **`gdc-platform-test_gdc_test_postgres_data`** and catalog **`gdc_test`**. New installs do **not** reference that volume.

To rename catalog `gdc_test` → `datarelay` in place (preserves data, idempotent):

```bash
GDC_RENAME_DB_USER=gdc ./scripts/release/rename-catalog-gdc-test-to-datarelay.sh
```

Use `GDC_RENAME_DB_USER=datarelay` if the cluster already uses the `datarelay` role. See `docs/deployment/backup-restore.md` before major changes.

## Docker group note

After automatic Docker install, if `docker info` fails for your user, run:

```bash
newgrp docker
./scripts/release/install.sh
```

## Safety

- `install.sh` is idempotent: safe to re-run; does not run `docker compose down -v`, delete volumes, or truncate tables.
- Development validation lab stacks remain in `docker-compose.dev-validation.yml` / `docker-compose.test.yml` — not started by `install.sh`.

## Next steps

- Upgrades: `docs/deployment/upgrade-guide.md`
- Backups: `docs/deployment/backup-restore.md`
- Release verification: `docs/deployment/release-checklist.md`
