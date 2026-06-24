# Data Relay — Air-Gapped Offline Installation

This package reinstalls **Data Relay (GDC Platform)** on a host with **no internet access**.
It replaces an existing installation (for example a 2026-05-18 build) with the images and
application version captured when the package was built on the connected development system.

## Package contents

| Path | Purpose |
|------|---------|
| `images/*.tar` | Pre-built Docker images (`docker save`) |
| `images/load-images.sh` | Load all images offline |
| `images/verify-images.sh` | Confirm manifest images exist locally |
| `images/IMAGES.manifest` | Required image references |
| `configs/docker-compose.offline.yml` | Production offline compose (no build/pull) |
| `configs/.env.production.template` | Environment template |
| `app/` | Backend source, Alembic migrations, release helpers |
| `scripts/install-offline.sh` | Full install orchestration |
| `scripts/reset-production-data.sh` | Wipe containers/volumes (interactive) |
| `checks/verify-install.sh` | Post-install health and API checks |
| `SHA256SUMS` | Integrity checksums for package files |
| `VERSION` | Build metadata |

## Prerequisites (air-gapped host)

1. **Docker Engine** and **Compose plugin v2** already installed  
   (the default package does not bundle Docker `.deb` files).
2. **Ubuntu 24.04 LTS** or compatible Linux (64-bit).
3. Free disk: **≥ 15 GiB** recommended (images + Postgres data).
4. Free RAM: **≥ 4 GiB** recommended.
5. Host ports available (defaults): **18080** (HTTP UI), **18443** (HTTPS), **55432** (Postgres localhost), **8000** (API).

## Transfer to the air-gapped host

1. On the connected build machine, create the archive:
   ```bash
   ./scripts/build-offline-package.sh
   ```
2. Copy `offline-release-<version>.tar.gz` and `offline-release-<version>.tar.gz.sha256` via approved media.
3. On the air-gapped host:
   ```bash
   sha256sum -c offline-release-<version>.tar.gz.sha256
   tar -xzf offline-release-<version>.tar.gz
   cd offline-release
   ```

Recommended install location: `/opt/datarelay/offline-release` (any path is fine).

## Install commands

### Full reinstall (delete existing data)

```bash
cd /opt/datarelay/offline-release

# 1. Review or create environment file
cp configs/.env.production.template configs/.env
vi configs/.env

# 2. Wipe old platform data (requires typing YES)
scripts/reset-production-data.sh

# 3. Install
scripts/install-offline.sh

# 4. Verify
checks/verify-install.sh
```

`install-offline.sh` by default also runs `docker compose down -v` before installing.
Use `scripts/install-offline.sh --skip-reset` to keep an existing database volume.

### Options

```bash
scripts/install-offline.sh --skip-load     # images already loaded
scripts/install-offline.sh --skip-verify   # skip post-install checks
```

## Default administrator

| Field | Value |
|-------|-------|
| Username | `admin` |
| Password | `admin` (unless `GDC_SEED_ADMIN_PASSWORD` is set in `configs/.env`) |
| First login | Password change required |

Back up `configs/.env` securely after install — it contains database and JWT secrets.

## Access URLs (default ports)

| Service | URL |
|---------|-----|
| Web UI | `http://<host>:18080/` |
| Health | `http://<host>:18080/health` |
| API (direct) | `http://127.0.0.1:8000/health` |

Set `GDC_PUBLIC_URL` in `configs/.env` for operator-facing documentation.

## TLS / HTTPS

Generate self-signed material before install:

```bash
export GDC_INSTALL_GENERATE_TLS=1
scripts/install-offline.sh
```

Or configure Admin → TLS after install (see `app/docs/deployment/https-reverse-proxy.md` in the source tree).

## Data deletion scope

`scripts/reset-production-data.sh` removes:

- Compose project **gdc-platform**
- Containers: `gdc-platform-postgres`, `gdc-platform-api`, `gdc-platform-frontend`, `gdc-platform-reverse-proxy`
- Volumes: `gdc_platform_postgres_data`, `gdc_platform_tls`, `gdc_platform_nginx`

**No backup is created.** This matches the offline reinstall policy.

## Reinstall procedure (upgrade from old build)

1. Stop operators from using the UI.
2. Transfer a new offline package built from the latest development system.
3. Run `reset-production-data.sh` (wipe old data).
4. Run `install-offline.sh`.
5. Run `checks/verify-install.sh`.
6. Re-create connectors, streams, and routes (configuration is not migrated when wiping volumes).

## Verification

```bash
checks/verify-install.sh
```

Manual checks:

```bash
docker compose -f configs/docker-compose.offline.yml --env-file configs/.env ps
curl -fsS http://127.0.0.1:18080/health
curl -fsS -X POST http://127.0.0.1:18080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}'
```

## Logs and troubleshooting

```bash
docker compose -f configs/docker-compose.offline.yml --env-file configs/.env logs -f api
docker compose -f configs/docker-compose.offline.yml --env-file configs/.env logs -f reverse-proxy
docker compose -f configs/docker-compose.offline.yml --env-file configs/.env logs -f postgres
```

| Symptom | Check |
|---------|-------|
| `pull_policy: never` image missing | Re-run `images/load-images.sh` |
| Port already in use | Change `GDC_HTTP_PORT` / `GDC_HTTPS_PORT` in `configs/.env` |
| Migration failure | `app/alembic/versions/` in package; API logs during `alembic upgrade head` |
| Login 401 | `GDC_SEED_ADMIN_PASSWORD` or reset via seed script in `app/scripts/release/` docs |

## Build machine (connected environment)

```bash
./scripts/build-offline-package.sh
# Optional: skip rebuild if images already tagged :offline
GDC_OFFLINE_SKIP_BUILD=1 ./scripts/build-offline-package.sh
```

## Included Docker images

See `images/IMAGES.manifest` (typically):

- `postgres:16-alpine`
- `gdc-platform-api:offline`
- `gdc-platform-frontend:offline`
- `gdc-platform-reverse-proxy:offline`

Dev-validation fixtures (WireMock, webhook echo, syslog) are **not** included in the production offline stack.
