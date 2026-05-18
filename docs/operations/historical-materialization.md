# Historical materialization - design and test plan

This guide captures the design-only contract for long-term historical materialization. It prepares the next implementation phase without adding migrations, tables, destructive cleanup, runtime production code, retention service behavior, StreamRunner behavior, background workers, or frontend changes.

Authoritative specs:

- `specs/043-observability-scale-foundation/spec.md`
- `specs/034-data-retention/spec.md`

## Design Contract

### Rollup Direction

Historical materialization rolls forward only:

```text
raw delivery_logs -> hourly snapshots -> daily snapshots
```

Hourly snapshots are the first durable historical aggregate. Daily snapshots are derived from complete hourly snapshots rather than scanning raw rows again. This keeps the hourly layer as the explainable bridge between committed runtime outcomes and long-range daily analytics.

Both levels must carry the existing metric and visualization metadata semantics used by runtime aggregate snapshots.

### Historical Snapshot Retention Model

Historical snapshots are additive aggregates. They do not replace `delivery_logs`, checkpoint state, route failure logs, or runtime aggregate snapshots.

Retention model:

- Raw `delivery_logs` stay under operational retention and monthly partition retention policy.
- Hourly snapshots should outlive raw logs to preserve medium-range operational analytics.
- Daily snapshots should outlive hourly snapshots and serve long-range analytics.
- Snapshot cleanup remains disabled by default and must require explicit operator enablement.
- Exact retention durations are deferred until sizing and query evidence are available.

### Behavior After Raw Delivery Logs Retention

Once raw `delivery_logs` age out or old partitions are dropped through an explicitly enabled retention path, historical queries continue from retained snapshots when coverage exists.

Expected behavior:

- Aggregate counts, rates, and health summaries can be served from hourly or daily snapshots.
- Individual log drill-down stops at the raw retention boundary.
- Responses identify whether each range came from `raw`, `hourly_snapshot`, or `daily_snapshot`.
- Missing snapshot coverage is reported as partial or unavailable history. The system must not pretend deleted raw rows can be reconstructed.

### Snapshot Anchor Rules

Historical snapshots use closed UTC buckets.

- Hourly anchors: `[YYYY-MM-DDTHH:00:00Z, next hour)`.
- Daily anchors: `[YYYY-MM-DDT00:00:00Z, next day)`.
- Buckets become eligible only after their end time is older than the live ingest safety lag.
- Snapshot identity includes scope, key, granularity, anchor start, anchor end, generated timestamp, metric metadata, and visualization metadata.
- Regenerating the same anchor must be idempotent. Any future replacement flow must be explicit and auditable.
- Open-bucket provisional historical snapshots are out of scope for this phase.

### Live vs Historical Query Boundary

Live operational surfaces remain backed by existing live aggregate reads and runtime aggregate snapshots.

Boundary rules:

- Recent dashboard, route, stream, and runtime health widgets use live behavior.
- Analytics windows fully inside retained raw logs may use raw aggregate queries.
- Analytics windows crossing the raw retention boundary must compose raw aggregates and retained snapshots, with source coverage metadata.
- Analytics windows fully older than raw retention use historical snapshots only.
- Boundary selection must be deterministic from the requested window, requested granularity, raw retention boundary, and snapshot coverage.

### Fail-Open Behavior

Historical materialization must fail open.

- Snapshot creation or refresh failure must not block StreamRunner, checkpoint updates, route delivery, retention preview, retention execution, or API startup.
- Read APIs should fall back to live/raw reads for windows still covered by retained raw logs.
- Windows that require missing snapshots should return structured partial-coverage or unavailable-history responses.
- Errors must be logged structurally and must not trigger destructive cleanup or runtime-state mutation.

## Non-Goals

This phase does not introduce:

- New database migrations or tables.
- Destructive cleanup.
- A background worker.
- Runtime production code changes.
- Retention service changes.
- StreamRunner changes.
- Delivery log partition retention changes.
- Checkpoint behavior changes.
- External archives, S3 export, cold storage, or warehouse integration.
- Reprocessing or backfilling deleted raw `delivery_logs`.
- Frontend behavior changes.

## Test Plan

Design-phase validation is intentionally lightweight and schema-free:

- Contract test confirms the spec and operator guide define hourly/daily rollup direction, retention model, post-raw-retention behavior, anchor rules, live vs historical boundary, fail-open behavior, and phase non-goals.
- Contract test confirms this phase continues to reject migrations, new tables, destructive cleanup, background workers, StreamRunner changes, retention service changes, and frontend changes.

Future implementation validation should add PostgreSQL-backed tests only after the schema and query interfaces are approved:

- Hourly snapshot materialization from committed `delivery_logs`.
- Daily snapshot derivation from complete hourly snapshots.
- Query boundary selection across retained raw rows and historical snapshots.
- Partial-coverage responses when snapshots are missing.
- Fail-open startup and API behavior when materialization fails.
- Retention previews that show snapshot cleanup candidates without deleting by default.
