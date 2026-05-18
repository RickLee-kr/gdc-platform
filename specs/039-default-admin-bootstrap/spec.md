# 039 Default admin bootstrap and mandatory password change

## Purpose

Define the immutable first-install administrator credential contract with a deterministic default `admin` account and mandatory first-login password change.

## Invariant

This is a guarded project invariant, not an implementation detail. Fresh install default credentials are `admin` / `admin`, `must_change_password=true` is required, random generated administrator passwords are forbidden, and repeated bootstrap must never overwrite an existing `admin` password hash.

## Rules

1. When no `admin` platform user exists, seed creates `admin` with password `admin` unless `GDC_SEED_ADMIN_PASSWORD` is set (then use that value). This applies to production bootstrap as well as development bootstrap.
2. Bootstrap-created administrator users are persisted with `must_change_password=true`, including users created from an explicit `GDC_SEED_ADMIN_PASSWORD` override.
3. JWT access tokens carry an `mcp` claim when `must_change_password` is true. Middleware blocks all API paths except auth allowlist until the password is changed.
4. `POST /api/v1/auth/change-password` allows the authenticated user to rotate password (current + new + confirm), clears `must_change_password`, bumps `token_version`, and expects clients to sign in again.
5. Bootstrap flows use the fixed operational contract: username `admin`, password `admin` when `GDC_SEED_ADMIN_PASSWORD` is unset. Install/start scripts must not generate, print, or persist random administrator passwords.
6. Repeated bootstrap/install is create-only for an existing `admin` row. It must not reset an existing administrator password hash or clear `must_change_password`.
7. Password reconciliation/reset is disabled by default and must be requested explicitly with a recovery command; bootstrap must never silently overwrite an existing admin password hash.
8. Readiness validation must perform a real `POST /api/v1/auth/login` and require an `access_token`; an existing row alone is not sufficient.

## Non-goals

- No RBAC expansion beyond existing roles.
- No StreamRunner, connector, or runtime pipeline changes.
