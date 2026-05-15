# 012 Runtime Health Scoring

## Scope

Operational deterministic health scoring for runtime entities (no ML).

Targets:

- Streams
- Routes
- Destinations

Goal: surface unstable streams, degraded routes, retry-heavy pipelines, chronically failing destinations, and unhealthy runtime trends inside the existing Runtime Analytics surface.

## Constraints

- Read-only over `delivery_logs` and aggregates already exposed by spec 011.
- No DB schema changes, no new migrations, no background jobs, no new write paths.
- StreamRunner transactions, retry engine, checkpoint behavior, and rate-limit policies are unchanged.
- PostgreSQL aggregation only; align filters with existing log indexes (`stream_id`, `route_id`, `destination_id`, `stage`, `status`, `created_at`, `run_id`).
- Default rolling window: 24h. Allowed window tokens: `15m`, `1h`, `6h`, `24h`. Optional `since` overrides the rolling window (label becomes `custom`).
- English-only product language.

## Scoring Model

Score range: `0..100` integer.

Health levels (based on score):

- `HEALTHY` — `score >= 90`
- `DEGRADED` — `70 <= score < 90`
- `UNHEALTHY` — `40 <= score < 70`
- `CRITICAL` — `score < 40`

Scoring factors (deterministic, additive penalties starting from 100):

- Failure rate (over delivery outcome stages).
- Retry rate (retry outcome stages over total outcome stages).
- Recent success ratio (presence of recent success vs failure).
- Repeated failures (more than N failures in window).
- Latency degradation (p95 over thresholds — Destinations / Routes only).
- Inactivity (no successful delivery in window even though attempts happened).

Each factor that contributes is returned as a `factor` entry with its label, score delta, and explanation. The response always includes:

- `score: int`
- `level: HEALTHY | DEGRADED | UNHEALTHY | CRITICAL`
- `factors: list[HealthFactor]`
- `last_success_at`
- `last_failure_at`
- `failure_count`
- `success_count`
- `retry_count`
- `latency_ms_p95` (when available)

## API

Mounted under `/api/v1/runtime/health/*`:

- `GET /overview` — KPIs across all streams/routes/destinations.
- `GET /streams` — per-stream rows ordered by score asc.
- `GET /routes` — per-route rows ordered by score asc.
- `GET /destinations` — per-destination rows ordered by score asc.
- `GET /streams/{stream_id}` — single stream score with factors.
- `GET /routes/{route_id}` — single route score with factors.

All endpoints accept: `window` (default `24h`), `since`, optional `stream_id`, `route_id`, `destination_id`.

## UI

Extends the existing `/runtime/analytics` page with:

- Health summary banner.
- KPI cards: average score, unhealthy count, critical count, healthy count.
- Top unhealthy routes table.
- Top degraded streams table.
- Destination health table.
- Health badge (`HEALTHY/DEGRADED/UNHEALTHY/CRITICAL`) reusable component with factor tooltip.

Existing analytics tables, filters, and Logs deep-links remain intact.
