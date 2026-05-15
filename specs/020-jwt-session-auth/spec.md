# 020 Real session/JWT authentication (replaces X-GDC-Role trust)

## Purpose

Replace the temporary client-controlled `X-GDC-Role` / `X-GDC-Username` header
authentication (spec 019) with a real local JWT-based session system.

The platform stays local-only: no OAuth, no SAML, no MFA, no external IdP.
Role granularity stays as `ADMINISTRATOR / OPERATOR / VIEWER`.

## Goals

- Real login that issues a signed access token (JWT, HS256).
- Backend extracts the role from the signed token; clients can no longer
  forge a role by setting an HTTP header.
- Login / logout / session expiration are real (server-issued, server-validated).
- Frontend stores tokens locally and replays them via `Authorization: Bearer`.
- StreamRunner and the runtime pipeline are unaffected.

## Token shape

Access tokens are JWTs (algorithm HS256) with claims:

| Claim   | Source                          | Notes                                       |
|---------|---------------------------------|---------------------------------------------|
| `sub`   | `platform_users.username`       | string subject                              |
| `uid`   | `platform_users.id`             | int                                         |
| `role`  | `platform_users.role`           | `ADMINISTRATOR` / `OPERATOR` / `VIEWER`     |
| `tv`    | `platform_users.token_version`  | bumped on password change → revokes JWTs    |
| `typ`   | `"access"` or `"refresh"`       | distinguishes refresh from access tokens    |
| `iat`   | issuance unix timestamp         |                                             |
| `exp`   | expiry unix timestamp           |                                             |
| `jti`   | uuid4                           | unique token id (no DB persistence in v1)   |

Access tokens default to `ACCESS_TOKEN_EXPIRE_MINUTES` (60 min).  Refresh
tokens default to `REFRESH_TOKEN_EXPIRE_MINUTES` (24 hours).

The signing secret is `settings.JWT_SECRET_KEY` (falls back to
`settings.SECRET_KEY`).  In production the operator MUST set
`JWT_SECRET_KEY` (or `SECRET_KEY`) to a non-default value.

## Token version

`platform_users.token_version` (`INTEGER NOT NULL DEFAULT 1`) is incremented
when the user's password changes, when their role/status is updated by an
administrator, or when an administrator forces a logout.  Any previously
issued JWT carrying a stale `tv` claim is rejected by the role guard.

This gives us logout-on-password-change semantics without a refresh token
revocation table.

## Endpoints

| Verb | Path                          | Notes                                                       |
|------|-------------------------------|-------------------------------------------------------------|
| POST | `/api/v1/auth/login`          | username/password → access + refresh + role + expiry        |
| POST | `/api/v1/auth/refresh`        | refresh token → new access token (and rotated refresh)      |
| POST | `/api/v1/auth/logout`         | bumps `token_version` if requested → invalidates JWTs       |
| GET  | `/api/v1/auth/whoami`         | echoes the verified token claims (`401` if missing/invalid) |

`POST /auth/login` body:
```json
{ "username": "alice", "password": "..." }
```

`POST /auth/login` response:
```json
{
  "access_token": "<jwt>",
  "refresh_token": "<jwt>",
  "token_type": "bearer",
  "expires_in": 3600,
  "user": { "username": "alice", "role": "OPERATOR", "status": "ACTIVE" }
}
```

`POST /auth/refresh` body:
```json
{ "refresh_token": "<jwt>" }
```

`POST /auth/logout`:
- Accepts the access token via `Authorization: Bearer`.
- Optional body `{"revoke_all": true}` → bumps `token_version` (also revokes
  all other sessions for that user).
- Always returns `204`.

## Backend enforcement

`app.auth.role_guard.role_guard_middleware`:

1. Extracts the JWT from `Authorization: Bearer <token>`.
2. Verifies signature, expiry, and `tv` against the current user row.
3. Sets `request.state.auth = AuthContext(username, role, token_version)`.
4. Applies the same VIEWER/OPERATOR allow/deny rules as spec 019.
5. The `X-GDC-Role` / `X-GDC-Username` HTTP headers are **ignored** for
   role decisions in production.  When no `Authorization` header is
   present, behavior matches spec 019 fallback (ADMINISTRATOR) **only** if
   `settings.REQUIRE_AUTH=False` (the dev/CI default).
6. When `settings.REQUIRE_AUTH=True`, any non-bypass request without a
   valid bearer token returns `401 AUTH_REQUIRED`.

The OPERATOR deny list (`/admin/users`, `/admin/password`,
`/admin/https-settings`, `/admin/retention-policy`, `/admin/alert-settings`)
is unchanged.

## Frontend

- `POST /auth/login` returns the token bundle.
- The SPA stores `access_token`, `refresh_token`, the `user` object, and
  the absolute `expires_at` in `localStorage` under
  `gdc_platform_session_v1`.
- Every API request adds `Authorization: Bearer <access_token>` instead of
  `X-GDC-Role` / `X-GDC-Username`.
- On `401` the SPA tries `/auth/refresh` once; if that fails the user is
  redirected to the login page and the stored session is cleared.
- The session also expires client-side based on `expires_at` and triggers
  a redirect to login.

## Migration impact

- Additive: new column `platform_users.token_version INTEGER NOT NULL
  DEFAULT 1`.
- No existing row is rewritten; `DEFAULT 1` ensures previously seeded
  users continue to validate JWTs immediately after upgrade.
- The header-based role-trust path is preserved in test fixtures (gated
  behind `GDC_AUTH_DEV_HEADER_TRUST=1`) so existing automation can
  continue to exercise routes without minting tokens.  Production callers
  set this to `0` (the default).

## Do not touch

- StreamRunner / scheduler.
- Checkpoint success-after-delivery rule.
- Delivery routing, validation lab isolation, runtime pipeline ordering.
- Retention cleanup scheduler / alert webhook delivery (spec 019).
