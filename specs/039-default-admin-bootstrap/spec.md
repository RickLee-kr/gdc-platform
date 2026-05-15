# 039 Default admin bootstrap and mandatory password change

## Purpose

Improve first-time operational install UX with a deterministic default `admin` account and mandatory password change when the weak default is used.

## Rules

1. When no `admin` platform user exists, seed creates `admin` with password `admin` unless `GDC_SEED_ADMIN_PASSWORD` is set (then use that value). Create-only; never overwrites existing users.
2. Users created with the default `admin` password are persisted with `must_change_password=true`.
3. JWT access tokens carry an `mcp` claim when `must_change_password` is true. Middleware blocks all API paths except auth allowlist until the password is changed.
4. `POST /api/v1/auth/change-password` allows the authenticated user to rotate password (current + new + confirm), clears `must_change_password`, bumps `token_version`, and expects clients to sign in again.

## Non-goals

- No RBAC expansion beyond existing roles.
- No StreamRunner, connector, or runtime pipeline changes.
