# 045 PostgreSQL partitioning, retention, and archival foundation

## Purpose

Prevent long-term runtime degradation as `delivery_logs` and observability datasets grow, using PostgreSQL native partitioning and operator-controlled retention.

## Scope

- Monthly `RANGE (created_at)` partitioning for `delivery_logs`
- Partition maintenance (create current/next months, default partition, orphan detection)
- Retention integration with existing operational retention (`specs/034-data-retention/spec.md`)
- Export-ready archival hooks (detach SQL, compression placeholder, `ColdStorageExporter` protocol)
- Read-only observability: `GET /api/v1/retention/partitions`, Maintenance Center partitions panel

## Non-goals

- TimescaleDB or external warehouse requirement
- Full S3/object-store upload implementation
- Redesign of StreamRunner, checkpoint policy, or delivery log semantics
- Separate `runtime_checkpoint_history` table (checkpoint history remains `delivery_logs` rows with `stage=checkpoint_update`)

## Invariants

- `delivery_logs` persists committed runtime outcomes only; `run_failed` is not stored
- StreamRunner remains the sole runtime transaction owner
- Partition drop/delete requires explicit destructive flags (see `docs/operations/data-management/retention-policies.md`)
- Current and next month partitions are never drop targets
- Migrations do not delete operator data

## Configuration

| Variable | Role |
|----------|------|
| `GDC_DELIVERY_LOG_RETENTION_DAYS` | Override `delivery_logs_days` in effective retention |
| `GDC_CHECKPOINT_HISTORY_RETENTION_DAYS` | Override checkpoint trace window (`checkpoint_update` rows) |
| `GDC_PARTITION_MAINTENANCE_ENABLED` | Enable background partition ensure thread |
| `GDC_PARTITION_MAINTENANCE_MONTHS_AHEAD` | Months to pre-create beyond current |
| `GDC_RETENTION_DELIVERY_LOG_PARTITION_DROP_ENABLED` | Allow whole-partition DROP after retention |

## Related specs

- `specs/043-observability-scale-foundation/spec.md` — initial `delivery_logs` partition migration
- `specs/034-data-retention/spec.md` — batched row delete + partition drop execution

## Documentation

- `docs/runtime/postgresql-partitioning.md`
- `docs/operations/data-management/retention-policies.md` (partition drop section)
