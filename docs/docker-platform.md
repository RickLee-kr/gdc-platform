# Docker platform stack (HTTPS reverse proxy)

The default full stack is `docker-compose.platform.yml`: PostgreSQL (**catalog `gdc`**, role **`gdc`**, volume **`gdc_platform_postgres_data`**, host DB port **55432**), API, static **frontend**, and **nginx** (`reverse-proxy`) as the single browser entrypoint.

**Scope:** Production platform compose does **not** attach to dev-validation external networks or legacy test volumes. WireMock, fixtures, and project `gdc-platform-test` live in `docker-compose.dev-validation.yml` / `docker-compose.test.yml`. See **`docs/testing/dev-validation-lab.md`** and **`docs/local-docker-workflow.md`**.

## Clean install

```bash
git clone <repo> gdc-platform && cd gdc-platform
git checkout <release-tag>
./scripts/release/install.sh
```

See **`docs/deployment/install-guide.md`** for Docker auto-install, ports, and legacy migration.

## Port policy (host)

| Mode | HTTP | HTTPS | PostgreSQL (host) | API (optional host) |
|------|------|-------|-------------------|---------------------|
| **Platform** (`docker-compose.platform.yml`) | **18080** | **18443** | **55432** | **8000** (`GDC_API_HOST_PORT`) |
| **HTTPS production** (`deploy/docker-compose.https.yml`) | **80** | **443** | _(not published)_ | _(not published)_ |

Override the platform stack with `GDC_HTTP_PORT`, `GDC_HTTPS_PORT`, and `GDC_PUBLIC_HTTPS_PORT`.

## Quick start (manual, after `.env` exists)

```bash
./scripts/dev/start-platform.sh
```

The readiness gate can be re-run at any time:

```bash
./scripts/dev/validate-platform-ready.sh
```

- UI: **http://localhost:18080/** (default).
- HTTPS (Admin Settings): **https://localhost:18443/** after TLS is enabled.
- Development login: username **`admin`**, password **`admin`** unless **`GDC_SEED_ADMIN_PASSWORD`** is explicitly set. First login requires a password change, and bootstrap does not reset existing admin password hashes.

## Configurable reverse-proxy ports

Set the external browser ports in `.env`:

```env
GDC_HTTP_PORT=19080
GDC_HTTPS_PORT=19443
GDC_PUBLIC_HTTPS_PORT=19443
```

Valid values are numeric TCP ports from 1 to 65535. `GDC_HTTP_PORT` and `GDC_HTTPS_PORT` must be different and must not collide with reserved platform service ports such as PostgreSQL, API, nginx reload, or fixture ports.

After changing values, restart the reverse proxy so Docker recreates the published port bindings:

```bash
docker compose -f docker-compose.platform.yml up -d --force-recreate reverse-proxy
```

The admin API exposes the same persisted values at `GET /api/v1/admin/network-settings` and accepts `PUT /api/v1/admin/network-settings`; updates return `restart_required=true` and do not restart containers automatically.

## Legacy volume note

Installs created before the production compose cleanup may use external volume **`gdc-platform-test_gdc_test_postgres_data`** or the older **`datarelay_postgres_data`** volume. Those volumes are **not** deleted automatically. New development platform starts use **`gdc_platform_postgres_data`** and catalog **`gdc`**.

## HTTP / HTTPS behavior

- Until HTTPS is enabled in **Admin Settings**, nginx serves HTTP only on container port 80.
- Self-signed TLS: Admin → HTTPS / Security; see `docs/deployment/https-reverse-proxy.md`.

## Smoke script

```bash
./scripts/validate_https_stack.sh
```

## Troubleshooting

- Port conflicts on **18080**, **18443**, **55432**: stop conflicting services or change `GDC_HTTP_PORT` / `GDC_HTTPS_PORT` in `.env`.
- Lab vs platform: use **`docs/local-docker-workflow.md`** when mixing dev-validation fixtures with the platform API.
