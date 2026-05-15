# 011 Runtime Analytics (Route Failures + Retries)

## Scope

Read-only operational analytics over `delivery_logs`:

- Route failure breakdown (routes, destinations, streams)
- Retry-heavy streams and routes
- Time-bucketed failure trends, error_code and stage histograms
- Latency avg/p95 for delivery outcome rows with `latency_ms`
- Unstable route heuristic (high failure rate with minimum samples)

## Constraints

- No runtime writes; no StreamRunner or checkpoint changes.
- PostgreSQL queries only; align filters with existing log indexes (`created_at`, `stream_id`, `route_id`, etc.).
- Default rolling window: 24h when using metrics window tokens (`15m`, `1h`, `6h`, `24h`).
- Optional `since` overrides the rolling window (response labels window as `custom`).

## API

Mounted under `GET /api/v1/runtime/analytics/*`.

## UI

Compact analytics screen at `/runtime/analytics` with drill-down links to Logs (existing explorer).
