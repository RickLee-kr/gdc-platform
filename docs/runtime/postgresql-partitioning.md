# PostgreSQL partitioning for runtime operational tables

## Overview

`delivery_logs` uses PostgreSQL native **monthly range partitioning** on `created_at`. Child tables follow the naming convention `delivery_logs_YYYY_MM` (for example `delivery_logs_2026_05`). A `delivery_logs_default` child catches rows when a monthly partition is missing.

Checkpoint history and checkpoint trace APIs read the same table (`stage = checkpoint_update`); there is no separate checkpoint history heap.

## Migration

Alembic revision `20260517_0021_obs_scale` (`alembic/versions/20260517_0021_observability_scale_foundation.py`):

1. Renames the existing heap to `delivery_logs_unpartitioned`
2. Creates a partitioned parent with composite primary key `(id, created_at)`
3. Creates monthly children for the data date range plus current/next month
4. Copies rows back and drops the staging table

### Duration and locking

| Phase | Typical impact |
|-------|----------------|
| `ALTER TABLE … RENAME` | Brief metadata lock |
| `CREATE TABLE` parent + children | Metadata only |
| `INSERT … SELECT` | Row-level work; duration scales with table size; may hold `ACCESS EXCLUSIVE` on new parent briefly |
| Index creation on parent | Builds on partitioned catalog; propagates to children |

Plan a maintenance window for large deployments (millions of rows). The migration is **one-way** in Alembic downgrade: downgrade removes `runtime_aggregate_snapshots` only; reversing partitioning requires a manual, data-safe operator procedure.

### Rollback

Automatic downgrade does **not** convert partitioned `delivery_logs` back to a heap. To roll back manually:

1. Stop writers (pause schedulers)
2. Create a new heap table with the original PK on `id` only
3. `INSERT INTO heap SELECT … FROM delivery_logs`
4. Swap names and reattach foreign keys
5. Drop old partitioned structure after verification

## Runtime maintenance

| Mechanism | When | Behavior |
|-----------|------|----------|
| Startup | API lifespan when schema is ready | `run_partition_maintenance_gracefully` — fail-open |
| `PartitionMaintenanceScheduler` | Hourly (configurable) | Ensures current + `GDC_PARTITION_MAINTENANCE_MONTHS_AHEAD` months |
| `DeliveryLog` `before_insert` | Unusual `created_at` months | Best-effort `CREATE TABLE IF NOT EXISTS` for that month |

Disable background maintenance with `GDC_PARTITION_MAINTENANCE_ENABLED=false`.

## Retention

Row deletes use batched `DELETE` in `app/retention/service.py`. Whole-partition drops are optional and faster for aged months:

- Preview: `GET /api/v1/retention/preview` includes `partition_drop_targets`
- Execute: requires `GDC_RETENTION_DESTRUCTIVE_ACTIONS_ENABLED` and `GDC_RETENTION_DELIVERY_LOG_PARTITION_DROP_ENABLED`

Protected partitions: **current month** and **next month** are never eligible.

Environment overrides:

```bash
GDC_DELIVERY_LOG_RETENTION_DAYS=90
GDC_CHECKPOINT_HISTORY_RETENTION_DAYS=180
```

`checkpoint_history_days` governs how long `checkpoint_update` rows remain queryable; storage is still `delivery_logs`.

## Archival foundation (export-ready)

`app/db/partition_archive.py` provides:

- `build_delivery_log_archive_targets` — same eligibility as partition drop planning
- `detach_delivery_log_partition` — `ALTER TABLE … DETACH PARTITION` (dry-run by default)
- `compress_export_hook` — identity placeholder for gzip
- `ColdStorageExporter` protocol — future S3 hook

Recommended operator flow before drop:

1. `pg_dump -Fc -t delivery_logs_YYYY_MM` (or `COPY` + gzip)
2. Optional detach for offline table file management
3. Upload to object storage via your backup pipeline
4. Enable partition drop only after export verification

## Observability

- `GET /api/v1/retention/partitions` — partition list, row counts, orphans, retention days
- Admin Maintenance Center — `partitions` panel in `GET /api/v1/admin/maintenance/health`

## Query compatibility

Existing ORM and SQL against `delivery_logs` remain valid. Time-bounded queries prune to relevant monthly children when `created_at` bounds are present.

Validate with:

```sql
EXPLAIN ANALYZE
SELECT count(*)
FROM delivery_logs
WHERE created_at >= '2026-05-01 00:00:00+00'
  AND created_at < '2026-06-01 00:00:00+00';
```

Expect a single child scan (`delivery_logs_2026_05`) rather than all partitions.

Indexes on the parent propagate to partitions (see migration `idx_logs_*`, `ix_delivery_logs_run_id_created_at`).

## Backup and restore

- Logical backup: include parent `delivery_logs` and all children, or use `pg_dump` on the parent (includes partition definitions)
- Point-in-time recovery restores the whole cluster; partition layout is catalog metadata
- After restore, run partition maintenance once to ensure future months exist

## Troubleshooting

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Insert fails with partition routing error | Missing month child | Run partition maintenance or check migration |
| Rows land in `delivery_logs_default` | Missing monthly child for `created_at` | Create month partition; move rows if needed |
| EXPLAIN scans all children | Missing `created_at` predicate | Add time bounds to analytics queries |
| Orphan partition names in health panel | Manual DDL or failed migration | Inspect `pg_inherits`; detach/drop only after export |

## Scaling limits

- Very high ingest within a single month still grows one child table; consider shorter retention or archival
- `runtime_aggregate_snapshots` uses TTL row cleanup, not monthly partitioning (short TTL keeps volume bounded)
- Cross-month analytics without time filters will scan all partitions

## Related reading

- `specs/045-postgresql-partitioning-retention/spec.md`
- `specs/043-observability-scale-foundation/spec.md`
- `docs/operations/data-management/retention-policies.md`
