# 021 HTTPS reverse proxy runtime

## Purpose

Deliver real browser HTTP/HTTPS behavior controlled from **Admin Settings → HTTPS**, using an **nginx** reverse proxy as the single entrypoint while the FastAPI process stays on plain HTTP internally.

## Goals

- Default **HTTP only** until HTTPS is explicitly enabled in Admin Settings.
- When HTTPS is enabled: generate or reuse PEM material, render nginx config, optional HTTP→HTTPS redirect **only** when the TLS listener is healthy (otherwise keep HTTP reachable).
- Automatic **HTTP fallback** if TLS reload fails (never brick the UI).
- Preserve **JWT/session** behavior (no auth architecture changes).
- Do **not** touch StreamRunner, checkpoints, or Validation Lab isolation.

## Non-goals

- Let’s Encrypt / ACME, syslog TLS, OAuth/SAML, distributed sessions.

## Runtime

- `PUT /api/v1/admin/https-settings` updates DB, writes TLS files (with PEM backup), writes `GDC_NGINX_CONF_PATH`, and optionally `POST`s `GDC_PROXY_RELOAD_URL` with `GDC_PROXY_RELOAD_TOKEN`.
- When `GDC_PROXY_RELOAD_URL` is unset, the API still writes nginx config; operators reload nginx manually.
- `GDC_TRUST_PROXY_HEADERS` enables `ProxyHeadersMiddleware` so `X-Forwarded-Proto` reflects browser scheme.

## Deployment

See `docker-compose.platform.yml` and `docker/reverse-proxy/`.

Operator bind-mounted TLS and no public DB/API ports: `deploy/docker-compose.https.yml` and `docs/deployment/https-reverse-proxy.md`.
