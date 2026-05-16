# Operational data retention — operator guidance

This guide summarizes **what** the platform ages out automatically, **recommended windows**, and **how** to operate cleanup safely. Authoritative behaviour is defined in **`specs/034-data-retention/spec.md`**, implemented under `app/retention/`, `app/platform_admin/cleanup_service.py`, and the HTTP API `GET/POST /api/v1/retention/*`.

## Scope (what retention touches)

| Domain | Primary tables / artefacts | Default window (code) | Policy knobs |
|--------|----------------------------|----------------------|--------------|
| **Delivery logs** | `delivery_logs` | 30 days (`logs_retention_days` on `platform_retention_policy`) | `logs_enabled`, batch size, scheduler |
| **Runtime / validation metrics** | `validation_runs`, `validation_recovery_events` (and related operational rows per scheduler) | 30 days default in code defaults; **row** policy uses `runtime_metrics_retention_days` | `runtime_metrics_enabled` |
| **Validation snapshots** | `continuous_validations.last_perf_snapshot_json` cleared when older than snapshot window | 7 days env default (`GDC_RETENTION_VALIDATION_SNAPSHOTS_DAYS` overrides) | Supplement scheduler (`GDC_OPERATIONAL_RETENTION_INTERVAL_SEC`) |
| **Backfill progress** | `backfill_progress_events`, `backfill_jobs` (stale jobs only; **never** delete `RUNNING` / `CANCELLING`) | 14 days defaults | `GDC_RETENTION_BACKFILL_*` env overrides |

**Never deleted by retention:** connector/stream/source/destination/route/mapping/checkpoint configuration rows required for runtime semantics. Retention operates on **operational telemetry and job bookkeeping**, not on active topology.

## Recommended retention windows

These are **starting points** for a typical mid-size deployment; increase when compliance or forensics requires longer online history.

| Data | Recommended online retention | Notes |
|------|-------------------------------|-------|
| **delivery_logs** | 14–90 days | Higher volume → shorter window or smaller `cleanup_batch_size` to spread I/O. |
| **validation_runs / recovery events** | 30–180 days | Longer if validation SLAs need historical proof. |
| **validation snapshots (embedded JSON)** | 7–30 days | Large JSON snapshots benefit from shorter windows. |
| **backfill progress events** | 7–30 days | Operational noise; keep long enough to debug recent jobs. |
| **backfill jobs (terminal)** | 14–60 days | Retains audit of completed/failed jobs; running jobs are protected. |

## Archive strategy (out of band)

The product retention layer performs **online deletion in PostgreSQL** only. For compliance:

1. **Logical export** before tightening retention: `pg_dump` / `COPY (SELECT …)` for relevant tables into encrypted object storage.
2. **WORM or glacier** tier for yearly compliance bundles if required.
3. **Restore drill:** periodically prove dumps restore into a non-production cluster.

The platform does **not** ship automatic archival to S3; wire your organisation’s backup pipeline (`docs/deployment/backup-restore.md`, `docs/admin/backup-restore.md`).

## Cleanup schedule

- **Primary scheduler:** `OperationalRetentionScheduler` (`app/retention/scheduler.py`) — default tick on the order of **minutes** in production compose; see spec 034 for lifecycle.
- **Supplement bundle:** validation snapshot trim + backfill-related housekeeping — interval `GDC_OPERATIONAL_RETENTION_INTERVAL_SEC` (default **86400s** / daily).
- **Manual / CI-safe checks:** `GET /api/v1/retention/preview` (counts only) and `POST /api/v1/retention/run` with `dry_run: true`.

Use **Admin → Operational** UI or the API to confirm `cleanup_scheduler_enabled`, last run timestamps, and last deleted counts.

## Non-destructive operator scripts

Read-only / dry-run helpers live under `scripts/ops/` (see `scripts/ops/README.md`). They wrap the preview and dry-run retention APIs and **never** delete data by default.

## Related reading

- `specs/034-data-retention/spec.md`
- `app/retention/config.py` — `DEFAULT_RETENTION_POLICIES`
- `docs/deployment/uvicorn-gunicorn-production.md` — pool sizing vs retention batch load
