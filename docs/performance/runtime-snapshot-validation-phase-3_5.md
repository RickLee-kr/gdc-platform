# Runtime Snapshot Validation — Phase 3.5

Stabilization pass for the operational-snapshot read path on **Runtime Overview** and **Routes Overview** (Phases 1–3). No backend schema changes, no StreamRunner changes, no websocket/SSE.

## 1. Runtime Overview network profile

### Initial requests (visible command center)

| Request | Count | Notes |
|---------|-------|--------|
| `GET /api/v1/runtime/operational-snapshot` | **1** | Single virtual snapshot; fixed vs stream count |
| Per-stream metrics / stats-health | **0** | Removed from initial path |
| Observability summary | **0** | Removed |
| Dashboard summary | **0** | Removed |
| Streams list (connector labels) | **0** | Removed |
| Logs page / alert summary | **0** | Removed |
| System resources | **0** | Removed |

### Refresh requests

| Trigger | Requests |
|---------|----------|
| Manual Refresh / header refresh | **1** snapshot (cache cleared first) |
| Auto-refresh interval (10s / 30s / 1m) | **1** snapshot per tick |
| Tab hidden | **0** (interval cleared) |
| Tab visible again | **1** safe snapshot refresh |
| Overlapping refresh while in-flight | **0** extra parallel calls; one queued follow-up |

In-flight refresh coalescing and `requestCache` (15s TTL, shared promise) prevent duplicate parallel snapshot GETs.

### Lazy analytics requests (on demand)

| Request | When |
|---------|------|
| `GET /runtime/streams/{id}/metrics?window=…` | User clicks **Load chart** on focused stream only |

`RuntimeRetentionSection` still uses retention APIs (configuration, not runtime telemetry).

## 2. Routes Overview network profile

### Initial requests

| Request | Count | Notes |
|---------|-------|--------|
| `GET /api/v1/runtime/operational-snapshot` | **1** | KPIs, table runtime columns, problems |
| `GET /api/v1/routes/` | **1** | Config metadata (rate limits, edit/toggle) |
| Streams / destinations list | **0** | Names from snapshot |
| Observability summary | **0** | Removed |
| Per-stream metrics (N) | **0** | Removed from initial table path |
| Per-route health | **0** | Status from `snapshot.routes[]` |
| Logs search (bulk) | **0** | Not on initial paint |

### Refresh requests

| Trigger | Requests |
|---------|----------|
| Manual refresh button / header refresh | **1** snapshot + **1** routes list (parallel) |
| Tab hidden → visible | **1** snapshot + **1** routes list |
| In-flight overlap | Queued single follow-up (no parallel duplicate snapshot) |

### Lazy / panel requests (on demand)

| Request | When |
|---------|------|
| Per-stream metrics + delivery outcomes | User **Load Analytics** (visibility-gated) |
| `GET /runtime/logs/search` + destination by id | Route panel when row selected and panel visible |

## 3. Removed structures (Phase 3.5 cleanup)

- N+1 per-stream metrics on Runtime/Routes initial render
- Per-route runtime health fetch on Routes row select (snapshot `health_status` instead)
- Observability summary + dashboard summary waterfalls on Runtime overview
- Logs aggregate on Routes initial paint
- Per-card / component-mount polling on command center sections
- Duplicate refresh timers without hidden-tab pause (Runtime provider interval cleanup confirmed)

## 4. Known remaining limitations

- Snapshot remains a **virtual aggregate** (bulk SQL per request), not physical read model tables (Phase 4).
- Snapshot windows fixed at **1m / 5m** delivery aggregates; UI window selectors apply to lazy analytics and panel logs only.
- No websocket / SSE incremental snapshot updates.
- Stream flow grid **not virtualized** — DOM cost still scales with stream count (TODO in UI).
- Backend DB work still proportional to `delivery_logs` volume until Phase 4 materialized read model.
- Routes page has no operator auto-refresh interval yet (Runtime has 10s/30s/1m); manual + header + visibility restore only.

## 5. Expected scale behavior

| Scale | API count (initial) | UI render |
|-------|---------------------|-----------|
| 20 streams | 1 snapshot (Runtime) / 1 snapshot + 1 routes (Routes) | ~20 cards |
| 100 streams | Same fixed API count | ~100 cards (grid scroll) |
| 300 streams | Same fixed API count | ~300 cards — consider virtualization |

Auto-refresh: **1** snapshot request per tick regardless of stream count.

## DEV instrumentation

`frontend/src/lib/operational-snapshot-debug.ts` logs (DEV only):

- `operational snapshot refresh` — reason, count, `updated_at`
- `operational snapshot refresh suppressed` — in-flight dedupe
- `operational snapshot visibility` — hidden-tab pause / resume

## Tests

```bash
cd frontend && npm run test -- --run \
  src/components/runtime/runtime-operational-provider.test.tsx \
  src/components/runtime/runtime-overview-page.test.tsx \
  src/components/routes/routes-overview-page.test.tsx \
  src/api/operationalSnapshot.test.ts \
  src/components/streams/stream-runtime-detail-page.test.tsx \
  src/components/streams/pipeline-debugger-panel.test.tsx

cd frontend && npm run build
```

## Browser verification checklist

1. **Runtime Overview** — Network tab: one `operational-snapshot` on load; auto-refresh adds one per interval; no repeated `streams/{id}/metrics` until **Load chart**.
2. **Routes Overview** — One `operational-snapshot` + one `routes/` on load; no `logs/search` until a route row is selected and panel is visible.
3. **document.hidden** — With auto-refresh on Runtime, confirm interval stops (no snapshot calls while hidden).
4. **visibility restore** — One snapshot refresh when returning to the tab.
