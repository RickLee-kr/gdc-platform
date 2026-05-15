# Support bundle export

## Purpose

Allow **Administrator** operators to download a read-only ZIP of masked JSON for production troubleshooting.

## Rules

- Read-only: no writes to checkpoints, delivery pipeline, or runtime state.
- No raw secrets: use `mask_secrets`, `mask_secrets_and_pem`, webhook URL masking, and database URL masking consistent with admin APIs.
- Endpoint: `GET /api/v1/admin/support-bundle` with `require_roles(ADMINISTRATOR)` only.

## Bundle layout

JSON files listed in `manifest.json` inside the ZIP (format `gdc-support-bundle-v1`).
