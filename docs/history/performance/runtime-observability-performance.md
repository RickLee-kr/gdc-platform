# Runtime Observability Performance Evidence

Collected on 2026-05-18 against the local Docker platform stack:

- API: `docker compose -f docker-compose.platform.yml up -d --build api frontend`
- Database: PostgreSQL container `gdc-platform-postgres`
- `delivery_logs` volume: 43,994 rows, newest row `2026-05-18 00:32:01.972013+00`

## Summary

- Shared frontend summary cache now deduplicates in-flight and fresh settled `fetchObservabilitySummary` requests by `window:snapshot_id`.
- Runtime, Routes, Logs, and overview flows now fetch independent APIs in parallel after resolving the canonical snapshot.
- Logs totals are split from paginated rows through `/api/v1/runtime/logs/totals`.
- Heavy route/health panels are visibility-gated and polling is paused when the document is hidden.
- No new PostgreSQL index was added. EXPLAIN evidence showed existing route/time indexes are used for selective route aggregates; full-window totals scan the active partition because the selected window covers nearly the whole measured partition.

## API Timing Evidence

Measured with `curl -w '%{time_total}'` against `http://127.0.0.1:8000`.

Before the targeted summary optimization:

- `/runtime/observability/summary?window=24h`: `0.789938s`
- `/runtime/observability/summary?window=24h&snapshot_id=...` cold: `0.854344s`
- Same summary snapshot reuse: `0.048639s`
- `/runtime/logs/totals?window=24h`: `0.141525s`
- `/runtime/logs/page?window=24h&limit=200`: `0.098819s`

After narrowing summary health work to the route posture counts it actually returns:

- `/runtime/observability/summary?window=24h&snapshot_id=...` cold: `0.466391s`
- Same summary snapshot reuse: `0.029893s`
- `/runtime/logs/totals?window=24h&snapshot_id=...`: `0.120222s`
- `/runtime/logs/page?window=24h&limit=200&snapshot_id=...`: `0.048271s`
- `/runtime/analytics/routes/failures?window=24h&snapshot_id=...` cold: `5.924618s`
- Same route analytics snapshot reuse: `0.039980s`

The route analytics cold path remains the heaviest measured endpoint, but it is no longer loaded eagerly by the optimized page flow and repeats are covered by snapshot materialization.

## EXPLAIN ANALYZE Evidence

Observability summary aggregate, 24h:

- Plan: `Parallel Append` into `Parallel Seq Scan` on active monthly partition.
- Rows: about 14,718 per worker.
- Buffers: `shared hit=3121`.
- Execution time: `132.442 ms`.
- Decision: no index added. The 24h window covers essentially the active measured partition, so PostgreSQL correctly scans the partition in parallel.

Runtime health route aggregate, 24h:

- Plan: `Bitmap Index Scan` on `delivery_logs_2026_05_route_id_created_at_idx`, then `Bitmap Heap Scan`, sort, `GroupAggregate`.
- Rows returned to aggregate: `5,328`.
- Buffers: `shared hit=3079`.
- Execution time: `75.535 ms`.
- Decision: existing route/time index is effective; no new index justified.

Route analytics aggregate, 24h:

- Plan: `Bitmap Index Scan` on `delivery_logs_2026_05_route_id_created_at_idx`, then `Bitmap Heap Scan`, sort, `GroupAggregate`.
- Rows returned to aggregate: `5,328`.
- Buffers: `shared hit=3079`.
- Execution time: `87.886 ms`.
- Decision: backend SQL plan is not the source of the multi-second cold API time; avoid speculative indexing.

Logs totals aggregate, 24h:

- Plan: `Parallel Append` into `Parallel Seq Scan` on active monthly partition.
- Rows: about 14,718 per worker.
- Buffers: `shared hit=3127`.
- Execution time: `89.725 ms`.
- Decision: no index added because the full-window totals request reads most of the active partition.

## Browser Evidence

Screenshots captured with Playwright from the running frontend:

- `docs/history/performance/runtime-dashboard-network.png`
- `docs/history/performance/logs-page-network.png`

Browser request grouping for Dashboard followed by Logs:

- Runtime overview summary request: 1 unique `/runtime/observability/summary?...` URL for the overview snapshot.
- Logs summary request: 1 unique `/runtime/observability/summary?...` URL for the logs snapshot.
- No duplicate same-key observability summary request was observed.
- Logs page issued `/runtime/logs/totals?...` once and `/runtime/logs/page?...` once for the paginated rows.
- The Playwright response ordering showed `logs_totals_before_rows: true`, proving totals no longer wait on the row payload.

## Validation

- Frontend focused tests: `npm test -- --run src/api/observabilitySummary.test.ts src/components/dashboard/dashboard-overview.test.tsx src/components/logs/logs-explorer-status-filters.test.tsx src/lib/observability-format.test.ts src/components/runtime/runtime-monitoring-aggregates.test.ts` passed, 23 tests.
- Backend focused tests: `pytest tests/test_observability_metric_contract.py tests/test_runtime_dashboard_summary_endpoint.py tests/test_runtime_snapshot_materialization.py tests/test_runtime_metrics.py tests/test_runtime_logs_page_endpoint.py tests/test_throughput_normalization.py` passed, 64 tests.
- Docker platform build/start: `docker compose -f docker-compose.platform.yml up -d --build api frontend` completed successfully.
