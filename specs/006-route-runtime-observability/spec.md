# Route Runtime Observability

## API

`GET /api/v1/runtime/streams/{stream_id}/metrics` includes:

- `route_runtime`: per-route 1h aggregates, latency (from `route_send_success` only), retry counts, trends, connectivity
- `recent_route_errors`: recent committed route-scoped failure rows

## Data rules

- Only committed `delivery_logs`; exclude `level=DEBUG`
- Latency KPIs from `route_send_success`
- Retry outcomes: `route_retry_success` + `route_retry_failed`
- Idle routes (no events): not counted as failure for success rate

## Persistence

- `routes.disable_reason`: optional operator note when disabling (via runtime enabled save)
