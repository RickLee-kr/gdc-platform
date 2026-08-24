# Credential encryption-at-rest (application-level)

## Purpose

Connected Credentials (and legacy ``Source.auth_json``) store secrets such as
OAuth2 ``access_token`` / ``refresh_token`` / ``client_secret``, bearer tokens,
API keys, and passwords. Values are **masked** in API responses and logs via
``mask_secrets``. This design adds **application-level encryption-at-rest** so
PostgreSQL rows do not retain those secrets as plaintext JSON strings.

This is intentionally a **minimal** encryption layer for Data Relay — not a
general-purpose KMS platform.

## Algorithm and envelope

- **Algorithm:** AES-256-GCM (via ``cryptography.hazmat.primitives.ciphers.aead.AESGCM``)
- **Key derivation:** HKDF-SHA256 over ``ENCRYPTION_KEY`` (salt/info fixed per
  envelope version; ``kid`` bound into HKDF info and AAD)
- **Envelope version:** ``1`` (field ``__gdc_enc__``)
- **Key source:** ``ENCRYPTION_KEY`` (+ optional ``ENCRYPTION_KEY_ID``, default ``1``)

Encrypted secret values are JSON objects, for example:

```json
{
  "__gdc_enc__": 1,
  "alg": "AESGCM",
  "kid": "1",
  "n": "<urlsafe-b64 nonce>",
  "ct": "<urlsafe-b64 ciphertext||tag>"
}
```

Non-secret operational fields (``auth_type``, ``status``, ``expires_at``,
``token_url``, …) remain plaintext so status / type queries stay usable.

Secret field detection reuses ``is_sensitive_field_name`` /
``SENSITIVE_FIELD_NAMES`` from ``app/security/secrets.py`` (same criteria as
API masking).

## Fail-closed rules

- Unusable ``ENCRYPTION_KEY`` (empty, known placeholder, shorter than 32 chars):
  **crypto operations raise** — never silently store plaintext secrets.
- Decrypt with wrong key / tampered ciphertext: **authentication failure**.
- Encrypted data with missing key: **fail closed**.
- Production startup still rejects insecure ``ENCRYPTION_KEY`` via
  ``app/production_security.py``.

## Runtime contract

| Path | Behavior |
|------|----------|
| Credential / Source write | Encrypt plaintext secret fields (idempotent; envelopes skipped) |
| Runtime auth resolution | Decrypt envelopes; legacy plaintext still accepted |
| API serialize / backup export | ``mask_secrets`` without exposing plaintext |
| OAuth refresh / code exchange | Decrypt → use → encrypt on persist (atomic refresh unchanged) |

SQLAlchemy ``before_insert`` / ``before_update`` listeners on ``Credential`` and
``Source`` encrypt any remaining plaintext secrets so alternate write paths
(import, seed, lab) cannot bypass encryption when a usable key is configured.

## Backward compatibility

Existing plaintext ``auth_json`` rows remain readable. New writes encrypt. Bulk
upgrade is idempotent:

```bash
python -m app.security.migrate_encrypt_auth_json
```

Partial failure is per-row (commit after each successful encrypt). Encryption
failure does not overwrite the prior plaintext value for that row.

## Key rotation foundation

Envelopes carry ``kid``. ``ENCRYPTION_KEY_ID`` selects the active id for new
ciphertexts. Automatic multi-key rotation UI/KMS is **out of scope**; the
envelope shape must not prevent a future decrypt-with-old-key / re-encrypt
pass.

## Out of scope

- External KMS mandatory dependency
- Custom crypto primitives
- Encrypting entire ``auth_json`` blobs
- Destination ``config_json`` encryption (separate follow-up if needed)
- OAuth flow redesign, Queue/Circuit/Concurrency changes
