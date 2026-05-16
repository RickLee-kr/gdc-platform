# Docker platform stack (HTTPS reverse proxy)

The default full stack is `docker-compose.platform.yml`: PostgreSQL (**catalog `datarelay`**, role **`datarelay`**, volume **`datarelay_postgres_data`**, host DB port **55432**), API, static **frontend**, and **nginx** (`reverse-proxy`) as the single browser entrypoint.

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

Override with `GDC_ENTRY_HTTP_PORT`, `GDC_ENTRY_HTTPS_PORT`, and `GDC_PUBLIC_HTTPS_PORT`.

## Quick start (manual, after `.env` exists)

```bash
docker compose -f docker-compose.platform.yml up -d --build
docker compose -f docker-compose.platform.yml run --rm api alembic upgrade head
docker compose -f docker-compose.platform.yml run --rm api python -m app.db.seed --platform-admin-only
```

- UI: **http://localhost:18080/** (default).
- HTTPS (Admin Settings): **https://localhost:18443/** after TLS is enabled.

## Legacy volume note

Installs created before the production compose cleanup may use external volume **`gdc-platform-test_gdc_test_postgres_data`**. That volume is **not** deleted automatically. New installs use **`datarelay_postgres_data`**. Catalog rename: `scripts/release/rename-catalog-gdc-test-to-datarelay.sh`.

## HTTP / HTTPS behavior

- Until HTTPS is enabled in **Admin Settings**, nginx serves HTTP only on container port 80.
- Self-signed TLS: Admin → HTTPS / Security; see `docs/deployment/https-reverse-proxy.md`.

## Smoke script

```bash
./scripts/validate_https_stack.sh
```

## Troubleshooting

- Port conflicts on **18080**, **18443**, **55432**: stop conflicting services or change `GDC_ENTRY_*` / compose publish mapping.
- Lab vs platform: use **`docs/local-docker-workflow.md`** when mixing dev-validation fixtures with the platform API.
