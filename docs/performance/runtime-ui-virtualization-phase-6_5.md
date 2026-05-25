# Runtime UI Virtualization — Phase 6.5 (Frontend)

## Problem (before Phase 6.5)

Backend and snapshot/query paths were bounded (Phase 4–6), but Runtime Overview and Routes still scaled **DOM and React render cost** with stream/route count:

| Area | Issue |
|------|--------|
| Stream flow grid | `snapshot.streams.map` mounted every card |
| Routes table | Paginated, but refresh re-rendered full row set |
| Snapshot refresh | New array references forced full subtree updates |
| Filter/search | Recomputed on every keystroke |
| Initial paint | Problems, route summary, and analytics mounted together |
| Charts | Recharts mount cost on lazy section |

Targets: **100–1000 streams** and large route tables without browser jank.

## Solution overview

| Module | Role |
|--------|------|
| `frontend/src/lib/windowed-virtual-range.ts` | Fixed-size viewport window (no extra npm dep) |
| `frontend/src/components/runtime/virtualized-stream-grid.tsx` | Responsive multi-column virtual grid |
| `frontend/src/lib/runtime-stream-selectors.ts` | Debounced filter + topology grouping |
| `frontend/src/lib/snapshot-stabilize.ts` | Keyed diff; stable stream/route object refs |
| `frontend/src/components/runtime/runtime-operational-provider.tsx` | Split meta vs snapshot context |
| `frontend/src/components/runtime/runtime-stream-card.tsx` | `React.memo` stream cards |
| `frontend/src/components/routes/routes-table-row.tsx` | `React.memo` route rows |
| `frontend/src/hooks/use-debounced-value.ts` | Stable search (200ms) |
| `frontend/src/hooks/use-deferred-mount.ts` | Progressive mount for side panels / charts |
| `frontend/src/lib/runtime-ui-instrumentation.ts` | DEV-only render/window metrics |

**Unchanged:** operational snapshot API, polling semantics, UX layout, no WebSocket/SSE, no mock data.

## 1. Virtualization architecture

### Stream grid

- Filtered streams → optional **topology groups** (flat, health, connector, destination type).
- Groups collapse/expand; collapsed groups omit card rows from the virtual list.
- Items are packed into **grid rows** (1–4 columns via `ResizeObserver`).
- Scroll container (`max-h: 420px`) renders only rows intersecting the viewport (+ small overscan).
- **Mounted cards ≈ visible window × columns**, not `N streams`.

### Routes table

- When `filteredRows.length >= 24`, pagination is replaced by **virtual scroll** on the table body.
- Top/bottom spacer `<tr>` rows preserve scroll height.
- `RoutesTableRow` is memoized; unchanged `RouteConsoleRow` refs skip row re-render on refresh.

## 2. Render isolation

```
RuntimeOperationalProvider
├── MetaContext (loading, error, refresh controls)  → header controls
└── SnapshotContext (stabilized snapshot + streamsById)
    ├── GlobalHealthStrip      → snapshot.global only
    ├── StreamFlowGrid         → streams + virtual grid
    ├── ProblemInsightPanel    → deferred mount
    └── RouteDestinationHealth → deferred mount
```

Snapshot refresh updates **only** stream objects whose operational fields changed (EPS, health, errors, etc.).

## 3. Memoization strategy

- **Stream cards:** `memo` with referential equality on `stream` prop (stable from `stabilizeOperationalSnapshot`).
- **Route rows:** same pattern for `row: RouteConsoleRow`.
- **Selectors:** `filterOperationalStreams` / `filterRouteConsoleRows` in `useMemo` with **debounced** search input.
- **Tab counts:** `countStreamsByTab(streams)` memoized on `streams` reference.

## 4. Incremental filtering / search

- `useDebouncedValue(search, 200)` before filter selectors.
- Tab changes reset virtual scroll position implicitly via new filtered array length.
- Group collapse state is local `Set<string>`; compatible with virtualization.

## 5. Progressive mount & charts

- Side panels (`ProblemInsightPanel`, `RouteDestinationHealthSummary`): `useDeferredMount(48)` via `requestIdleCallback` / timeout.
- Lazy analytics: deferred section mount + chart only after user clicks **Load chart**; timeline capped at 120 points.

## 6. Expected scale behavior

| Streams | DOM cards (typical) | Refresh rerender |
|---------|---------------------|------------------|
| 100 | ~12–24 visible | Changed streams only |
| 500 | ~12–24 visible | Changed streams only |
| 1000 | ~12–24 visible | Changed streams only |

| Routes (filtered) | Mode |
|-------------------|------|
| &lt; 24 | Pagination (unchanged UX for small lists) |
| ≥ 24 | Virtual scroll, ~10–15 mounted rows |

## 7. DEV instrumentation

Instrumentation is **opt-in in development** to avoid noisy consoles:

```js
localStorage.setItem('GDC_RUNTIME_UI_DEBUG', '1') // enable section/refresh debug logs
localStorage.removeItem('GDC_RUNTIME_UI_DEBUG')     // disable (default)
```

When enabled (`import.meta.env.DEV` + `GDC_RUNTIME_UI_DEBUG=1`):

- `recordRuntimeSectionRender(section)`
- `recordSnapshotRefreshRerender(changedStreamIds)`

Virtual window counters (`recordVirtualWindow`) update in-memory metrics in DEV without console output.

**Production:** no runtime UI console noise.

## 8. DEV fixture mode (browser validation without DB scale)

Phase 6.5 manual validation uses **static operational snapshot JSON** served from `frontend/public/dev-fixtures/`.  
No backend mock endpoint, no DB inserts, no API contract changes.

### Architecture

```
generate-runtime-ui-scale-fixture.sh
  → frontend/public/dev-fixtures/runtime-operational-snapshot-320x120.json

localStorage GDC_RUNTIME_FIXTURE_MODE=1  (DEV only)
  → getOperationalSnapshot() fetches /dev-fixtures/<file>.json
  → fetchRoutesList() derives rows from the same fixture
  → Runtime Overview / Routes render virtualization at scale
```

| Key | Purpose |
|-----|---------|
| `GDC_RUNTIME_FIXTURE_MODE` | `1` = fixture mode (DEV only) |
| `GDC_RUNTIME_FIXTURE_FILE` | JSON file name under `/dev-fixtures/` |

Default file: `runtime-operational-snapshot-320x120.json`

### Generate fixtures (no DB writes)

```bash
./scripts/dev/generate-runtime-ui-scale-fixture.sh 320 120
```

Writes to `frontend/public/dev-fixtures/` (Vite static) and archives a stamped copy under `scripts/dev/fixtures/`.

### Enable fixture mode (admin / dev-validation only)

Fixture mode works in **production-like builds** when:

1. Signed-in user is **ADMINISTRATOR**, **or** platform `enable_dev_validation_lab` is true (`GET /admin/dev-validation/status`), **and**
2. Explicit opt-in via **localStorage** or **`runtime_fixture=1` URL param**.

Normal operators/viewers never see controls; fixture JSON remains read-only static assets under `/dev-fixtures/`.

**Option A — URL (recommended for deployed validation):**

```
https://<host>/runtime?runtime_fixture=1&runtime_fixture_file=runtime-operational-snapshot-320x120.json
```

**Option B — localStorage (admin session required):**

```js
localStorage.setItem('GDC_RUNTIME_FIXTURE_MODE', '1')
localStorage.setItem('GDC_RUNTIME_FIXTURE_FILE', 'runtime-operational-snapshot-320x120.json')
location.reload()
```

**Option C — UI banner:** Administrators (or dev-validation environments) see an admin-only panel on Runtime Overview / Routes to enable fixture mode. When active, an amber banner reads:

`DEV FIXTURE MODE ACTIVE — using simulated operational snapshot`

**Console diagnostics:**

```js
// success
[runtime-fixture] { enabled: true, file, streams, routes }
// rejected
[runtime-fixture] { rejected: true, reason: 'not-admin' | 'missing-file' | ... }
```

**Disable:**

```js
localStorage.removeItem('GDC_RUNTIME_FIXTURE_MODE')
localStorage.removeItem('GDC_RUNTIME_FIXTURE_FILE')
location.reload()
```

### Runtime Overview (300+ streams via fixture)

1. Generate fixture (above) and enable fixture mode.
2. Open `/runtime/overview` in Chrome.
3. Banner shows: file name · **320 streams** · route/destination counts.
4. **Network:** **no** `operational-snapshot` API call; only `GET /dev-fixtures/runtime-operational-snapshot-320x120.json`.
5. Tab strip shows **All 320** (or filtered counts).
4. **Elements panel:** stream card nodes ≪ total stream count (typically &lt;40 mounted).
5. **Scroll:** stream flow grid scrolls smoothly; cards swap as you scroll.
6. **Refresh:** trigger header refresh; CPU spike should stay bounded vs mounting all cards.
7. **React Profiler (optional):** record refresh; unchanged stream cards should not rerender.

**Pass:** mounted cards bounded; snapshot API count stable; scroll usable.  
**Fail:** thousands of card nodes; N per-stream metric calls on load; scroll jank.

### Routes (120 routes via fixture)

1. With fixture mode enabled, open `/routes`.
2. Confirm **Virtual scroll · N visible · 120 routes** footer.
3. **Network:** no `operational-snapshot` or `/routes/` list API; fixture JSON only.
4. Scroll table body; visible row count stays ~10–20; early route rows unmount when scrolled.

### Chrome Performance / React Profiler

1. Performance → Record → load Runtime Overview → stop.
2. Check **Scripting** time and **Nodes** in summary; compare before/after Phase 6.5 baselines if available.
3. React Profiler → record snapshot refresh → inspect `RuntimeStreamCard` render count.

## 9. Dashboard scope (Phase 6.5)

| Surface | Phase 6.5 scope |
|---------|-----------------|
| Runtime Overview stream grid | In scope — virtualized |
| Routes table | In scope — virtual scroll ≥24 rows |
| Dashboard overview | **Out of scope** — no large stream/route flat list; only existing deferred timeseries in `use-dashboard-overview-data.ts` |

If Dashboard later adds large stream/route lists, treat virtualization as a **separate phase**.

## 10. Validation checklist

1. Runtime Overview with 300+ streams: smooth scroll, low DOM node count (Elements panel).
2. Snapshot auto-refresh: CPU spike reduced vs full grid remount.
3. Routes with 100+ rows: virtual scroll engages; sticky header intact.
4. React Profiler: stream card rerenders bounded on refresh.
5. Initial paint: stream grid first; side panels follow within idle frame.

## 11. Known limitations

- Fixture mode is **DEV-only**; production builds ignore localStorage fixture flags.
- Fixture refresh re-reads static JSON (no live EPS changes unless you regenerate the file).
- Route/destination **writes** (toggle, test) still hit real APIs when clicked — fixture mode only replaces snapshot **reads**.
- Virtual grid uses **estimated fixed row heights** (group header vs card row); very tall error text may clip slightly until scroll.
- Routes virtual mode drops pagination controls (by design at ≥ 24 rows).
- Topology **environment / stream tags** not in snapshot schema yet; grouping uses connector and destination type from snapshot routes.
- `@tanstack/react-virtual` was not added (npm install permission issue); windowing is an in-repo fixed-size implementation.

## Tests

```bash
cd frontend && npm run test -- --run \
  src/lib/snapshot-stabilize.test.ts \
  src/lib/runtime-stream-selectors.test.ts \
  src/lib/windowed-virtual-range.test.ts \
  src/lib/runtime-ui-instrumentation.test.ts \
  src/lib/runtime-operational-fixture-mode.test.ts \
  src/api/operationalSnapshot.test.ts \
  src/api/gdcRoutes.fixture.test.ts \
  src/hooks/use-deferred-mount.test.ts \
  src/components/runtime/runtime-overview-fixture-mode.test.tsx \
  src/components/runtime/runtime-stream-card.test.tsx \
  src/components/runtime/virtualized-stream-grid.test.tsx \
  src/components/runtime/runtime-overview-virtualization.test.tsx \
  src/components/runtime/runtime-overview-deferred.test.tsx \
  src/components/routes/routes-overview-helpers.test.ts \
  src/components/routes/routes-overview-virtualization.test.tsx
```

Production build:

```bash
cd frontend && npm run build
```
