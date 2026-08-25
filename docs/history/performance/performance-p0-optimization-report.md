# Performance P0 Optimization Report

**Branch:** `feature/sensitive-detection-m5-clean`  
**Date:** 2026-06-20  
**Scope:** Frontend-only quick wins from Performance & Runtime UX Audit (no runtime/API contract changes)

---

## Summary

Five P0 optimizations reduce duplicate HTTP calls, improve cache hit rates, and stabilize observability snapshot alignment. No new endpoints, no React Query, no backend changes.

| # | Change | Primary benefit |
|---|--------|-----------------|
| 1 | Runtime Detail single refresh | Eliminates duplicate initial batch (~13 HTTP) |
| 2 | `fetchStreamRuntimeStatsHealth` | Stats + health 2→1 per refresh |
| 3 | `fetchRoutesList` 15s cache | Dedupes routes list across Streams / Routes / Governance |
| 4 | `createRefreshCycleSnapshotId` | Aligns snapshot_id with 15s read-cache TTL |
| 5 | `fetchStreamById` 15s cache | Dedupes list→detail and header label fetches |

---

## 1. Runtime Detail — duplicate refresh removed

### Before
- `refreshRuntimeData()` ran on every `refreshRuntimeData` callback identity change.
- `streamEntity?.stream_type` in deps caused a second full batch when stream metadata loaded.
- Separate `fetchStreamRuntimeStats` + `fetchStreamRuntimeHealth` (2 HTTP).
- Metrics used a new `snapshot_id` unrelated to the stats-health batch.

### After
- Stream metadata fetch sets `streamMetaReady`; runtime batch runs **once** after metadata settles.
- `fetchStreamRuntimeStatsHealth` replaces separate stats + health calls.
- One `createRefreshCycleSnapshotId()` per refresh; reused for stats-health and metrics.

### API count (HTTP stream, overview tab)

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Initial load (incl. duplicate batch) | ~28 | ~14 | **−14 (−50%)** |
| Per manual refresh | ~13 | ~12 | **−1** (stats+health merge) |

**Files:** `frontend/src/components/streams/stream-runtime-detail-page.tsx`

---

## 2. `fetchRoutesList` — 15s catalog cache

### Before
- Every call hit `GET /api/v1/routes/` (no `cachedRequest`).
- Streams Console refresh, Governance Workspace, Routes Overview each paid full network cost.

### After
- `cachedRequest` with `catalog-routes` namespace, TTL `CATALOG_LIST_CACHE_TTL_MS` (15s).
- In-flight dedupe preserved; fixture mode unchanged inside uncached loader.

### Impact

| Scenario | Before | After (within 15s) |
|----------|--------|---------------------|
| Streams + Routes navigation | 2 network | 1 network |
| Streams auto-refresh tick | 1 network/tick | 0 (cache hit) |

**Files:** `frontend/src/api/gdcRoutes.ts`, `frontend/src/api/catalogListCache.ts`

---

## 3. `fetchStreamById` — 15s by-id cache

### Before
- Uncached `GET /api/v1/streams/{id}` on every detail visit and shell label resolution.

### After
- `cachedRequest` with `catalog-stream-by-id` namespace, TTL 15s (same pattern as `fetchConnectorById`).

### Impact

| Scenario | Before | After (within 15s) |
|----------|--------|---------------------|
| Streams list → Runtime Detail | 2× stream fetch possible | 1× network |
| Runtime Detail + header label | 2× same id | 1× network |

**Files:** `frontend/src/api/gdcStreams.ts`

---

## 4. `snapshot_id` stabilization

### Before
- `new Date().toISOString()` / `createRuntimeSnapshotId()` on every load tick.
- Dashboard summary cache key included unique snapshot → **cache miss every refresh**.

### After
- `createRefreshCycleSnapshotId()` reuses the same id for **15s** (matches read-cache TTL).
- Applied in Dashboard load, Streams Console KPI fetch, Runtime Detail refresh batch.

### Cache hit expectation

| Surface | Before | After |
|---------|--------|-------|
| `fetchRuntimeDashboardSummary` within 15s | Miss each tick | **Hit** on repeated load/refresh |
| Runtime metrics/stats-health same cycle | Different ids | **Same id** in one refresh |

**Files:** `frontend/src/api/runtimeSnapshotSync.ts`, `use-dashboard-overview-data.ts`, `streams-console.tsx`, `stream-runtime-detail-page.tsx`

---

## 5. Regression check

| Area | Status |
|------|--------|
| Runtime stream control (start/stop/run once) | Unchanged — still calls `refreshRuntimeData()` |
| Webhook vs HTTP checkpoint gating | Unchanged — uses `streamEntity?.stream_type` at batch time |
| Routes fixture mode | PASS — `gdcRoutes.fixture.test.ts` |
| Existing runtime detail tests | PASS — 12 tests |
| New P0 cache tests | PASS — 4 tests |
| `npm run build` | PASS |

---

## Tests added

| Test file | Coverage |
|-----------|----------|
| `frontend/src/api/performance-p0-cache.test.ts` | Routes list cache, stream by-id cache, snapshot reuse TTL |
| `frontend/src/components/streams/stream-runtime-detail-page.test.tsx` | Single refresh execution, stats-health path, snapshot reuse for metrics |

---

## Estimated duplicate call reduction (typical session)

| Flow | Duplicate calls removed |
|------|-------------------------|
| Open Runtime Detail once | ~14 HTTP (duplicate batch) + 1 (stats/health) |
| Streams page refresh within 15s | 1 (routes list) |
| Dashboard reload within 15s | Up to 3 (core summary cache hits) |
| List → Detail within 15s | 1 (stream by-id) |

---

## Out of scope (P1+)

- Streams Console N+1 per-stream enrichment batch API
- Lazy-load `StreamRuntimeDetailPage` in `App.tsx`
- `manualChunks` / recharts split
- Component-level `AbortController` on unmount

---

## Commit

Message: `Optimize frontend runtime loading and caching`
