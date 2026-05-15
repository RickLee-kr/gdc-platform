# 035 RBAC-lite (operational roles)

## Purpose

Add lightweight role separation for **Administrator**, **Operator**, and **Viewer**
accounts without enterprise IAM.  Rules stay local to the platform JWT session
(spec 020) and PostgreSQL-backed `platform_users`.

## Roles

| Role | Intent |
|------|--------|
| `ADMINISTRATOR` | Full platform configuration and destructive imports. |
| `OPERATOR` | Day-2 operations: runtime control, retention execution, backups preview/clone, validation mutations. |
| `VIEWER` | Read-only monitoring: dashboards, runtime metrics/logs, retention preview/status, backfill job reads. |

## Backend authority

- **Single evaluator**: `app.auth.route_access.evaluate_http_access(role, method, path)`
  is invoked from `role_guard_middleware` for every non-bypass request (all HTTP
  methods).  Narrow exceptions use `Depends(require_roles(...))` where path
  rules cannot express the split (e.g. retention GET open to viewers while
  POST `/retention/run` stays operator+admin).

- **Capabilities payload**: `build_capabilities(role)` adds a stable `capabilities`
  object to login / refresh / whoami responses for SPA alignment (server remains
  authoritative).

## Bypass paths

`POST /auth/logout` bypasses middleware role checks so Viewer sessions can end
cleanly without mutating workspace configuration.

## Non-goals

- No OAuth/OIDC, no external IdP, no multi-tenant IAM rewrite.

## English-only

All API messages, UI copy, and spec prose for shipped product remain English-only
per constitution.
