# 039 Default admin bootstrap and mandatory password change

## Purpose

Improve first-time operational install UX with a deterministic default `admin` account and mandatory password change when the weak default is used.

## Rules

1. When no `admin` platform user exists, seed creates `admin` with password `admin` in non-production unless `GDC_SEED_ADMIN_PASSWORD` is set (then use that value). Production must not use default credentials; `GDC_SEED_ADMIN_PASSWORD` is required for production admin creation.
2. Users created with the default `admin` password are persisted with `must_change_password=true`.
3. JWT access tokens carry an `mcp` claim when `must_change_password` is true. Middleware blocks all API paths except auth allowlist until the password is changed.
4. `POST /api/v1/auth/change-password` allows the authenticated user to rotate password (current + new + confirm), clears `must_change_password`, bumps `token_version`, and expects clients to sign in again.
5. Development/bootstrap flows use the canonical development contract: username `admin`, password from `GDC_SEED_ADMIN_PASSWORD` (the bundled platform compose/start scripts default it to `Stellar1!` for local rebuild determinism).
6. When `admin` already exists and `GDC_SEED_ADMIN_PASSWORD` is set, non-production bootstrap reconciliation verifies the password hash and updates stale hashes, bumping `token_version` and clearing `must_change_password`.
7. Production reconciliation is disabled by default and must be requested explicitly with `--reconcile-admin-password`; production must never silently overwrite an existing admin password hash.
8. Readiness validation must perform a real `POST /api/v1/auth/login` and require an `access_token`; an existing row alone is not sufficient.

## Non-goals

- No RBAC expansion beyond existing roles.
- No StreamRunner, connector, or runtime pipeline changes.
