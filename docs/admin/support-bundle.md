# Support bundle (Administrator)

## Overview

The support bundle is a **read-only** ZIP download containing **masked** JSON summaries. It is intended for production troubleshooting without exposing passwords, API tokens, TLS private keys, or raw database credentials.

## Who can download

- **Administrator** only (`GET /api/v1/admin/support-bundle`).
- Operators and viewers receive HTTP **403** with `ROLE_FORBIDDEN`.

## UI

**Admin settings** → **Support bundle** → **Generate Support Bundle** downloads the `.zip` file (Administrator session required).

## Bundle contents

| File | Contents |
|------|-----------|
| `manifest.json` | UTC timestamp, bundle format id, file list, row limits |
| `app_version_config.json` | API version, app name/env, auth flags, masked DB URL, DB reachability |
| `runtime_health.json` | Same structured health summary as `GET /api/v1/admin/health-summary` (DB·파이프라인 KPI만; **not** the full `GET /api/v1/admin/maintenance/health` panels) |
| `connectors.json` | Connector id, name, description, status, timestamps |
| `sources.json` | Source metadata + **masked** `config_json` / `auth_json` |
| `streams.json` | Stream metadata + **masked** `config_json` / `rate_limit_json` |
| `destinations.json` | Destination metadata + **masked** `config_json` / `rate_limit_json` |
| `routes.json` | Route metadata + **masked** formatter / rate limit JSON |
| `delivery_logs_recent.json` | Recent delivery rows (see limits in manifest); **masked** `payload_sample`; PEM patterns stripped from text fields |
| `audit_logs_recent.json` | Recent audit rows; **masked** `details_json` |
| `retention_and_config_versions.json` | Retention policy summary + config-version index (no full snapshots) |
| `checkpoints.json` | Checkpoint metadata + **masked** `checkpoint_value_json` |
| `backend_frontend_metadata.json` | Sanitized settings field map, HTTPS public summary, masked alert webhook hints, documented `VITE_*` keys (values not embedded) |

## Masking guarantees

- Dict keys such as `secret_key`, `access_key`, `password`, `token`, `api_key_value`, `private_key`, etc. are replaced with `********` via `app.security.secrets.mask_secrets` (composed as `mask_secrets_and_pem` in the bundle pipeline).
- Any string value containing a PEM block (`-----BEGIN` … `-----END`) is replaced with `********` via `redact_pem_literals`.
- Webhook URLs use `mask_webhook_url` (scheme + host preserved; path/query summarized).
- `DATABASE_URL` appears only as a **masked** string in summaries (`****` in password segment).
- Named high-risk settings (`SECRET_KEY`, `JWT_SECRET_KEY`, `ENCRYPTION_KEY`, MinIO secrets, proxy reload token, validation secrets, dev lab SFTP/SSH passwords) are emitted as `********` when non-empty in `backend_settings_metadata`.

## Limits

Row limits for logs and config-version tail are defined in `manifest.json` (defaults: 200 delivery logs, 100 audit events, 40 recent config-version rows).

## Operational notes

- Generating a bundle does **not** change retention, checkpoints, stream execution, or delivery.
- For client build-time configuration, compare the deployed static bundle environment (e.g. Kubernetes/Compose) with the documented `VITE_*` keys listed in `backend_frontend_metadata.json`.

Related spec: `specs/026-support-bundle/spec.md`.

For **which diagnostics live in the bundle vs other APIs** (migration integrity, scheduler, stale snapshots), see `docs/operations/support-diagnostics-guide.md`.
