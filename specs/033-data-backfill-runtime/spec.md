# 033 Data Backfill Runtime Architecture (Phase 1)

## Purpose

Define the **Data Backfill Runtime** as a **first-class subsystem** separate from scheduled **StreamRunner** polling. Backfill covers historical replay, initial bulk ingestion, checkpoint rewind (when explicitly requested), time-range replay, object/file replay, and reprocessing failed historical slices—all **without** changing normal runtime checkpoint progression unless an operator explicitly commits a merge (future phase).

This spec is the **implementation authority** for Phase 1 persistence and APIs. Operational UX and menu placement remain aligned with `specs/030-data-backfill/spec.md` (roadmap); this document adds **runtime separation**, **checkpoint isolation**, and **subsystem boundaries**.

## Non-goals (Phase 1)

- Full execution of every `backfill_mode` (orchestration placeholders only).
- Automatic backfill scheduling on platform boot.
- Modifying **StreamRunner** transaction ownership, commit layout, or scheduler semantics.
- Bypassing Route → Destination delivery (no “direct sink” path).
- Overwriting production stream checkpoints automatically.

## Terminology

| Term | Meaning |
| --- | --- |
| **Normal runtime** | Scheduler-driven **StreamRunner** cycles for enabled streams. |
| **Backfill job** | A persisted `backfill_jobs` row representing one bounded operator intent. |
| **Backfill runtime** | **BackfillRuntimeCoordinator** and future workers—**not** StreamRunner’s scheduling entrypoint. |
| **Checkpoint snapshot** | Immutable JSON captured at job creation from `checkpoints` (type + value). Used for audit and ephemeral replay state seeding. |
| **Ephemeral checkpoint state** | In-memory / coordinator-scoped cursor state for the job. **Must not** write to `checkpoints` unless an explicit commit policy allows it (placeholder only in Phase 1). |
| **Source execution profile** | The stream’s execution profile (`streams.stream_type`): `HTTP_API_POLLING`, `REMOTE_FILE_POLLING`, `DATABASE_QUERY`, `S3_OBJECT_POLLING`. |

## Architecture

```text
Operator API
  -> BackfillService / Repository (config + job rows; own short transactions)
  -> BackfillRuntimeCoordinator (isolation, snapshots, progress, cancel, chunk orchestration)
        -> (future) reuse Mapping / Enrichment / Formatter / Route fan-out / Destination adapters
        -> (future) structured backfill delivery logs (separate from runtime delivery_logs)
StreamRunner (unchanged)
  -> normal polling, checkpoint after successful delivery
```

## Runtime separation

1. **Backfill is not polling.** It does not register as a scheduler tick for `StreamRunner`.
2. **BackfillRuntimeCoordinator** does **not** reuse StreamRunner as a drop-in scheduler; it owns **isolated** execution context (snapshots, ephemeral checkpoint state, cancellation, chunk iteration).
3. **Delivery semantics** for executed events must still follow: Mapping → Enrichment → Formatting → Route fan-out → Destination policies → retries/backoff (shared adapter/helpers in later phases—not StreamRunner copy-paste).
4. **No polling overlap:** Phase 1 does not start execution automatically; future phases must coordinate concurrency with normal runs (e.g. advisory lock per stream) without double-scheduling StreamRunner.

## Lifecycle (job row)

| Status | Description |
| --- | --- |
| `PENDING` | Created; not started by runtime worker. |
| `RUNNING` | Worker / coordinator has marked start; dry-run or replay in progress. |
| `CANCELLING` | Cooperative cancellation in progress before terminal `CANCELLED`. |
| `PAUSED` | Cooperative pause (future). |
| `COMPLETED` | Terminal success. |
| `FAILED` | Terminal error (`error_summary`). |
| `CANCELLED` | Operator/system cancelled before completion. |

## Backfill modes (architecture only)

| Mode | Intent (future source strategies) |
| --- | --- |
| `CHECKPOINT_REWIND` | Replay from an earlier cursor than current runtime checkpoint (isolated until explicit commit). |
| `TIME_RANGE_REPLAY` | Bounded wall-clock or business-time window. |
| `OBJECT_REPLAY` | Object/key-scoped replay (e.g. S3). |
| `FILE_REPLAY` | File-scoped replay (remote file polling). |
| `INITIAL_FILL` | First-time bulk load without advancing normal checkpoint semantics incorrectly. |

## Source-specific strategies (placeholders)

Planned strategies per **stream_type** (documentary; not fully implemented in Phase 1):

- **HTTP_API_POLLING:** timestamp replay; cursor rewind.
- **DATABASE_QUERY:** checkpoint column rewind; time-range replay.
- **S3_OBJECT_POLLING:** prefix replay; object replay.
- **REMOTE_FILE_POLLING:** directory replay; file replay; offset replay.

## Checkpoint isolation rules (critical)

1. On job creation, persist **`checkpoint_snapshot_json`** from the current `checkpoints` row (or `null` if missing).
2. **Normal checkpoints remain untouched** in Phase 1—no automatic merge from backfill.
3. **Ephemeral state** is derived from the snapshot (or mode-specific overrides in later phases) and lives under **BackfillRuntimeCoordinator** scope, not in the `checkpoints` table.
4. **Explicit commit policy** is **`EXPLICIT_ONLY`** (placeholder): merging ephemeral progress into `checkpoints` requires a dedicated future operation, admin gate, and audit trail—**not** implemented in Phase 1.

## Replay semantics

- Backfill replays must be **bounded** (time range, key list, file list, or explicit mode contract).
- **At-least-once** delivery to destinations remains possible; UI copy in later phases must warn operators.
- Failed historical reprocessing runs as a **new job** with its own snapshots and isolation.

## Failure handling

- Job-level `error_summary` for operator-visible failure.
- **Per-route** failures in future executed phases must reuse route failure policy semantics (`specs/004-delivery-routing/spec.md`).
- **Structured backfill delivery logs** (separate table, future phase) must not corrupt **runtime** `delivery_logs` analytics.

## UI expectations (Phase 1)

- English-only labels (`constitution.md`).
- **Backfill Jobs** page: table of jobs, status badge, stream association, empty state.
- No wizard in Phase 1.

## APIs (Phase 1 + Phase 2 foundation)

- `POST /api/v1/backfill/jobs` — create job (snapshots persisted).
- `GET /api/v1/backfill/jobs` — list jobs (recent first).
- `GET /api/v1/backfill/jobs/{id}` — job detail.
- `POST /api/v1/backfill/jobs/{id}/start` — `PENDING` → `RUNNING`, progress events, worker dry-run entry (non-blocking replay foundation).
- `POST /api/v1/backfill/jobs/{id}/cancel` — cancel `PENDING`, `RUNNING`, or `CANCELLING` jobs; append cancellation progress events.
- `GET /api/v1/backfill/jobs/{id}/events` — list `backfill_progress_events` ordered by `created_at` ascending.

## Testing obligations

- Model and migration apply on PostgreSQL.
- API create/list/detail.
- Checkpoint snapshot persistence and isolation from `checkpoints` updates in Phase 1 flows.
- Status transitions and coordinator ephemeral state basics.

## Relationship to 030

`specs/030-data-backfill/spec.md` describes operator workflow and UI roadmap. **033** is the **runtime and persistence foundation**; implementations must satisfy both without contradicting **001–004** or **StreamRunner** transaction rules.

## Phase 2 (foundation — implemented)

Phase 2 adds **controlled execution entrypoints**, **append-only progress events** (`backfill_progress_events`), a **`BackfillWorker` dry-run lifecycle**, **stream-level concurrency protection for backfill jobs** (PostgreSQL `pg_advisory_xact_lock` keyed by `stream_id` plus status checks), and **REST control** (`POST .../start`, `POST .../cancel`, `GET .../events`). Normal **StreamRunner** scheduling and **checkpoint commit semantics** are unchanged.

- **Worker:** `app/backfill/worker.py` runs a short, synchronous dry-run path (chunk markers + optional `dry_run_complete` completion). It does **not** perform source-specific historical replay and does **not** write to `checkpoints` or `delivery_logs`.
- **Progress events:** distinct table from runtime `delivery_logs`; ordered audit trail per job (`job_created`, `job_started`, chunk markers, cancellation, completion, etc.).
- **Status `CANCELLING`:** used transiently when cancelling a `RUNNING` job before terminal `CANCELLED`.
- **Stream lock:** prevents two jobs on the same stream from being `RUNNING` or `CANCELLING` concurrently; does **not** block normal StreamRunner polling in this phase.

### Future: delivery_logs correlation (design only)

Backfill-scoped delivery outcomes should remain **separate** from runtime `delivery_logs` rows (see `specs/030-data-backfill/spec.md` and `specs/011-runtime-analytics/spec.md`). A future migration may add optional nullable columns on a **dedicated backfill delivery** table or, if explicitly justified, on `delivery_logs`:

- `backfill_job_id` (nullable FK to `backfill_jobs.id`) — correlates a committed delivery outcome with a backfill job without implying StreamRunner ownership.
- Optional `backfill_chunk_id` or `backfill_batch_index` for chunked replay correlation.

**Policy:** any `delivery_logs` schema change must preserve existing analytics queries and must not reinterpret runtime `run_id` semantics for backfill rows. Prefer a separate `backfill_delivery_logs` table unless a unified correlation column is strictly required. **Phase 2 does not modify `delivery_logs`.**

### Future: checkpoint commit policy

Unchanged from Phase 1: **`EXPLICIT_ONLY`** merge into `checkpoints` remains a gated, audited future operation.

---

## Phase 2 Scope (historical note — superseded above)

Earlier Phase 2 bullets are now partially implemented as foundation; full async worker processes, source strategies, and checkpoint merge remain future work.
