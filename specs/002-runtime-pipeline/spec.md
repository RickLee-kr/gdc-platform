# Runtime Pipeline

## Current pipeline (implemented)

Source
→ Rate Limit
→ Event Extractor
→ Mapping
→ Enrichment
→ Formatter
→ Router (Fan-out)
→ Destination Rate Limit
→ Send
→ Checkpoint
→ Logs

Equivalent orchestration:

```text
StreamRunner
  -> Fetch
  -> Mapping
  -> Enrichment
  -> Route Fan-out
  -> Destination Send
  -> Checkpoint (after delivery ACK)
  -> Structured Logs / Runtime State
```

## Runtime reliability (policy; see `specs/048-runtime-reliability/spec.md`)

Reliability and buffering are configured **per Stream**. Default remains lightweight `DIRECT` unless operators choose otherwise.

| Mode | Behavior summary |
|------|------------------|
| `DIRECT` | Immediate delivery; lowest resource use; default for polling sources |
| `MEMORY_BUFFER` | In-memory buffer for push burst/backpressure; not durable on crash |
| `PERSISTENT_QUEUE` | Future durable queue with retry after restart |
| `EXTERNAL_BUFFER` | Durability via external platform; GDC stays lightweight |

### Principles

- Lightweight by default; durable queue never globally mandatory.
- Backpressure (future) must be independent of Source fetch lifecycle.
- Destination failure must not automatically fail the Source fetch path.
- Checkpoint still updates only after successful route delivery ACK.

### Future optional pipeline (not implemented; not mandatory)

When a Stream enables internal durable queue semantics (future):

```text
StreamRunner
  -> Fetch
  -> Mapping
  -> Enrichment
  -> Delivery Queue Enqueue

DeliveryWorker
  -> Route Delivery
  -> Retry / Backoff
  -> ACK
  -> Checkpoint Update
```

Single-node and polling-heavy deployments may keep the current direct pipeline indefinitely.

### Future operational observability (when buffering/queues enabled)

Runtime MUST expose: `queue_depth`, `retry_count`, `dead_letter_count`, `oldest_pending_event_age`, `destination_health`, `route_backpressure_state`, `dropped_event_count`, `delivery_ack_latency`.

### Implementation constraints (forbidden)

- Global mandatory `PERSISTENT_QUEUE`
- Tight coupling of fetch lifecycle to destination retry lifecycle
- Kafka-scale complexity as default runtime
- Breaking `DIRECT` single-node deployments

### Competitive references

Buffered/backpressure patterns are informed by Vector, Cribl Stream, Fluent Bit, Benthos/Redpanda Connect, and NiFi observability. GDC does not become a general-purpose stream processor.

---

# PostgreSQL Runtime Query Performance Rule

Delivery logs queries must be optimized for PostgreSQL index usage.

Runtime queries that read delivery logs, stream state, route state, destination state, or checkpoints must be validated with PostgreSQL EXPLAIN ANALYZE when performance-sensitive.

---

# Runtime Transaction Policy

StreamRunner is the only transaction owner for runtime DB writes.

## Success Path

- `route_send_success` logs are staged.
- `run_complete` log is staged.
- Checkpoint is staged only after successful destination delivery.
- StreamRunner commits once at the end.

## Partial Failure Path

- `route_send_failed` logs are staged.
- `run_complete` log is staged.
- Checkpoint is not updated unless all required routes are recovered.
- StreamRunner commits once at the end.

## Exception Failure Path

- StreamRunner rolls back the active transaction.
- `run_failed` is emitted to application logger only.
- `run_failed` is not persisted to `delivery_logs`.
- No commit is allowed after rollback.

# Runtime Delivery Log Persistence Policy

`delivery_logs` persists committed runtime outcomes only.

## Persisted Stages

- `route_send_success`
- `route_send_failed`
- `route_retry_success`
- `route_retry_failed`
- `source_rate_limited`
- `destination_rate_limited`
- `route_skip`
- `route_unknown_failure_policy`
- `run_complete`

## Not Persisted

- `run_failed` from exception path

## Reason

Exception path rolls back and must not create a new transaction only to persist failure logs.
`run_failed` remains observable via application logger.

# Runtime Checkpoint Policy

Checkpoint update is allowed only in committed success path.

Checkpoint must not update when:

- source fetch fails
- parsing, mapping, or enrichment raises exception
- required route fails and is not recovered
- StreamRunner enters exception rollback path

---

# Two-Tier Runtime Logging Policy

## delivery_logs (DB)

`delivery_logs` is for committed runtime outcomes only.

Persisted outcomes:

- `route_send_success`
- `route_send_failed`
- `route_retry_success`
- `route_retry_failed`
- `run_complete`
- `source_rate_limited`
- `destination_rate_limited`
- `route_skip`
- `route_unknown_failure_policy`

## Application/File Logger

Application/file logger keeps troubleshooting and debug detail, including:

- `run_failed`
- exception traceback
- source fetch start/end
- raw response size
- event extract count
- mapping/enrichment count
- destination send attempt detail
- retry attempt detail
- internal debug payloads

## Exception Failure Path

- rollback active transaction
- emit `run_failed` to application/file logger only
- do not persist `run_failed` to `delivery_logs`
- do not commit after rollback

---

# StreamRunner Transaction Commit Handling (Refactor)

StreamRunner centralizes all commit operations via a helper method.

## Commit Rules

- StreamRunner uses a single helper: `_commit_if_needed(db)`
- All successful runtime outcomes must call this helper instead of direct `db.commit()`
- Direct `db.commit()` calls inside StreamRunner are prohibited except inside the helper

## Commit Paths

- success → helper commit once
- partial success → helper commit once
- source_rate_limited → helper commit once
- destination_rate_limited → helper commit once
- retry success → helper commit once
- retry exhausted → helper commit once

## Exception Path

- `db.rollback()` only
- helper commit must not be called
- `run_failed` is logger-only and must not be persisted

## Structural Guarantees

- commit call location is single, inside helper
- early return paths must use the same helper
- repository/service layers must not perform commit/rollback

## Rationale

- prevents commit omission bugs
- ensures consistent transaction boundary
- improves maintainability and readability of StreamRunner
