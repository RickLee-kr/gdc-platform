# Runtime Pipeline

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
