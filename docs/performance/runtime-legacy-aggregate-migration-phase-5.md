# Runtime Legacy Aggregate Migration — Phase 5

Phase 5 moves **operational** runtime dashboard and retry KPI reads from per-request `delivery_logs` full scans to the physical read model (`runtime_stream_snapshot`, `runtime_route_snapshot`, `runtime_destination_snapshot`).

## 1. Previously slow APIs (production signals)

| Endpoint | Symptom |
|----------|---------|
| `GET /api/v1/runtime/dashboard/summary` | `slow_sql_critical` on `delivery_logs` |
| `GET /api/v1/runtime/dashboard/outcome-timeseries` | Full-window GROUP BY buckets |
| `GET /api/v1/runtime/analytics/retries/summary` | Window aggregate on retry stages |

## 2. Migrated APIs (Phase 5)

| Endpoint | Read path when read model populated |
|----------|--------------------------------------|
| `GET /runtime/dashboard/summary` | `runtime_snapshot_analytics_repository.load_runtime_dashboard_summary` |
| `GET /runtime/analytics/retries/summary` | `load_retry_summary` (snapshot EPS + `retry_rate_5m`) |
| `GET /runtime/dashboard/outcome-timeseries` (window ≤ 1h) | Single operational bucket from snapshot EPS |

Fallback: legacy `delivery_logs` path when snapshots are empty (first deploy / updater not yet run).

## 3. Snapshot-backed architecture

```text
delivery_logs
  → RuntimeSnapshotUpdater (30s)
  → runtime_*_snapshot tables
  → runtime_snapshot_analytics_repository
  → dashboard/summary, analytics/retries/summary, short outcome-timeseries

GET /runtime/operational-snapshot  (unchanged contract; Phase 4)
  → operational_snapshot_service
```

Module: `app/runtime/runtime_snapshot_analytics_repository.py`

- Allowed: aggregate over snapshot rows + lightweight entity metadata joins
- Forbidden: `delivery_logs` queries in this module

## 4. Remaining `delivery_logs` aggregate endpoints

| Area | Endpoints | Purpose |
|------|-----------|---------|
| Analytics deep dive | `/runtime/analytics/routes/failures`, `/streams/retries`, … | Historical / forensic |
| Observability | `/runtime/observability/summary` | Cross-page canonical totals (Phase 6) |
| Health scoring | `/runtime/health/*` | Scoring over logs windows |
| Logs | `/runtime/logs/*`, `/runtime/failures/trend` | Explorer / audit |
| Per-stream | `/runtime/streams/{id}/metrics`, stats-health | Bounded or detail views |
| Outcome timeseries | `/runtime/dashboard/outcome-timeseries` (window > 1h) | Dense historical buckets |

## 5. Expected operational latency improvement

| Request | Before | After (populated read model) |
|---------|--------|------------------------------|
| Dashboard summary | O(delivery_logs in window) | O(streams + routes + destinations) |
| Retry summary | O(delivery_logs in window) | O(routes) filtered |
| Overview initial network | Already `operational-snapshot` only | Unchanged |
| Operations dashboard first paint | Included outcome-timeseries DL scan | Outcome chart deferred; summary/retries snapshot-backed |

Target: dashboard summary p95 stable as `delivery_logs` row count grows (dev sub-second on tens of entities).

## 6. Frontend changes

- **Runtime Overview / Routes**: no legacy dashboard/analytics on initial render (unchanged).
- **Operations dashboard** (`use-dashboard-overview-data.ts`): `outcome-timeseries` loaded after core bundle (lazy).

## 7. Known limitations

- Dashboard KPI fields use **5m operational snapshot semantics** scaled to the requested window label (not a full re-scan of long windows).
- `retry_column_sum` is `0` on the snapshot retry path (not stored in read model).
- `validation_operational` embedded in dashboard summary still uses validation tables (not migrated here).
- `GET /runtime/health/overview` on dashboard initial load still uses health scoring over logs (Phase 6).

## 8. Phase 6 possibilities

- Migrate `observability/summary` and `health/overview` to snapshot + entity tables
- Optional `runtime_global_snapshot` or pre-bucketed outcome table for dense charts
- Incremental rollup table for 24h windows without per-request `delivery_logs` GROUP BY

## Tests

```bash
python3 -m pytest tests/test_runtime_snapshot_analytics.py \
  tests/test_runtime_dashboard_summary_endpoint.py \
  tests/test_runtime_analytics_endpoints.py -q
```
