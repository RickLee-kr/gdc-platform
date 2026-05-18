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

### Partition Retention Foundation

Retention over `delivery_logs` is opt-in and deletion-safe by default.

- Default configuration must not delete rows or drop partitions.
- Dry-run and preview paths must show the candidate monthly partitions and row counts before any destructive action is enabled.
- A monthly partition is eligible only when the whole partition range is older than the configured retention cutoff.
- The current month and next month partitions must never be returned as drop targets.
- Production automatic deletion is forbidden; production execution requires an explicit manual operator action and explicit destructive-delete enablement.
- Migrations must not delete `delivery_logs` data and must not change the `delivery_logs` column structure for retention.

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

Expired `runtime_aggregate_snapshots` cleanup is an operational policy, not a snapshot semantics change. The default is no deletion; cleanup execution requires explicit enablement while dry-run/count inspection remains available.

## Long-Term Historical Materialization (Design-Only Phase)

This phase defines the contract for future long-term historical materialization. It does not add migrations, tables, destructive cleanup, background workers, retention service behavior, StreamRunner behavior, or production runtime writes.

### Rollup Direction

Historical aggregates roll up in one direction only:

```text
raw delivery_logs -> hourly snapshots -> daily snapshots
```

Hourly snapshots are the first durable aggregate layer. Daily snapshots are derived from complete hourly snapshots, not directly from raw logs, so hourly semantics remain the audit bridge between raw operational outcomes and longer-range history.

Rollups must preserve metric and visualization ontology metadata already required for runtime aggregate snapshots. A daily value must be explainable as the deterministic aggregation of its hourly inputs.

### Historical Snapshot Retention Model

Historical snapshots are additive aggregate records, not replacements for `delivery_logs`.

Retention policy direction:

- Raw `delivery_logs` remain governed by operational retention and partition retention policy.
- Hourly snapshots should be retained longer than raw logs and short enough to bound query volume.
- Daily snapshots should be retained longest and become the default source for long-range analytics.
- Snapshot cleanup must remain disabled by default and require explicit operator enablement, mirroring the existing runtime aggregate snapshot cleanup posture.

This design does not define exact retention durations. Those values belong in a later implementation phase after sizing evidence is available.

### Behavior After Raw Delivery Log Retention

After raw `delivery_logs` age out or monthly partitions are dropped by an explicitly enabled retention path, historical queries must continue to serve retained hourly or daily snapshots for covered windows.

Required behavior:

- Long-range analytics may report aggregate counts, rates, and health summaries from snapshots after raw rows are no longer available.
- Drill-down to individual delivery log rows must stop at the raw retention boundary.
- APIs must expose enough metadata for callers to distinguish `raw`, `hourly_snapshot`, and `daily_snapshot` data sources.
- Missing snapshot coverage must not be silently backfilled from deleted raw data. The response should report partial or missing coverage instead.

### Snapshot Anchor Rules

Historical snapshots are anchored to closed time buckets.

- Hourly anchors use UTC hour boundaries: `[YYYY-MM-DDTHH:00:00Z, next hour)`.
- Daily anchors use UTC day boundaries: `[YYYY-MM-DDT00:00:00Z, next day)`.
- A bucket is eligible only after the bucket end is older than the live ingest safety lag.
- Snapshot identity must include scope, key, granularity, anchor start, anchor end, generated timestamp, metric metadata, and visualization metadata.
- Regeneration for the same anchor must be idempotent. If replacement is introduced later, the replacement must be explicit and auditable.
- A snapshot must not cover an open bucket unless it is clearly marked as provisional. Provisional historical snapshots are a non-goal for this phase.

### Live vs Historical Query Boundary

Live surfaces remain served from current runtime aggregate behavior and raw `delivery_logs` within the online operational window.

Historical query selection should follow these rules:

- Recent dashboard, route, stream, and runtime health widgets use live aggregate reads or runtime aggregate snapshots.
- Analytics windows fully inside retained raw logs may continue to use raw aggregate reads when that is cheaper and semantically equivalent.
- Analytics windows crossing the raw retention boundary must compose results from retained raw rows plus hourly or daily snapshots, with source coverage metadata.
- Analytics windows fully older than raw retention must use historical snapshots only.
- The query boundary must be deterministic from requested window, granularity, raw retention boundary, and snapshot coverage.

### Fail-Open Behavior

Historical materialization must fail open for platform operations.

- Failure to create or refresh historical snapshots must not block StreamRunner, checkpoint updates, route delivery, retention preview, retention execution, or API startup.
- Read APIs should degrade to live/raw queries when the requested window is within retained raw logs.
- For windows that require missing historical snapshots, APIs should return a structured partial-coverage or unavailable-history response instead of raising an unhandled error.
- Snapshot materialization errors must be logged structurally and must not trigger destructive cleanup or retries that mutate runtime state.

### Non-Goals For This Phase

This phase does not introduce:

- New database migrations or tables.
- Destructive cleanup behavior.
- A background materialization worker.
- Changes to `StreamRunner`, retention services, delivery log partition retention, or checkpoint semantics.
- External archives, cold storage, S3 export, or warehouse integration.
- Reprocessing or backfilling deleted raw `delivery_logs`.
- Provisional snapshots for still-open buckets.
- Frontend behavior changes.

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

