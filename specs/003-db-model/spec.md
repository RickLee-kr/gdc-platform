# DB Model

Tables:
- connectors
- sources
- streams
- mappings
- enrichments
- destinations
- routes
- checkpoints
- delivery_logs

Key Rules:
- stream_id FK required
- route → destination mapping
- checkpoint has type + value

---

# PostgreSQL-Only Database Policy

## Supported Database

Supported DB: PostgreSQL only.

SQLite support is removed and must not be used for:

- production
- development
- testing fallback
- local shortcut
- compatibility mode

## Implementation Requirements

All database implementations must target PostgreSQL.

Required:

- SQLAlchemy models must be compatible with PostgreSQL.
- Alembic migrations must be written for PostgreSQL.
- Indexes must be designed for PostgreSQL query planner behavior.
- JSON fields must use PostgreSQL-compatible JSON/JSONB behavior where applicable.
- Query performance must be validated against PostgreSQL.

Forbidden:

- SQLite fallback logic
- SQLite-specific migration branches
- SQLite-specific query behavior
- SQLite-only tests as acceptance evidence

## Performance Validation Standard

Performance validation must use PostgreSQL.

Required validation:

- PostgreSQL EXPLAIN ANALYZE required.
- Index usage must be verified.
- Sequential scan on large tables must be avoided.
- Delivery log, stream, route, destination, checkpoint, and runtime-state queries must be checked for index suitability.
- Any new query expected to run frequently must include index validation evidence.

Acceptance standard:

- Query plan shows intended index usage where applicable.
- Large table access must not depend on full sequential scans.
- Migration-created indexes must match actual filter/order/join patterns.

---

# Delivery Logs Transaction Semantics

`delivery_logs` persists committed runtime outcomes only.

## Persisted Runtime Stages

The following stages may be persisted when StreamRunner commits the active runtime transaction:

- `route_send_success`
- `route_send_failed`
- `route_retry_success`
- `route_retry_failed`
- `source_rate_limited`
- `destination_rate_limited`
- `route_skip`
- `route_unknown_failure_policy`
- `run_complete`

## Non-Persisted Runtime Stages

The following stage must not be persisted to `delivery_logs`:

- `run_failed` from exception path

`delivery_logs` is not a debug log table.
Detailed troubleshooting must remain in application/file logger.

Explicitly excluded from `delivery_logs`:

- `run_failed`
- traceback
- raw payload debug data
- internal debug-only messages

## Failure Log Scope

Failure logs must be persisted for route-level delivery failures.

Exception-level `run_failed` logs are emitted to the application logger only and are not persisted because the active transaction is rolled back.

# Checkpoint Transaction Semantics

Checkpoint update is allowed only inside the committed StreamRunner success transaction.

Checkpoint must not update when:

- source fetch fails
- parsing, mapping, or enrichment raises exception
- required route fails and is not recovered
- StreamRunner enters exception rollback path

# Runtime Transaction Ownership

StreamRunner is the only transaction owner for runtime DB writes.

Runtime services and repositories must stage DB changes but must not independently commit runtime DB writes.
