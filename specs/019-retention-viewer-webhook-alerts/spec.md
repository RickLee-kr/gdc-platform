# 019 Operational platform layer: retention cleanup, viewer enforcement, webhook alerts

## Purpose

Add the next operational platform layer on top of specs 006/007:

1. Real retention cleanup scheduler (`platform_retention_policy` becomes executable).
2. Backend-enforced Viewer/Operator/Administrator roles (lightweight, not full RBAC).
3. Real webhook alert delivery with cooldown / dedupe / history.

## Rules

- PostgreSQL only; additive columns on `platform_retention_policy` and one new table `platform_alert_history`.
- Cleanup never touches `checkpoints`, active configuration entities, or running stream state.
- Cleanup uses batched deletes (`id IN (subquery LIMIT batch_size)`) so long table locks are avoided.
- Categories with no underlying table (e.g. preview cache) report `not_applicable`; never invent metrics.
- Viewer enforcement happens server-side via a request middleware reading `X-GDC-Role` (lightweight); the front-end still hides actions but the server is the source of truth.
- Alert delivery is fire-and-forget HTTP. Failures are persisted in `platform_alert_history` and **must not** affect StreamRunner / checkpoint behavior.
- Cooldown windows deduplicate identical alerts (`alert_type` + `stream_id` + `route_id` + `destination_id`) within `cooldown_seconds`.
- WARN-only validation alerting from spec 017 is unchanged.

## References

- Implementation: `app/platform_admin/cleanup_service.py`, `app/platform_admin/cleanup_scheduler.py`, `app/platform_admin/alert_service.py`, `app/platform_admin/alert_monitor.py`, `app/auth/role_guard.py`
- Migration: `alembic/versions/20260512_0011_retention_alert_ops.py`
- API surface: extends `/api/v1/admin/retention-policy` and `/api/v1/admin/alert-settings` (run + status + test + history)
- Tests: `tests/test_retention_cleanup_service.py`, `tests/test_viewer_role_enforcement.py`, `tests/test_alert_webhook_delivery.py`
