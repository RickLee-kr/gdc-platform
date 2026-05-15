# 027 — Maintenance Center (administrator health)

## Purpose

Provide a single read-only maintenance snapshot for production administrators: database readiness, migration alignment, scheduler state, retention cleanup, storage pressure, destination delivery health, TLS expiry, recent delivery failures (masked), and a support-bundle shortcut.

## API

- **Method / path:** `GET /api/v1/admin/maintenance/health`
- **Auth:** JWT bearer; **role:** `ADMINISTRATOR` only (`require_roles`).
- **Semantics:** Read-only. No checkpoint updates, no deletes/truncates, no retention runs, no configuration writes.

## Response shape

- `generated_at`, `overall` ∈ {`OK`, `WARN`, `ERROR`}
- `ok`, `warn`, `error`: lists of `{ code, message, panel }`
- `panels`: structured objects per area (`database`, `migrations`, `scheduler`, `retention`, `storage`, `destinations`, `certificates`, `recent_failures`, `support_bundle`)

## Alignment

- Reuses `startup_readiness`, Alembic `ScriptDirectory`, retention cleanup scheduler, `health_repository` aggregates, HTTPS cert helpers, delivery log models, and support-bundle masking helpers.
- Does not violate connector/stream/route separation; does not alter checkpoint timing rules.

## UI

- **Location:** Admin Settings → **Maintenance Center** section (cards + notices).
- **Access:** Data loads only when the effective role is Administrator; others see an access note without calling the endpoint.
