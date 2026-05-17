# Observability Scale Foundation

## Scope

Establish the first large-scale observability operating foundation for runtime delivery history and aggregate dashboards.

This spec covers:

- PostgreSQL native monthly RANGE partitioning for `delivery_logs` by `created_at`
- Runtime aggregate snapshot materialization for high-read dashboard and analytics APIs
- Frontend refresh-cycle synchronization so widgets render one coherent snapshot

This spec does not change StreamRunner transaction ownership, committed runtime outcome semantics, checkpoint policy, route fan-out, Source/Destination separation, Connector/Stream separation, metric ontology semantics, or visualization ontology semantics.

## Required Invariants

- `delivery_logs` remains committed runtime outcomes only.
- `run_failed` exception rows remain application logger only and are not persisted to `delivery_logs`.
- Checkpoints update only after successful destination delivery according to the existing StreamRunner policy.
- StreamRunner remains the only runtime transaction owner for runtime writes.
- Route-based multi-destination fan-out remains the only Stream-to-Destination execution path.
- Aggregate APIs remain read-only over PostgreSQL state.
- PostgreSQL is the only supported database. SQLite fallback or SQLite-specific validation is forbidden.

## Delivery Log Partitioning

`delivery_logs` uses PostgreSQL native `PARTITION BY RANGE (created_at)`.

Partition naming:

```text
delivery_logs_YYYY_MM
```

Examples:

```text
delivery_logs_2026_05
delivery_logs_2026_06
```

Partition management must be migration-backed for existing data and utility-backed for future months. Startup may ensure the current and next month partitions exist, but missing partition handling must be fail-open for API startup and must not delete data.

Downgrade policy: automatic rollback does not convert partitioned `delivery_logs` back to an unpartitioned heap table. Reversing the partitioned table would require another full-table copy and can put operator delivery history at risk, so downgrade only removes additive snapshot storage and leaves partitioned `delivery_logs` in place unless an operator performs an explicit manual data-safe rollback.

Indexes must preserve existing query compatibility and planner behavior for common filters:

- `created_at`
- `(stream_id, created_at)`
- `(route_id, created_at)`
- `(destination_id, created_at)`
- `(stage, created_at)`
- `run_id`
- `id`

## Runtime Aggregate Snapshots

Runtime aggregate snapshots are materialized by scope and key.

Required snapshot metadata:

- `snapshot_id`
- `generated_at`
- `window_start`
- `window_end`
- `visualization_meta`
- `metric_meta`

Snapshot reads must preserve the same snapshot semantics as live aggregate reads. A shared `snapshot_id` must resolve to the same generated timestamp, window bounds, bucket metadata, metric metadata, and visualization metadata across widgets.

The materialization layer may combine in-memory TTL caching with a PostgreSQL table. The database table is the cross-process consistency anchor. The in-memory layer is only a short-lived read optimization.

Snapshot regeneration must be race-safe. Concurrent requests for the same scope/key must either reuse a fresh snapshot or have only one writer materialize a replacement.

## Frontend Synchronization

Frontend refresh cycles must generate one snapshot token and pass it to all snapshot-aware runtime, analytics, routes, and stream metrics requests in that cycle.

The UI must discard stale responses from older cycles and must not publish a partial widget set when required snapshot-aware responses disagree on snapshot identity.

Non-windowed operational resources, such as system resources or configuration lists, may refresh in the same cycle but do not define the aggregate snapshot.

## Validation

Validation must target PostgreSQL and include:

- partition creation and pruning evidence with `EXPLAIN ANALYZE`
- delivery log API regression
- runtime dashboard summary and outcome timeseries regression
- stream metrics regression
- analytics aggregate regression
- route runtime aggregate regression
- ontology metadata presence and snapshot alignment
- frontend stale snapshot discard and mismatch detection

