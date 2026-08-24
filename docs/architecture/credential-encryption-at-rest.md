# Credential encryption-at-rest (deferred)

## Current limitation

Connected Credentials store secrets (including OAuth2 `access_token`,
`refresh_token`, and `client_secret`) as JSON in the `credentials.auth_json`
column. Values are **masked in API responses and logs** via `mask_secrets`, but
the database row is **not encrypted at rest** by the application.

This matches the Connected Credential foundation baseline: API redaction only,
no separate encryption subsystem.

## Out of scope (this work)

OAuth2 Authorization Code + refresh-token lifecycle intentionally does **not**
introduce application-level encryption-at-rest. Token persistence reuses the
existing `auth_json` column and masking contract.

## Follow-up

A dedicated encryption-at-rest design (key management, rotation, migration of
existing credential rows, and decrypt-on-read for runtime) should be tracked as
a separate task. Until then, protect the PostgreSQL volume and backups with
platform/infrastructure controls.
