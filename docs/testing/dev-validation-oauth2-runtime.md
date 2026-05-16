# Dev validation lab — OAuth2 and token URL runtime behavior

This note complements `docs/testing/dev-validation-lab.md` and `docs/runtime/runtime-capability-matrix.md`. It describes **what is actually exercised** when `[DEV VALIDATION]` HTTP streams run through `StreamRunner` (real `HttpPoller` → `apply_auth_to_http_request` → outbound HTTP).

## OAuth2 client credentials (`auth_type=oauth2_client_credentials`)

**Grant type:** `client_credentials` (form body `application/x-www-form-urlencoded`).

**Token endpoint:** Called on **every poll** inside `OAuth2ClientCredentialsStrategy` (`app/connectors/auth/runtime_extra_strategies.py`): each `HttpPoller.fetch` applies auth fresh; there is **no in-process token cache** and **no use of OAuth2 `refresh_token`** (that field is not part of this grant in typical vendor responses, and the strategy does not read it).

**Client authentication:** HTTP Basic (`httpx` `auth=(client_id, client_secret)`) while posting the form body — matches WireMock stub `tests/wiremock/mappings/template-okta-oauth-token.json`.

**Access token:** Parsed from JSON `access_token` and sent as `Authorization: Bearer …` to the resource request (e.g. `GET /api/v1/logs` via `tests/wiremock/mappings/template-okta-api-v1-logs.json`).

**Static bearer only?** No. Lab OAuth2 connectors store **client id / secret / token URL**, not a long-lived access token in `bearer_token`. Success requires a **live** `POST` to the token URL.

**Expiration / renewal:** The strategy does **not** read `expires_in`. Renewal is implicit: **the next poll performs another token `POST`**. This validates repeated acquisition, not clock-based refresh.

**Lab streams**

| Stream name (prefix `[DEV VALIDATION] `) | Validation level | Notes |
|------------------------------------------|-------------------|--------|
| `Stream OAuth2 client-credentials` | **Real runtime — full pipeline** | WireMock token + logs; `dev_lab_full_okta` continuous validation. |
| `Stream OAuth2 token-exchange-failure` | **Real runtime — negative path** | Token URL `…/token-reject` returns HTTP 401; fetch fails before mapping/delivery. Seeded validation `dev_lab_oauth_token_exchange_fail` is **disabled** so the scheduler does not spam failures — enable manually or use **Run once** to observe. |

## JWT refresh / token URL (`auth_type=jwt_refresh_token`)

This is **not** the OAuth2 authorization-code refresh grant. It is the platform’s **“refresh token in header → JSON access_token”** integration used for vendor-style refresh endpoints (`JwtRefreshTokenAuthStrategy` in the same module).

**Lab stream:** `[DEV VALIDATION] Stream OAuth2 refresh-cycle (JWT token URL)` — `POST` WireMock `/oauth2/lab/refresh` with `Authorization: Bearer lab-dev-validation-refresh-token`, then uses returned `access_token` against the same `/api/v1/logs` resource as the OAuth2 CC stream.

**Refresh cycle (OAuth2 RFC sense):** **Not validated** here — there is no rotating refresh token or refresh-grant form body. What **is** validated: **token URL request → JSON access_token → authenticated resource fetch**, again **on every poll** (no cache).

| Stream | Validation level |
|--------|------------------|
| `Stream OAuth2 refresh-cycle (JWT token URL)` | **Real runtime — full pipeline** (`dev_lab_oauth_jwt_refresh_full`) |

## Production-equivalent confidence

| Topic | Confidence |
|-------|------------|
| Client-credentials token HTTP exchange + bearer resource call | **High** for the implemented code path (matches common RFC patterns). |
| OAuth2 `refresh_token` grant or access-token caching/TTL | **Not implemented** in HTTP auth strategies — do not infer from lab green status. |
| Vendor-specific token JSON | Covered separately by `VENDOR_JWT_EXCHANGE` lab connector. |

## Related code

- `app/pollers/http_poller.py` — runtime fetch calls `apply_auth_to_http_request` each cycle.
- `app/connectors/auth/registry.py` — strategy dispatch.
- `app/connectors/auth_execute.py` — connector **auth lab** preview uses JSON token body for OAuth2 CC (differs from runtime form + Basic); use runtime/Wermock tests for poller truth.

## Tests

- `tests/test_plugin_adapters.py` — unit coverage for OAuth2 CC and JWT refresh strategies (mocked `httpx.Client`).
- WireMock-backed lab: `./scripts/validation-lab/start.sh` + UI or `POST /api/v1/runtime/streams/{id}/run-once` with WireMock reachable.
