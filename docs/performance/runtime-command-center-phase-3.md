# Runtime Command Center — Phase 3 (Frontend)

## Problem (before Phase 3)

`RuntimeOverviewPage` assembled observability from many separate API calls:

| Call | Issue |
|------|--------|
| `GET /runtime/observability/summary` | Canonical KPI gate + waterfall |
| `GET /runtime/dashboard/summary` | Duplicate global KPIs |
| `GET /streams/` + per-stream `stats/health` (N) | N+1 enrichment |
| `GET /runtime/logs/page` | Logs on initial paint |
| `GET /runtime/alerts/summary` | Sidebar polling source |
| `GET /runtime/system/resources` | Host metrics on initial path |
| Per-stream `metrics` on select/expand | Repeated polling |

Multiple refresh timers and component-level fetches caused waterfall loading and API count scaling with stream count.

## Phase 3 solution

| Module | Role |
|--------|------|
| `frontend/src/api/operationalSnapshot.ts` | Typed client + 15s request dedupe cache (unchanged contract) |
| `frontend/src/components/runtime/runtime-operational-provider.tsx` | Single shared snapshot fetch, refresh, auto-refresh, hidden-tab gating |
| `frontend/src/components/runtime/runtime-overview-helpers.ts` | Health labels, problem sort, URL filter resolution |
| `frontend/src/components/runtime/runtime-overview-sections.tsx` | Command center UI sections |
| `frontend/src/components/runtime/runtime-overview-page.tsx` | Page shell + provider wiring |

### Initial render (one snapshot)

1. **Global Health Strip** — `snapshot.global` + `updated_at`
2. **Stream Flow Grid** — `snapshot.streams` (dense cards, no per-card API)
3. **Problem Insight Panel** — `snapshot.problems` (critical first)
4. **Route/Destination Health Summary** — `snapshot.routes` / `snapshot.destinations`

### Auto refresh

- Only `GET /api/v1/runtime/operational-snapshot` (cache cleared before manual/interval refresh)
- Default interval **Off** (from `loadRuntimeRefreshEvery()`)
- Paused when `document.hidden`

### Lazy analytics

- Delivery timeline chart loads **only** after user clicks **Load chart** on the selected stream
- Uses `fetchStreamRuntimeMetrics` for that single stream — not part of initial visible state

## Goals

| Metric | Target |
|--------|--------|
| Runtime initial visible | &lt; 2 s (UI + one snapshot) |
| Initial API count | **1** snapshot request (fixed vs stream count) |
| Auto refresh | **1** snapshot request per tick |

## Removed from initial path

- Observability summary
- Dashboard summary
- Streams list + connector labels
- Per-stream stats/health batch
- Logs page / alert summary on paint
- System resources on paint
- Chart/metrics polling until lazy load

## Future work

- Physical read model tables (`runtime_stream_snapshot`, etc.) — repository swap only
- WebSocket/SSE incremental snapshot updates
- Virtualized stream card grid for 300+ streams
- Optional lazy host resources / migration panel without blocking command center

## Tests

```bash
cd frontend && npm run test -- --run \
  src/components/runtime/runtime-operational-provider.test.tsx \
  src/components/runtime/runtime-overview-helpers.test.ts \
  src/components/runtime/runtime-overview-page.test.tsx \
  src/components/runtime/runtime-overview-loading.test.tsx
```

## Known limitations

- Snapshot windows remain **1m / 5m** delivery aggregates; analytics window selector applies only to lazy metrics
- Stream start/stop/run-once moved to stream runtime page (overview avoids control polling)
- No virtualized grid yet (TODO noted in stream flow section)
- `RuntimeRetentionSection` still uses its own API (configuration, not runtime telemetry)
