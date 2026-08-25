# Maintenance Center

The **Maintenance Center** is an administrator-only area under **Admin Settings**. It calls `GET /api/v1/admin/maintenance/health` to show a read-only snapshot of platform readiness.

## Who can use it

- **Administrator** JWT: full JSON and UI cards load.
- **Operator / Viewer:** the UI shows an access note; the API returns **403** if called directly.

## What it checks

| Area | Meaning |
|------|--------|
| **Database** | PostgreSQL probe, masked `DATABASE_URL`, short server version string. |
| **Migrations** | `alembic_version` vs Alembic script heads from the deployed repo. |
| **Scheduler** | Stream scheduler supervisor uptime / worker count vs startup DB gate. |
| **Retention** | Policy scheduler enabled flag, background thread liveness, tick staleness. |
| **Disk / storage** | Host disk usage on `/` (used %, free space). |
| **Destinations** | Per-destination success/failure counts in the last hour; spike warnings. |
| **Certificates** | When HTTPS is enabled, days until `certificate_not_after`. |
| **Recent failures** | Latest failure-stage `delivery_logs` rows with masked `payload_sample` and PEM-safe messages. |
| **Support bundle** | Shortcut button → same download as `GET /api/v1/admin/support-bundle`. |

## Notice rules (summary)

- **ERROR:** database unreachable; Alembic not stamped / mismatch / multiple heads; stream scheduler expected but not running; TLS expiring within **7** days (HTTPS on); disk used **≥ 95%**.
- **WARN:** DB latency high; Alembic heads file unreadable; scheduler up but **0** workers while streams enabled; retention scheduler disabled or thread down or tick stale; disk **≥ 85%**; TLS within **30** days or expiry unknown; destination failure spike in 1h; recent failure rows present.

## Operational guarantees

- **Read-only:** no checkpoint changes, no data deletion, no truncate, no retention execution from this view.
- **Secrets:** database passwords are masked; failure payloads use the same masking patterns as the support bundle; PEM literals in text are redacted.

## Related endpoints

- Support bundle: `GET /api/v1/admin/support-bundle`
- Legacy health metrics: `GET /api/v1/admin/health-summary`
- Runtime startup snapshot: `GET /api/v1/runtime/status`
