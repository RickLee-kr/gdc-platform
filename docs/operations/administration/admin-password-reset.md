# Platform admin password reset (official recovery)

This document defines the **only supported operator workflow** for resetting the platform `admin` password without losing operational data.

Policy implementation: `app/platform_admin/admin_password_policy.py`  
Seed CLI: `python -m app.db.seed`  
Recovery script: `./scripts/admin/reset-admin-password.sh`

## Policy contract

| Scenario | Behavior |
|----------|----------|
| First install (no `admin` row) | Create `admin` with password `admin`, or `GDC_SEED_ADMIN_PASSWORD` when set (8+ chars). `must_change_password=true`. |
| Repeated bootstrap / `seed --platform-admin-only` | **Create-only.** Never change an existing password hash. |
| Explicit recovery | Set `GDC_RECONCILE_ADMIN_PASSWORD=true` **and** `GDC_SEED_ADMIN_PASSWORD`. Hash is **always** updated. Returns `password_reconcile: true`, `password_reconcile_reason: explicit_reset`. |
| Recovery without password | **Fails** with an explicit error (no silent skip). |

Operational data is never modified by admin password recovery:

- connectors, sources, streams, mappings, enrichments, destinations, routes, checkpoints, delivery_logs, runtime configuration, and non-admin credentials.

## Official reset command (recommended)

```bash
GDC_SEED_ADMIN_PASSWORD='YourNewPwd1!' ./scripts/admin/reset-admin-password.sh
```

The script runs inside the `api` container, sets `GDC_RECONCILE_ADMIN_PASSWORD=true`, and calls `python -m app.db.seed --platform-admin-only`.

## Equivalent API container command

```bash
docker compose -f docker-compose.platform.yml exec \
  -e GDC_SEED_ADMIN_PASSWORD='YourNewPwd1!' \
  -e GDC_RECONCILE_ADMIN_PASSWORD=true \
  api \
  python -m app.db.seed --platform-admin-only
```

Expected JSON fields when an existing admin is updated:

```python
{'password_reconcile': True, 'password_reconcile_reason': 'explicit_reset'}
```

CLI also prints an `[admin-reset]` summary block.

## What does **not** reset the password

Setting only `GDC_SEED_ADMIN_PASSWORD` on bootstrap/seed **without** `GDC_RECONCILE_ADMIN_PASSWORD=true` leaves an existing hash unchanged (`password_reconcile_reason: disabled`). This is intentional so install/bootstrap cannot silently overwrite production credentials.

## After reset

- `must_change_password` remains `true` until the user completes `POST /api/v1/auth/change-password`.
- `token_version` is bumped; outstanding JWTs for `admin` are invalidated.
- Validate login: `GDC_VALIDATE_ADMIN_PASSWORD='…' ./scripts/dev/validate-platform-ready.sh`

## Related

- `docs/deployment-readiness.md` — development bootstrap contract  
- `docs/operations/deployment/migration-integrity-validation.md` — migration + admin recovery checklist  
- `specs/039-default-admin-bootstrap/spec.md` — invariant spec
