# 034 — Operational data retention (PostgreSQL)

## Purpose

Lightweight **automatic deletion** of aged operational rows to protect PostgreSQL performance. This is not archival, cold storage, or a data lake. Work runs **outside** `StreamRunner` and does not change checkpoint semantics.

## Scope

Applies to:

- `delivery_logs` (policy `logs_retention_days`, `logs_enabled`)
- `validation_runs` and `validation_recovery_events` (`runtime_metrics_retention_days`, `runtime_metrics_enabled`)
- `continuous_validations.last_perf_snapshot_json` (cleared when `updated_at` is older than the validation snapshot window; see env defaults)
- `backfill_jobs` and `backfill_progress_events` (defaults 14 days; env overrides; never delete jobs in `RUNNING` or `CANCELLING`)

Category cleanup in `platform_admin.cleanup_service` also covers **non-row** targets when enabled (e.g. `preview_cache`, `backup_temp`) per category configuration.

## Non-goals

- External archive (S3, etc.)
- Changing StreamRunner transaction ownership or checkpoint semantics
- SQLite
- Celery, Kafka, Redis, or a second retention daemon thread

## APIs

- `GET /api/v1/retention/preview` — counts and oldest timestamps per operational target
- `GET /api/v1/retention/status` — resolved policy days, `operational_retention_meta` (including supplement throttle), last operational retention audit
- `POST /api/v1/retention/run` — batched cleanup (`dry_run`, optional `tables`)

## Scheduler — single lifecycle

**Authoritative class:** `OperationalRetentionScheduler` (`app/retention/scheduler.py`).

- **One** daemon thread (`operational-retention-scheduler`), registered and started/stopped from application lifespan (`app/main.py`) alongside other supervisors (when startup readiness allows schedulers to start).
- **Start:** spawns the thread; repeated `start()` is a no-op if already alive.
- **Stop:** signals stop, `join` with timeout, clears the thread handle; structured log on stop.
- **Tick loop:** each iteration runs `_sweep()` inside a process-wide lock, then sleeps `max(tick_seconds, 5)` (default `tick_seconds` is 60 unless overridden for tests/diagnostics). Loop errors are logged and do not exit the thread.
- **Diagnostics:** `trigger_once()` runs one synchronous sweep (e.g. tests).

## Retention cleanup flow (per sweep)

Order within `_sweep()`:

1. **Category path** — If `platform_retention_policy.cleanup_scheduler_enabled` is false, record that the category scheduler is disabled and **return** (no supplement pass this tick).
2. Otherwise `collect_due_categories` → for each due category, `run_cleanup` via `platform_admin.cleanup_service` (`dry_run=False`, actor `operational_retention_scheduler`, `trigger="scheduler"`). Outcomes are summarized on the instance (`categories:...`).
3. Session rows are expired; policy row is re-read.
4. **Supplement path** — Only if `GDC_OPERATIONAL_RETENTION_SUPPLEMENT_ENABLED` is true, `supplement_due(policy_row)` is true, then `run_supplement_bundle` runs (`trigger="supplement_scheduler"`). Otherwise the instance records supplement skipped / not due.

`supplement_due` requires `cleanup_scheduler_enabled` and compares `now` to `operational_retention_meta.supplement_next_after` (missing or invalid timestamp treats supplement as due).

## Supplement bundle integration

`run_supplement_bundle` (`app/retention/service.py`) restricts tables to **backfill** and **validation snapshot** targets only: `backfill_progress_events`, `backfill_jobs`, `continuous_validations` snapshot field (`validation_snapshots` logical key). It delegates to `run_operational_retention` with that subset.

After a successful non–dry-run supplement, `schedule_next_supplement` persists the next throttle time using `GDC_OPERATIONAL_RETENTION_INTERVAL_SEC` (default 86400s).

## Metadata tracking (`operational_retention_meta` JSONB)

- **`supplement_next_after`** — ISO timestamp; supplement bundle runs only when `now` is at or past this instant (subject to flags above). Initialized / advanced by supplement scheduling logic.
- **`last_operational_retention_at`** and **`last_operational_retention_tables`** — updated after a non–dry-run operational retention run that produces outcomes (audit-oriented mirror of last supplement table outcomes).

Per-category cleanup persistence (next run times, last outcome fields on `platform_retention_policy`) remains owned by `cleanup_service` / `run_cleanup`.

## Safety protections

- **Cutoff:** eligible rows are **strictly older than** the retention window cutoff (`time < cutoff`).
- **Active backfill:** jobs in `RUNNING` or `CANCELLING` are never deleted; dependent deletes respect the same guard where applicable.
- **Feature flags:** `logs_enabled` / `runtime_metrics_enabled` skip corresponding operational deletes with explicit skipped outcomes.
- **Concurrency:** one sweep at a time (`threading.Lock` on the scheduler instance).
- **Isolation:** retention does not mutate checkpoints, connectors, streams, routes, destinations, sources, mappings, or enrichments.

## Batch delete behavior

- Batch size: `max(100, cleanup_batch_size)` from `platform_retention_policy` (typical default 5000).
- Row deletes use batched `DELETE` patterns (subquery-limited IDs, `synchronize_session=False`) with **`commit` after each batch** to limit lock duration. Iteration caps (e.g. 200 batches per table pass) prevent unbounded loops.
- Snapshot clearing updates `last_perf_snapshot_json` in batches with per-batch commit.
- API `POST /api/v1/retention/run` uses the same batched operational retention implementation.

## Configuration

- Module defaults: `app.retention.config.DEFAULT_RETENTION_POLICIES`
- Env overrides: `GDC_RETENTION_BACKFILL_JOBS_DAYS`, `GDC_RETENTION_BACKFILL_PROGRESS_EVENTS_DAYS`, `GDC_RETENTION_VALIDATION_SNAPSHOTS_DAYS`, `GDC_OPERATIONAL_RETENTION_INTERVAL_SEC`, `GDC_OPERATIONAL_RETENTION_SUPPLEMENT_ENABLED`
- Destructive execution is disabled by default and requires `GDC_RETENTION_DESTRUCTIVE_ACTIONS_ENABLED=true`.
- Production manual deletes additionally require `GDC_RETENTION_PRODUCTION_DELETES_ENABLED=true`; automatic deletes are forbidden in production.
- Scheduler deletes outside production require `GDC_RETENTION_AUTOMATIC_DELETES_ENABLED=true`.
- Delivery log partition drop execution is controlled separately by `GDC_RETENTION_DELIVERY_LOG_PARTITION_DROP_ENABLED`; dry-run preview remains available without this flag.
- Expired runtime aggregate snapshot cleanup requires `GDC_RUNTIME_AGGREGATE_SNAPSHOT_CLEANUP_ENABLED=true`; otherwise cleanup returns the eligible count without deleting rows.

## Delivery log partition retention

`delivery_logs` retention is partition-aware for preview and planning:

- Candidate drop targets are calculated from canonical `delivery_logs_YYYY_MM` monthly partitions.
- A target is returned only when the whole monthly range is older than the retention cutoff.
- Current and next month partitions are always protected, even if an operator configures an aggressive retention window.
- Dry-run output includes target partition names and row counts before any destructive path can be enabled.
- Migrations must never drop partitions or delete retention-aged data.

## Deprecated compatibility aliases only

Do **not** treat these as separate schedulers:

- **`OperationalRetentionSupplementScheduler`**, **`register_operational_retention_supplement_scheduler`**, **`get_operational_retention_supplement_scheduler`** — same object as `OperationalRetentionScheduler` / `register_operational_retention_scheduler` / `get_operational_retention_scheduler` (`app/retention/scheduler.py`).
- **`RetentionCleanupScheduler`**, **`register_cleanup_scheduler`**, **`get_cleanup_scheduler`** — same class as `OperationalRetentionScheduler` (`app/platform_admin/cleanup_scheduler.py`).

New code and documentation MUST refer to **`OperationalRetentionScheduler`** and the `register_` / `get_operational_retention_scheduler` helpers.
