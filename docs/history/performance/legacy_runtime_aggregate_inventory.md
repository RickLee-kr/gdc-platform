# Legacy Runtime Aggregate API Inventory — Phase 5

Inventory of runtime dashboard/analytics endpoints that aggregate `delivery_logs`, with UI usage and Phase 5 migration status.

## Legend

| Column | Meaning |
|--------|---------|
| **UI** | Used by production frontend today |
| **Initial** | Fetched on first paint / blocking bundle load |
| **DL agg** | Scans or GROUP BY `delivery_logs` on request path |
| **Snapshot** | Can use `runtime_*_snapshot` for operational reads |
| **Historical** | Needs deep window / bucket history beyond snapshot |

## Runtime Overview / Routes (migrated — Phase 3–4)

| Endpoint | UI | Initial | DL agg | Snapshot | Notes |
|----------|----|---------|--------|----------|-------|
| `GET /runtime/operational-snapshot` | Yes (Overview, Routes) | Yes | Fallback only | Yes | Primary operational read path |
| `GET /runtime/validation/operational-summary` | Embedded in dashboard | No | Partial (validation tables) | N/A | Not delivery_logs volume driver |

## Dashboard (`/runtime/dashboard/*`)

| Endpoint | UI | Initial | DL agg | Snapshot | Historical | Phase 5 |
|----------|----|---------|--------|----------|------------|---------|
| `GET /runtime/dashboard/summary` | Yes (Operations dashboard, Streams console) | Yes (dashboard bundle) | **Was yes** | **Yes** | Window KPIs use 5m operational proxy when read model populated | **Migrated** |
| `GET /runtime/dashboard/outcome-timeseries` | Yes (Operations dashboard chart) | **Was yes** | **Yes** (full window buckets) | Partial (operational stub) | Yes (stacked buckets) | **Lazy load** on frontend; backend keeps DL path for deep history |

## Observability

| Endpoint | UI | Initial | DL agg | Snapshot | Notes |
|----------|----|---------|--------|----------|-------|
| `GET /runtime/observability/summary` | Yes (dashboard, analytics, logs explorer) | Yes (dashboard) | Yes | Partial | Canonical cross-page totals; Phase 6 candidate |
| `GET /runtime/failures/trend` | Analytics / stream detail | No | Yes | No | Forensic / analytics |
| `GET /runtime/logs/alerts/summary` | Dashboard | Yes (dashboard) | Yes | No | WARN/ERROR grouping — logs domain |
| `GET /runtime/logs/search` | Logs explorer | Yes (logs) | Row scan | No | Forensic |
| `GET /runtime/logs/page` | Dashboard, logs | Yes (dashboard) | Cursor page | No | Forensic |
| `GET /runtime/logs/totals` | Logs explorer | No | Yes | No | Full-window totals |

## Analytics (`/runtime/analytics/*`)

| Endpoint | UI | Initial | DL agg | Snapshot | Historical | Phase 5 |
|----------|----|---------|--------|----------|------------|---------|
| `GET /runtime/analytics/retries/summary` | Dashboard, health panels | Yes (dashboard) | **Was yes** | **Yes** (operational KPI) | Trend needs DL | **Migrated** (operational path) |
| `GET /runtime/analytics/routes/failures` | Analytics page, health panels | Yes (analytics) | Yes | Partial | Yes | **Unchanged** (lazy analytics) |
| `GET /runtime/analytics/routes/{id}/failures` | Route health panel | No | Yes | Partial | Yes | Unchanged |
| `GET /runtime/analytics/delivery-outcomes/destinations` | Routes overview | Yes (routes) | Yes | Partial | Yes | Unchanged |
| `GET /runtime/analytics/streams/retries` | Analytics, stream health | No | Yes | Partial | Yes | Unchanged |

## Health (`/runtime/health/*`)

| Endpoint | UI | Initial | DL agg | Snapshot | Notes |
|----------|----|---------|--------|----------|-------|
| `GET /runtime/health/overview` | Dashboard | Yes (dashboard) | Yes (`current_runtime`) | Phase 6 | Still on dashboard initial path |
| `GET /runtime/health/streams` | Analytics health section | No | Yes | Phase 6 | |
| `GET /runtime/health/routes` | Routes / destinations panels | No | Yes | Phase 6 | |

## Per-stream runtime (configuration + bounded logs)

| Endpoint | UI | Initial | DL agg | Notes |
|----------|----|---------|--------|-------|
| `GET /runtime/stats/stream/{id}` | Stream detail | No | Bounded recent logs | Not overview path |
| `GET /runtime/streams/{id}/stats-health` | Stream detail | No | One bounded scan | |
| `GET /runtime/streams/{id}/metrics` | Stream detail, overview focus | No | Yes (window) | Shares dashboard snapshot_id |
| `GET /runtime/streams/{id}/webhook-ingest` | Webhook panel | No | Yes | |

## Unused / low-traffic on overview path

| Endpoint | UI | Notes |
|----------|----|-------|
| `GET /runtime/dashboard/summary` via Runtime Overview | **No** | Overview uses `operational-snapshot` only (verified in tests) |
| Legacy observability on Overview | **No** | Removed from initial Runtime Overview network |

## Frontend initial-render matrix (Phase 5)

| Page | Initial API calls | Legacy DL aggregate on first paint |
|------|-------------------|----------------------------------|
| Runtime Overview | `operational-snapshot` | **No** |
| Routes Overview | `operational-snapshot`, routes list, destination outcomes (analytics) | Partial (destination outcomes only) |
| Operations Dashboard | observability → parallel bundle; outcome-timeseries **deferred** | **Reduced** (summary + retries snapshot-backed) |
| Runtime Analytics | observability + analytics endpoints | Yes (by design — analytics page) |
| Logs Explorer | logs page/search/totals, observability | Yes (forensic) |

## Deprecation markers

Legacy delivery_logs aggregate handlers retain HTTP contracts. Docstrings mark:

- `not for operational overview initial render`
- `legacy delivery_logs aggregate path — use runtime_*_snapshot for live posture`

Endpoints are **not** deleted in Phase 5.
