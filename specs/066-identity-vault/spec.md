# 066 — Identity Vault MVP (M7)

## Scope

- `identity_vault_entries` table (hash-only; no plaintext values)
- Global token sequence `USER_000001`, …
- Protection mode `tokenization` via existing `protect_batch` / preview hooks
- Read-only `GET /runtime/protection/vault/summary`

## Out of scope

- Policy Engine, routing, classification, vault detail UI, reversible detokenization API

## Security

- Persist `original_value_hash` only (SHA-256 over salted canonical value + stream + path)
- Preview/pipeline-debug commit vault rows when tokenization rules are enabled
