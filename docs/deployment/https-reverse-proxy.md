# HTTPS reverse proxy deployment

This guide describes a **production-style** deployment path for the Generic Data Connector Platform using the **existing nginx reverse proxy** (see `docker/reverse-proxy/`, `docker-compose.platform.yml`, and spec `specs/021-https-reverse-proxy/spec.md`). The FastAPI process stays on **plain HTTP** inside the Docker network; TLS is terminated at nginx.

> **Note:** Browser-facing HTTPS here is separate from **`SYSLOG_TLS`** destinations (`specs/024-syslog-tls-destination/spec.md`, `specs/004-delivery-routing/spec.md`), which terminate TLS on outbound syslog delivery from the platform to your SIEM listeners.

## Why nginx

The platform already ships an nginx sidecar, Admin HTTPS settings that render nginx config, and an in-container reload hook. Adding a second proxy (Caddy) would duplicate behavior without benefit for this repository.

## Routing (single browser entrypoint)

| Path | Upstream |
|------|-----------|
| `/api/` | API (`API_PREFIX` default `/api/v1/...`) |
| `/health` | API liveness |
| `/` | API (serves built SPA from `frontend/dist` in the API image, plus SPA fallback) |

Forwarded headers: `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Real-IP`. The API enables `ProxyHeadersMiddleware` when `GDC_TRUST_PROXY_HEADERS=true` (set in compose).

WebSocket-ready headers: `Upgrade` and `Connection` are passed using the standard nginx `map` pattern (`docker/reverse-proxy/nginx.conf`).

## Stacks

| File | Use case |
|------|-----------|
| `docker-compose.yml` | Local dev: PostgreSQL (and optional WireMock `test` profile). Ports unchanged. |
| `docker-compose.platform.yml` | Full stack: DB + API + nginx; HTTP `:8080`, optional HTTPS `:8443` after TLS is enabled; API also published on host `${GDC_API_HOST_PORT:-8000}`. |
| `deploy/docker-compose.https.yml` | **Production-style**: DB not on host, API not on host, TLS PEM bind-mounted from `deploy/tls/`. |

## Self-signed TLS material

Generate a private key and certificate **on the operator machine** (do not commit them). Example (adjust `CN` / SAN for your DNS name or NAT IP):

```bash
mkdir -p deploy/tls
openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
  -keyout deploy/tls/server.key \
  -out deploy/tls/server.crt \
  -subj "/CN=gdc.example.local" \
  -addext "subjectAltName=DNS:gdc.example.local,DNS:localhost,IP:127.0.0.1,IP:10.0.0.5"
```

Mount layout (handled by `deploy/docker-compose.https.yml`):

- `deploy/tls/server.crt` → `/var/gdc/tls/server.crt` (API + nginx read)
- `deploy/tls/server.key` → `/var/gdc/tls/server.key` (API + nginx read)

File modes: restrict `server.key` (`chmod 600 deploy/tls/server.key`).

### Browser trust warnings

Self-signed certificates are **not** chained to a public CA. Browsers show a warning (name mismatch, untrusted issuer, or both) until the user proceeds once or the organization installs the CA / server cert in a trust store. This is expected for labs and private NAT deployments.

### DNS vs private NAT IP

- **DNS**: Put an A/AAAA record for your hostname to the host’s public or private IP; generate the cert with matching `CN` / `subjectAltName`.
- **NAT only**: Use the host’s **internal** IP in SAN (see `IP:10.0.0.5` above). Operators reach `https://<internal-ip>:8443` (or your chosen `GDC_ENTRY_HTTPS_PORT`). Ensure corporate DNS or split-horizon DNS matches if you use a hostname.

Set `GDC_PUBLIC_HTTPS_PORT` to the **host** HTTPS port browsers use (default `8443` in the deploy file) so Admin-driven HTTP→HTTPS redirects match reality.

## First-time sign-in (platform install)

When no `admin` user exists yet, seeding creates **`admin`** with password **`admin`** unless `GDC_SEED_ADMIN_PASSWORD` is set. The default password requires an immediate change after login (`POST /api/v1/auth/change-password`). Existing `admin` credentials are never overwritten by install or seed scripts.

## Environment

Copy root `.env.example` to `.env` and set at least:

- `JWT_SECRET_KEY` — strong random secret (required for auth in production).
- `GDC_PROXY_RELOAD_TOKEN` — long random string shared by API and nginx reload hook (defaults to `devtoken` in examples; **change for production**).
- Optional: `POSTGRES_PASSWORD` — must match `DATABASE_URL` construction if you change it (compose uses the same variable for the superuser password).

Root `docker-compose.yml` **dev ports** (e.g. `5432:5432`) are unaffected by the HTTPS deploy file.

## Compose commands

For scripted install, upgrade, and backup workflows (release candidate), see `docs/deployment/install-guide.md`, `docs/deployment/upgrade-guide.md`, and `docs/deployment/backup-restore.md`.

Validate configuration (no containers started):

```bash
cd /path/to/gdc-platform
docker compose -f deploy/docker-compose.https.yml config -q
```

Build and start:

```bash
docker compose -f deploy/docker-compose.https.yml --env-file .env up -d --build
```

Optional: override published ports (defaults `8080`→80, `8443`→443 in container):

```bash
export GDC_ENTRY_HTTP_PORT=80
export GDC_ENTRY_HTTPS_PORT=443
export GDC_PUBLIC_HTTPS_PORT=443
docker compose -f deploy/docker-compose.https.yml --env-file .env up -d
```

Bind to localhost only (example):

```bash
export GDC_ENTRY_HTTP_PORT=127.0.0.1:8080:80
export GDC_ENTRY_HTTPS_PORT=127.0.0.1:8443:443
```

## Enabling HTTPS inside nginx

1. Start the stack with valid PEM files under `deploy/tls/`.
2. Use **Admin → HTTPS** in the UI (or the documented admin API) to enable TLS, render nginx config, and trigger reload via `GDC_PROXY_RELOAD_URL`.

If reload fails, the API falls back to HTTP-only nginx config so the operator is not locked out (see `apply_nginx_runtime`).

## Verification

### Compose validation

```bash
docker compose -f deploy/docker-compose.https.yml config -q
```

### curl (HTTP through proxy)

```bash
curl -fsS "http://127.0.0.1:8080/health"
curl -fsS "http://127.0.0.1:8080/api/v1/..." # replace with a real route when authenticated
```

### curl (HTTPS, self-signed)

```bash
curl -fsSk "https://127.0.0.1:8443/health"
```

### Browser

- HTTP UI: `http://<host>:8080/`
- HTTPS UI: `https://<host>:8443/` (after TLS is enabled and certs are loaded)

## Troubleshooting checklist

1. **`docker compose config` fails** — Run from repository root; check env syntax and that `deploy/docker-compose.https.yml` paths resolve.
2. **502 / empty from nginx** — Confirm API health: `docker compose -f deploy/docker-compose.https.yml exec api wget -qO- http://127.0.0.1:8000/health`.
3. **HTTPS not listening** — Ensure Admin HTTPS enabled and PEM valid; check API logs for nginx apply outcome; run `docker compose ... exec reverse-proxy nginx -t`.
4. **Redirect loop** — `GDC_PUBLIC_HTTPS_PORT` must match the port clients use; `GDC_TRUST_PROXY_HEADERS` must be true when behind nginx.
5. **Certificate warnings** — Expected for self-signed; fix SAN/CN or install trust.
6. **Permission denied on `server.key`** — Check host file permissions and SELinux/AppArmor labels for bind mounts.

## See also: upstream and worker timeouts

Align nginx `proxy_read_timeout` / `proxy_send_timeout` (and any load balancer idle timeout) with Gunicorn/Uvicorn worker timeouts and bounded DB `statement_timeout` values so clients receive deterministic errors instead of hung sockets. See **`docs/deployment/uvicorn-gunicorn-production.md`**.

## Rollback to HTTP dev mode

1. Stop the HTTPS stack: `docker compose -f deploy/docker-compose.https.yml down`.
2. Use **`docker-compose.yml`** for PostgreSQL-only local work, or **`docker-compose.platform.yml`** for the standard HTTP entry on port **8080** without publishing the DB.
3. For day-to-day UI development with Vite, continue using `frontend/README.md` (dev server) and a local API; no change to frontend runtime logic is required.

## Limitations

- No ACME / Let’s Encrypt automation in this guide (bring your own PEM or use a corporate CA).
- No Kubernetes manifests.
- Syslog TLS to destinations is separate (see `specs/024-syslog-tls-destination/spec.md`); this document covers **browser → platform** TLS only.
