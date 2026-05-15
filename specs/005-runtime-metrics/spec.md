# Stream Runtime Metrics API

## Endpoint

`GET /api/v1/runtime/streams/{stream_id}/metrics`

Read-only. Aggregates committed `delivery_logs`, stream/route/checkpoint rows (spec 002 alignment).

## Notes

- Exception-path `run_failed` is logger-only; excluded.
- `no_events` runs may leave no `run_complete` row; empty KPIs are valid.
- Checkpoint history uses current `checkpoints` row only (no audit table).
