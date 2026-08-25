# Performance P1 Optimization Report

**Branch:** `feature/sensitive-detection-m5-clean`  
**Date:** 2026-06-20  
**Scope:** Frontend-only optimizations from Audit Report P1 (no runtime/API contract changes)

---

## Summary

Four P1 optimizations reduce Streams Console initial HTTP fan-out, defer heavy route chunks until navigation, and document Governance Workspace API fan-out for future work.

| # | Change | Primary benefit |
|---|--------|-----------------|
| 1 | Streams Console lazy mapping-ui | Removes N mapping-ui calls from initial load |
| 2 | Lazy `StreamRuntimeDetailPage` | Runtime detail + recharts out of main entry chunk |
| 3 | Lazy Dashboard + recharts `manualChunks` | Dashboard charts load on `/monitoring` only |
| 4 | Governance Workspace fan-out analysis | Root cause documented; quick wins proposed |

---

## 1. Streams Console — N+1 mitigation

### Before

Initial refresh per load cycle:

```
4 + C + 2N HTTP
```

For **50 streams** and **~5 unique connectors**: **≈114 HTTP**

| Call | Count |
|------|-------|
| `fetchRuntimeDashboardSummary` | 1 |
| `fetchStreamsListResult` | 1 |
| `fetchRoutesList` | 1 |
| `fetchDestinationsList` | 1 |
| `fetchConnectorById` | C |
| `fetchStreamMappingUiConfig` | **N** |
| `fetchStreamRuntimeStatsHealth` | **N** |

### After

Initial refresh:

```
4 + C + N HTTP
```

For **50 streams**, **5 connectors**, **all groups collapsed**: **≈64 HTTP** (**−50 mapping-ui calls, −44%** vs prior 114)

| Phase | Calls |
|-------|-------|
| Initial (list + KPI + routes/destinations + connectors + stats/health) | 4 + C + N |
| Group expand (mapping-ui for expanded streams only) | 0 → M (on demand) |
| Virtual flat table (≥50 rows, hidden regression table) | viewport slice only |

### Implementation

- `enrichStreamConsoleRows` — connectors + runtime stats/health only.
- `enrichMappingUiForStreamIds` — deferred until product group expand or virtualized flat-table viewport.
- Initial group view renders Problem Status, Health, Rates from stats/health without mapping-ui.

**Files:** `frontend/src/components/streams/streams-console.tsx`

---

## 2. Lazy Runtime Page

### Before

`StreamRuntimeDetailPage` was eagerly imported in `App.tsx`, pulling runtime detail UI (including recharts) into the main bundle for every route.

### After

Route uses existing `LazyStreamRuntimeDetailPage` from `lazy-routes.tsx` with `Suspense` fallback.

**Files:** `frontend/src/App.tsx`, `frontend/src/routes/lazy-routes.tsx`

---

## 3. Recharts chunk separation

### Before

`DashboardOverview` was eagerly imported; `dashboard-visual-panels.tsx` imports recharts synchronously → included in the main entry graph for all pages.

### After

1. **`LazyDashboardOverview`** — dashboard page code loads on `/monitoring` navigation.
2. **`vite.config.ts` `manualChunks`** — `recharts` and `d3-*` deps emitted as `vendor-recharts` chunk.

### Bundle impact (production build)

| Chunk | Before (approx.) | After (approx.) | Notes |
|-------|------------------|-----------------|-------|
| `vendor-recharts-*.js` | — | 422 KB (gzip 123 KB) | shared by dashboard, runtime detail, routes |
| Dashboard lazy chunk | — | 49 KB (gzip 14 KB) | loads on dashboard route |
| Main entry (`index-*.js`) | includes recharts subgraph | 991 KB (gzip 250 KB) | recharts in separate async chunk |

**Files:** `frontend/src/App.tsx`, `frontend/src/routes/lazy-routes.tsx`, `frontend/vite.config.ts`

---

## 4. Governance Workspace fan-out analysis

**File:** `frontend/src/components/governance/governance-workspace-page.tsx`

### Call pattern

| Step | API | Count |
|------|-----|-------|
| Initial lists | `fetchStreamsList`, `fetchRoutesList` | 2 |
| Per route | `fetchRouteTransformEffective` | R |
| Per route | `fetchRouteProtectionEffective` | R |
| Per route | `fetchRouteClassificationEffective` | R |
| Per route | `fetchRoutePolicyEffective` | R |

**Total: 2 + 4R HTTP** → **50 routes ≈ 202 HTTP**

### Root cause

`fetchRouteGovernanceSnapshot` runs `Promise.all` of four effective-config endpoints for **every route across all streams** on page load, before the user selects a stream. No read-cache on effective endpoints; each route id is unique so there is no cross-route duplicate payload.

### Duplicate fetch?

- **Across routes:** No — each route has distinct effective config.
- **Across pages:** `fetchRoutesList` may hit 15s catalog cache (P0) if user visited Streams/Routes recently.
- **Within workspace refresh:** Full 4R fan-out repeats on every Refresh click.

### Quick wins (not implemented — analysis only)

| Win | Effort | Impact |
|-----|--------|--------|
| Load snapshots only for **selected stream** routes | Low | 4R → 4r (r = routes for one stream) |
| Add 15s `cachedRequest` on effective GETs | Low | Repeat refresh / navigation dedupe |
| Stream picker first, fetch on selection | Low | Initial load 2 HTTP until stream chosen |
| Backend batch effective endpoint | High | 4R → 1 (out of P1 scope) |

---

## 5. Performance measurement

### API count — Streams Console (50 streams, 5 connectors, collapsed groups)

| Metric | Before P1 | After P1 |
|--------|-----------|----------|
| Initial HTTP | ~114 | **~64** |
| After expanding 1 group (5 streams) | ~114 (all upfront) | ~64 + 5 = **~69** |
| Full mapping-ui (all 50 expanded) | ~114 | ~64 + 50 = **~114** (same total, deferred) |

### Runtime entry

| Metric | Before | After |
|--------|--------|-------|
| Main bundle includes runtime detail | Yes | **No** (async chunk) |
| First paint on `/streams` | loads runtime detail code | **skips** runtime detail chunk |

### Cache hit (unchanged from P0)

Within 15s refresh cycle: `fetchRoutesList`, `fetchRuntimeDashboardSummary` (with `createRefreshCycleSnapshotId`) still benefit from P0 caches.

---

## 6. Regression check

| Area | Status |
|------|--------|
| Runtime stream control | Unchanged |
| API contracts | Unchanged |
| Streams group view (status, rates, issues) | PASS — initial render without mapping-ui |
| Runtime route lazy load | PASS |
| Dashboard route lazy load | PASS |
| Existing streams console tests | PASS |
| New P1 tests | PASS |
| `npm run build` | PASS |

---

## Tests added

| Test file | Coverage |
|-----------|----------|
| `frontend/src/components/streams/streams-console-lazy-mapping.test.tsx` | No mapping-ui on collapsed load; fetch on group expand |
| `frontend/src/api/performance-p1-lazy-routes.test.ts` | Lazy dashboard + runtime route exports |

---

## Out of scope (P2+)

- Backend batch stats/health for Streams Console
- Governance Workspace implementation changes
- React Query / architecture refactor
- Component-level AbortController on unmount

---

## Commit

Message: `Optimize streams loading and frontend bundle size`
