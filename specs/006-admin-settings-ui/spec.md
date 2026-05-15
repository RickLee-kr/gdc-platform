# Admin Settings UI & Platform Admin API

## Scope

- SPA **Admin Settings** page at `/settings`: HTTPS self-signed configuration, local user accounts, password change, system info, and navigation to existing backup/import workspace.
- REST API under `/api/v1/admin/*` for persistence and validation.
- Out of scope: OAuth/SAML/MFA, full RBAC engine, Let’s Encrypt, live TLS reload, StreamRunner / delivery / checkpoint changes.

## Data model

- `platform_users`: local accounts with `role` in `ADMINISTRATOR` | `OPERATOR` | `VIEWER` and `status` in `ACTIVE` | `DISABLED`.
- `platform_https_config`: single row `id = 1` storing HTTPS flags, SAN lists (JSONB), validity days, and last generated certificate metadata.

## HTTPS flow

1. `GET /admin/https-settings` returns stored config plus a **best-effort** current access URL from the request.
2. `PUT /admin/https-settings` validates SANs; if `enabled`, requires at least one IP or DNS SAN, generates a **self-signed** PEM cert/key at paths from `GDC_TLS_CERT_PATH` / `GDC_TLS_KEY_PATH`, updates DB, and responds with `restart_required: true`.

## Safety

- Last active **Administrator** cannot be demoted, disabled, or deleted.
- Product UI strings remain English-only per constitution.
