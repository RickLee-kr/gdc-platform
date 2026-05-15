# Docker platform stack (HTTPS reverse proxy)

Production-style deployment uses `docker-compose.platform.yml`: PostgreSQL, API (`docker/Dockerfile.api`), and **nginx** as the single browser entrypoint (`reverse-proxy`).

**Scope:** This stack uses database **`gdc`** on the bundled `postgres` service and sets **`ENABLE_DEV_VALIDATION_LAB=false`**. It does **not** start the isolated lab Postgres (`gdc_test` / port **55432**) or WireMock test services, and it does **not** create `[DEV VALIDATION]` lab rows. For that workflow, see **`docs/local-docker-workflow.md`** and **`docs/testing/dev-validation-lab.md`**.

## Quick start (platform only)

```bash
docker compose -f docker-compose.platform.yml up -d --build
docker compose -f docker-compose.platform.yml run --rm api alembic upgrade head
docker compose -f docker-compose.platform.yml exec api python -m app.db.seed
```

- UI/API via proxy: **http://localhost:8080** (maps host `8080` → container `80`).
- HTTPS (after enabling in Admin Settings): **https://localhost:8443** (maps host `8443` → container `443`).
- Default stack sets `REQUIRE_AUTH=true`; `python -m app.db.seed` ensures **`admin`** exists when missing with password **`admin`** unless `GDC_SEED_ADMIN_PASSWORD` is set (8+ characters). That account must change the password on first login when the default is used. The module is **admin/bootstrap** seeding, not the development validation lab inventory.

## HTTP default behavior

- Until HTTPS is enabled in **Admin Settings**, nginx proxies HTTP only (no TLS listener).
- No redirect to HTTPS unless **Redirect HTTP to HTTPS** is enabled *and* the TLS listener is healthy.

## HTTPS (self-signed)

1. Sign in as an Administrator.
2. Open **Admin Settings → HTTPS / Security**.
3. Enable HTTPS, add at least one **IP or DNS SAN** (e.g. `127.0.0.1` and your LAN IP).
4. Save. The API generates PEM files under the mounted TLS volume and renders nginx config into the shared volume, then triggers an in-container reload (`GDC_PROXY_RELOAD_URL`).

Browsers show a **certificate warning** for self-signed certificates; trust or import the CA/site cert per org policy.

## Rollback to HTTP

- In Admin Settings, disable HTTPS and save. PEM files may remain on disk; nginx returns to HTTP-only routing.

## Fallback behavior

If TLS reload fails after enabling HTTPS, the API writes an **HTTP-only** nginx configuration so the UI stays reachable over HTTP. Admin Settings shows proxy reload detail and fallback hints.

## Smoke script

From the repo root (same ports as compose):

```bash
./scripts/validate_https_stack.sh
```

When **HTTP→HTTPS redirect** is enabled, plain HTTP URLs return `301`; the script follows to HTTPS with `-k`.

## Reverse-proxy bootstrap

The first named volume content for `/etc/nginx/conf.d` may contain the stock nginx `default.conf`. The proxy **entrypoint** replaces that stub with the API upstream bootstrap when it detects the default static site config.

## Limitations

- Let’s Encrypt / ACME are not implemented (see spec 021).
- With redirect enabled, **POST** requests to `http://…` may be redirected to HTTPS; use **`https://localhost:8443`** for API clients (e.g. login) when redirect is on.

## Troubleshooting (platform vs lab)

For **port 8000 conflicts**, **missing dev validation connectors while the platform API is up**, **`gdc-wiremock` / orphan Compose warnings**, and **Postgres healthy but wrong “seed” expectations**, use the consolidated guide:

- **`docs/local-docker-workflow.md`**
