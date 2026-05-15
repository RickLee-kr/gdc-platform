# 030 Data backfill (operational workflow)

## Purpose

Define **Data Backfill** as an operator-controlled workflow **separate from scheduled runtime polling**. Backfill replays or bulk-loads historical data from selected sources through the same **mapping → enrichment → route → destination** pipeline semantics while **protecting production checkpoints** by default. This spec does **not** implement code, does **not** change **StreamRunner** behavior, and does **not** define new Alembic schema (a future implementation task may add `backfill_runs` tables after a dedicated migration spec).

Related: **Backfill Runtime Phase 1** (job registry `backfill_jobs`, coordinator isolation, REST foundation) is specified in `specs/033-data-backfill-runtime/spec.md`.

## Relationship to runtime

| Aspect | Runtime polling | Data backfill |
| --- | --- | --- |
| Trigger | Scheduler / existing runtime controls | Operator-initiated from **Data Backfill** UI |
| Goal | Steady incremental state | Bounded historical load or catch-up |
| Checkpoint | Standard stream checkpoint after successful delivery | Isolated **backfill cursor** by default; optional explicit stream checkpoint merge |
| Logs | `delivery_logs` + application logger | **Separate** persisted backfill run log channel (see Failure behavior) |

Backfill execution may **reuse** destination send and route failure policy **semantics** (`specs/004-delivery-routing/spec.md`) inside a dedicated orchestrator; it must **not** silently change StreamRunner’s internal transaction layout.

## Non-goals

- Oracle, MSSQL, Kafka, message queues.
- New cloud storage connectors (S3 backfill uses existing **S3_OBJECT_POLLING** streams only).

## UI: Data Backfill menu

- Add primary sidebar entry **Data Backfill** (English-only label) placed **after Runtime** and **before Logs** to match operational workflow (see `.specify/memory/constitution.md` Global Navigation; this entry extends the ordered list for this feature).
- Subviews: **New backfill run**, **Run history**, **Run detail** (progress, audit, errors).

## Backfill run model

| Concept | Description |
| --- | --- |
| **Source / stream selection** | Operator picks an existing stream (which implies its source, connector, mappings, enrichments, routes). |
| **Bounded range** | Operator defines a bounded slice: for **DATABASE_QUERY** time/watermark range and/or PK range; for **REMOTE_FILE_POLLING** path + time window; for **S3_OBJECT_POLLING** key prefix + optional key marker / time window (align with existing object ordering). |
| **Preview** | Read-only phase returns estimated **event count** or **file/object count** and sample rows/objects without mutating checkpoints or sending to destinations (dry path). |
| **Dry run** | Executes fetch + mapping + enrichment + formatting **without** destination delivery (no side effects on destinations or checkpoints). |
| **Execute** | Full pipeline including destination delivery. |
| **Progress / status** | Phases: `QUEUED`, `PREVIEWING`, `RUNNING`, `PAUSED`, `COMPLETED`, `FAILED`, `CANCELLED`. |
| **Audit log** | Immutable append-only records: who started the run, range, preview counts, start/end times, cancellation user, optional checkpoint merge confirmation id. |

## Checkpoint protection (critical)

1. **Default**: backfill uses a **separate backfill cursor** stored in backfill-specific persistence (implementation phase). It **must not** read or write the stream’s **active runtime checkpoint**.
2. **Optional checkpoint update**: merging backfill progress into the stream’s production checkpoint requires **Administrator** role, a **typed confirmation** dialog, and an **audit log entry**. Default remains **disabled**.
3. **Consistency**: if checkpoint merge is ever enabled, merged values must still respect **checkpoint only after successful destination delivery** for the events included in that merge (no merge of undelivered high-water marks).

## Supported initial backfill targets

| Source type | Backfill support |
| --- | --- |
| `DATABASE_QUERY` | Bounded SQL range / watermark replay per `specs/028-database-query-source/spec.md`. |
| `REMOTE_FILE_POLLING` | Bounded directory + pattern + time window per `specs/029-remote-file-polling-source/spec.md`. |
| `S3_OBJECT_POLLING` | Bounded keyspace / time / manifest per `docs/sources/s3-object-polling.md` and `specs/025-s3-object-polling-ui/spec.md`. |

`HTTP_API_POLLING` backfill may follow in a later spec; it is **not** required for the initial backfill milestone.

## Failure behavior

- **Route failure policy reuse**: for each route, apply the same **LOG_AND_CONTINUE**, **PAUSE**, **DISABLE_ROUTE**, **RETRY_AND_BACKOFF** meanings as runtime (`specs/004-delivery-routing/spec.md`). Implementation may delegate to shared delivery helper code without altering StreamRunner’s scheduler-driven path.
- **Separate logs**: backfill persistence stores structured delivery outcomes for the run; they must **not** be mixed into standard runtime `delivery_logs` rows (avoid corrupting runtime analytics in `specs/011-runtime-analytics/spec.md`). Correlation id: `backfill_run_id`.

## UI requirements

- **Backfill menu** as above.
- **Run history** table: stream name, range summary, status, started by, started at, event counts.
- **Preview count** displayed before **Execute**; block execute when preview shows zero events unless operator overrides with confirmation.
- **Cancel / stop**: cooperative cancellation between batches; destinations already accepted may not be rolled back—UI copy must state at-least-once semantics.

## Testing strategy

- **Unit tests**: range builder per source type; checkpoint isolation (mock persistence); admin-gated merge flag.
- **Integration tests**: end-to-end backfill against test containers (DB / SFTP / MinIO) with webhook sink; assert runtime checkpoint unchanged when merge disabled; assert merge path only after confirmation.
- **Regression**: existing StreamRunner and checkpoint tests remain untouched by this roadmap task.

## Future implementation note

Introduce a **BackfillOrchestrator** service distinct from the scheduler’s StreamRunner entrypoint, sharing mapping/enrichment/destination adapters only. Database migrations for backfill tables require a follow-up numbered spec if persistence is relational.
