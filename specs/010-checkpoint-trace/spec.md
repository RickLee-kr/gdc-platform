# Checkpoint Trace (Phase 1)

## Scope

Operational checkpoint tracing and correlation for StreamRunner executions using existing `checkpoints` and `delivery_logs` (no checkpoint semantics redesign).

## Logging

- Persisted stage `run_started` marks execution start with `checkpoint_before` snapshot.
- `checkpoint_update` rows carry structured fields: `checkpoint_before`, `checkpoint_after`, counts, `partial_success`, `update_reason`, `correlated_route_failures`.
- `run_complete` rows carry the same summary fields for end-of-run boundary explanation.

## APIs

- `GET /api/v1/runtime/checkpoints/trace?run_id=…`
- `GET /api/v1/runtime/checkpoints/streams/{stream_id}/history`
- `GET /api/v1/runtime/runs/{run_id}/checkpoint`
- Log search supports `partial_success` on `run_complete` rows (PostgreSQL JSON).

## Non-goals

Distributed tracing, WebSocket streaming, replay engine, analytics dashboards.
