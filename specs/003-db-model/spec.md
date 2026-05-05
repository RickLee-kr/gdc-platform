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
