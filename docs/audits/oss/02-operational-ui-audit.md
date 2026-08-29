# Operational UI / Data Visualization Audit

> **Closure (2026-08-29):** Scheduled OSS Fit implementation is complete. W12/W13 remain `DEFERRED_PRODUCT_DECISION` and are not completion blockers. This file remains the pre-implementation audit record. See [DATA-RELAY-OSS-IMPLEMENTATION-WORKPLAN.md](./DATA-RELAY-OSS-IMPLEMENTATION-WORKPLAN.md).

## Correct-branch reconciliation

**Reconcile agent:** F — Operational UI Delta Reconciliation  
**Codebase:** `/home/aella/gdc-oss-reconcile`  
**Branch:** `audit/code-to-oss-fit-reconcile`  
**HEAD:** `99dd3bac886760460201f54deaaa282ec0e98bc1` (`feat(operations): implement P0 test before apply impact preview`)  
**Date:** 2026-08-29  
**Mode:** Read-only product inspection. This section only. No product code, tests, or workplan files were modified.

Old Agent 2 recommendations (below, written against `gdc-platform` HEAD `1f270e8`): P2 React Flow + Dagre topology canvas; P2 TanStack Table; P1 TanStack Virtual for trees/lists.

**Hard rule (unchanged):** Operational Snapshot remains the metrics source of truth. Graph libraries must not become SoT. `getOperationalSnapshot` / snapshot selectors stay the KPI path. Topology JSON may project membership; it must not compute EPS / Success Rate / Checkpoint independently.

### Verdict (this branch)

| Recommendation | Classification | Workplan impact |
| --- | --- | --- |
| P2 `@xyflow/react` + `@dagrejs/dagre` topology canvas | **DEFER** | Keep W13 optional. Do not schedule. Do not promote. |
| P2 `@tanstack/react-table` (headless) | **DEFER** | Keep W12 optional. Do not promote. Custom ops tables already work. |
| `@tanstack/react-virtual` for ops lists | **NO_LONGER_NEEDED** (dep) | Streams/Routes/runtime grids already windowed in-repo. Do **not** replace. |
| `@tanstack/react-virtual` for Union Schema tree | **REJECT dep** | Tree is recursive, capped `MAX_PATHS=500`. W3 **DELETE**. Optional later in-repo flatten+window is DEFER, not a scheduled P1. |

Archify wholesale remains **REJECT** (not re-opened). Recharts stays for timeseries. Existing `computeWindowedRange` / `computeFixedRowVirtualRange` remain **KEEP**.

### Evidence vs this HEAD

`frontend/package.json` dependencies: React 19, Recharts `^3.8.1`. **Not present:** `@xyflow/react`, `@dagrejs/dagre`, `@tanstack/react-table`, `@tanstack/react-virtual`.

Canonical `docs/canonical/07-OPERATIONS-OBSERVABILITY.md` requires fleet → stream → route → destination → evidence, with dashboard as fleet-health entry. It does **not** require an interactive graph canvas. Data Flow Troubleshooter is `TARGET` from structured evidence, not from a graph lib.

#### Topology canvas — DEFER (not STILL_REQUIRED, not ALREADY_IMPLEMENTED)

| Layer | This branch | Notes |
| --- | --- | --- |
| Metrics SoT | Operational Snapshot | `frontend/src/api/operationalSnapshot.ts` `getOperationalSnapshot`; dashboard `use-dashboard-overview-data.ts` loads snapshot first; KPIs via `deriveDashboardKpisFromSnapshot` |
| Topology API | Implemented | `app/runtime/topology_service.py` `get_runtime_topology` (config graph Connector → Source → Stream → Route → Destination + health); `GET /topology` in `app/runtime/router.py` accepts `window`, `scoring_mode`, `snapshot_id` |
| Topology client | Implemented | `frontend/src/api/gdcRuntimeTopology.ts` `fetchRuntimeTopology` (supports `snapshot_id`) |
| Nested HTML viz | Implemented, **unrouted** | `RuntimeTopologyPage` — nested cards + `PipelineArrow` icon; **does not pass `snapshot_id`**; not mounted in `App.tsx` |
| Live operator flow | Implemented without canvas | Routes `buildRouteFlowTree` / `RoutesFlowTreeTable` — Stream → Route / Destination with EPS, Success Rate, Health from snapshot |
| SPA routes | Redirect to dashboard | `App.tsx`: `/runtime/topology` and `/monitoring/topology` → `PreserveSearchRedirect` to dashboard; `nav-paths.ts` `legacyRuntimeRedirectTarget` same |
| xyflow / Dagre | Absent | No canvas, zoom/pan, or Dagre layout |

Product already visualizes One Stream → Many Routes → Many Destinations as a snapshot-backed grouped table. Backend topology JSON exists for a future view. Canonical 07 does not demand zoom/pan. Adding xyflow would be a **third** visualization (Route Flow + unrouted cards + canvas) and must never become metrics SoT.

**Not DELETE_FROM_WORKPLAN:** zoom/pan/tracing remain a real UX delta *if* product later wants a canvas. **Not STILL_REQUIRED:** ops completeness does not depend on it; `/runtime/topology` is intentionally dashboard-redirected. **Not PARTIAL for the OSS rec itself:** the React Flow canvas is fully absent; the *data* plane is already implemented.

If W13 is ever approved: lazy-load only; pass `snapshot_id`; `nodesDraggable`/`nodesConnectable` false; keep Route Flow as a11y fallback; pin published `@dagrejs/dagre` (not `-pre`); never import xyflow from dashboard / streams console / destinations.

#### TanStack Table — DEFER

| Surface | This branch | Table OSS? |
| --- | --- | --- |
| Streams | `streams-console.tsx` — custom filters, group KPI, snapshot join, fixed-row virtualization ≥ 50 | No |
| Destinations | `destinations-management-page.tsx` — custom `<table>`, pagination, search, cards; snapshot via `use-destinations-overview-data` | No |
| Routes | `routes-overview-page.tsx` — custom `opTable`, column toggle, virtualization ≥ 24, Route Flow nested table | No |
| Connector catalog | `connector-catalog-page.tsx` — **card grid** (not a table) | No |
| Connectors overview | `connectors-overview-page.tsx` — custom 11-column table, no virtualization | No |
| Operations | `operations-backup-page.tsx`, impact/promotion panels — forms, not grids | N/A |
| Governance lists | Unchanged from original audit (`opTable`) | No |

Tables already search/filter/page/expand with snapshot-derived cells. TanStack Table would be a headless state refactor, not an operational gap. Highest regression remains Streams Console. **Not STILL_REQUIRED.** **Not DELETE:** the rec is still valid as an optional consistency pass (W12). Do not start with Streams Console.

#### TanStack Virtual — ops lists KEEP in-repo; W3 DELETE

| Surface | This branch | Classification of *this* surface |
| --- | --- | --- |
| Streams flat table | `computeFixedRowVirtualRange` at ≥ 50 rows; tests `streams-console-virtual.test.tsx` | **ALREADY_IMPLEMENTED** (in-repo). Do not replace with TanStack. |
| Routes table | Virtualize at `ROUTES_VIRTUAL_SCROLL_THRESHOLD` (24); `routes-overview-virtualization.test.tsx` | **ALREADY_IMPLEMENTED** (in-repo). Keep. |
| Runtime stream grid | `virtualized-stream-grid.tsx` prefix-sum / mixed heights | **ALREADY_IMPLEMENTED** (custom). Replace only if later pain (**DEFER**). |
| Union Schema tree | `union-schema-tree.tsx` `buildSchemaTree` + recursive `SchemaTreeNodeRow`; no windowing; `MAX_PATHS = 500` | **Not a scheduled work item.** Do not add `@tanstack/react-virtual` (C10). Optional later flatten + `computeWindowedRange` is DEFER. |
| Mapping / sample JSON tree | `mapping-json-tree.tsx` recursive; no windowing | Same as schema tree — DEFER, not W3. |
| Connectors overview | Full table render; no virtualizer | Optional polish — not W3. |
| Connector catalog | Card grid; no virtualizer | Optional polish. |
| Recent events | `stream-recent-events-panel.tsx` cap 8 | **DEFER** (do not drop runtime visibility by raising cap without a window) |

History note (`docs/history/performance/runtime-ui-virtualization-phase-6_5.md`): `@tanstack/react-virtual` was already skipped once; in-repo fixed-size windowing shipped instead. That decision still holds for Streams/Routes/Runtime grids **and** is the reason W3 is **DELETE_FROM_WORKPLAN**, not an open P1.

**Do not keep W3 on the active workplan.** Flatten-and-TanStack-virtualize of Union Schema would dual-implement windowing. If expand-all jank is later measured, reuse `computeWindowedRange` — DEFER, no new work ID.

### Snapshot / graph SoT (must not regress)

- Dashboard, Streams, Routes, Destinations join **Operational Snapshot** for EPS, Success Rate, Checkpoint, Route Health, Delivery Health.
- `fetchRuntimeTopology` is a **configured-graph** read (`topology_service.get_runtime_topology`), optionally aligned with `snapshot_id`. Health on that payload is not a second metrics engine for the SPA KPI strips.
- Do not feed xyflow/Dagre node `data` from client-computed EPS. If a canvas is built later, bind node metrics from snapshot (or topology fields that already came from the same health snapshot).

### Short answers for the parent report

| Item | Classification | One-liner |
| --- | --- | --- |
| Topology canvas (xyflow + Dagre) | **DEFER** | Topology API + Route Flow table exist; canvas OSS absent; canonical 07 does not require a graph; keep W13 optional. |
| TanStack Table | **DEFER** | Custom snapshot-backed tables already operate; optional W12 only. |
| TanStack Virtual | **PARTIAL** | Ops lists already windowed in-repo; P1 gap remains on Union Schema / JSON trees and connector lists (W3). |
| Graph as metrics SoT | **DELETE_FROM_WORKPLAN** (never adopt) | Snapshot stays SoT. |
| Archify wholesale | **DELETE_FROM_WORKPLAN** | Still REJECT. |
| Replace custom Streams/Routes windowers with TanStack | **DELETE_FROM_WORKPLAN** | KEEP `computeWindowedRange` / `computeFixedRowVirtualRange`. |

---

**Original Agent 2 audit follows.** Repo path / HEAD in that body refer to the 2026-08-28 inspection (`/home/aella/gdc-platform`, `1f270e8`), not this reconcile branch. OSS clone tables and source-level xyflow/TanStack notes are unchanged and still valid as library evidence. Classifications in §1 / §14 / §16 are **superseded** by the reconciliation table above.

**Agent:** 2 — Operational UI / Data Visualization  
**Repo:** `/home/aella/gdc-platform`  
**Requested audit branch:** `feature/post-m29-development`  
**Workspace HEAD at audit time:** `1f270e8` (`fix/route-processing-ux-p0-1-classification-policy`)  
**Date:** 2026-08-28  
**Scope:** Audit only. No Data Relay source, tests, configs, Full Matrix / QA Lab, or production configuration were modified. This document is not an implementation plan to change Runtime behavior.

OSS clones (shallow, `/tmp/oss-audit-clones/`):

| OSS | Clone path | HEAD | Inspected date |
| --- | --- | --- | --- |
| xyflow / React Flow | `/tmp/oss-audit-clones/xyflow` | `b1b99e9` (2026-08-25) | 2026-08-28 |
| dagre (`@dagrejs/dagre`) | `/tmp/oss-audit-clones/dagre` | `32e7f30` (2026-08-08) | 2026-08-28 |
| Archify | `/tmp/oss-audit-clones/archify` | `12106be` (2026-08-28) | 2026-08-28 |
| TanStack Table | `/tmp/oss-audit-clones/table` | `3bfc1bf` (2026-08-26) | 2026-08-28 |
| TanStack Virtual | `/tmp/oss-audit-clones/virtual` | `e9874f0` (2026-08-18) | 2026-08-28 |

Architecture guardrails applied throughout:

- One Stream → Many Routes → Many Destinations.
- Route Processing: Transform → Protection → Classification → Policy → Delivery.
- Do not propose a new pipeline framework or parallel runtime.
- Operational pages must keep using Runtime Snapshot / Operational Snapshot.
- P0 operational metrics must remain visible: EPS, Success Rate, Checkpoint, Route Health, Delivery Health.

---

## 1. Executive recommendation

Data Relay already visualizes **Source → Stream → Route → Destination** as nested HTML (cards, grouped tables, KPI strips), not as an interactive graph. Runtime metrics already come from **Operational Snapshot** (`getOperationalSnapshot`) plus snapshot-id alignment helpers. That is the correct operational data path and must not be replaced by a graph library.

| OSS | Adoption | Priority | Why |
| --- | --- | --- | --- |
| `@xyflow/react` + `@dagrejs/dagre` | `DIRECT_DEPENDENCY` (optional topology canvas only) | **P2** | Real zoom/pan, custom nodes, route focus, upstream/downstream tracing. Consume snapshot/topology JSON; never become the metrics source. Prefer this pairing over Archify wholesale. |
| Archify wholesale | `REJECT` | **REJECT** | CLI that emits self-contained HTML from authored JSON-IR. Not a React 19 library. Not live runtime-state viz. Would be a parallel visualization product. |
| Archify reachability / route-probe UX | `REFERENCE_PATTERN` | **LATER** | Copy the *idea* of authored upstream/downstream BFS highlighting, not the HTML template runtime. |
| `@tanstack/react-virtual` | `DIRECT_DEPENDENCY` | **P1** | Union Schema trees, connector catalog/overview, and large sample/event trees have no variable-size virtualization today. |
| `@tanstack/react-table` | `DIRECT_DEPENDENCY` (headless only) | **P2** | Streams / Destinations / Routes / Governance / catalog lists already work as custom tables. Table v9 helps sorting/filtering/column state; do not replace snapshot-derived cells. |
| Existing `computeWindowedRange` / `computeFixedRowVirtualRange` | **KEEP** | — | Fixed-row Streams/Routes/Runtime grid virtualization already exists. Do not rip it out as a prerequisite. |

**Headline:** Do not adopt Archify as the operational graph. If a topology canvas is wanted, add React Flow + Dagre as a **view** over Operational Snapshot / `/runtime/topology`. Keep Recharts for timeseries. Keep custom tables until a table rewrite is justified. Use TanStack Virtual where trees and unbounded lists already fail to window.

---

## 2. Data Relay operational UI — current implementation (file / function)

### 2.1 Snapshot is the operational data plane

| Concern | File | Functions / types |
| --- | --- | --- |
| Snapshot fetch + 30s cache | `frontend/src/api/operationalSnapshot.ts` | `getOperationalSnapshot`, `clearOperationalSnapshotCache`, types `OperationalStreamSnapshot`, `OperationalRouteSnapshot`, `OperationalDestinationSnapshot` (EPS, success/failure rates, checkpoint lag, route counts, health) |
| Snapshot-id alignment | `frontend/src/api/runtimeSnapshotSync.ts` | `createRuntimeSnapshotId`, `createRefreshCycleSnapshotId` (15s cycle TTL), `snapshotMatches`, `allSnapshotsMatch` |
| Stabilized snapshot (avoid churn re-renders) | `frontend/src/lib/snapshot-stabilize.ts` | `stabilizeOperationalSnapshot`, field-equal helpers `streamSnapshotEqual` / `routeSnapshotEqual` |
| Shared runtime provider | `frontend/src/components/runtime/runtime-operational-provider.tsx` | `RuntimeOperationalProvider` — polls `getOperationalSnapshot`, publishes stabilized snapshot |
| KPI derivation | `frontend/src/lib/operational-snapshot-selectors.ts` | `selectGlobalKpi`, `selectRouteKpi`, `selectDestinationKpi`, `formatOperationalEps`, `formatOperationalSuccessRate` |
| Dashboard charter KPIs | `frontend/src/components/dashboard/dashboard-charter-metrics.ts` | `deriveDashboardKpisFromSnapshot`, `deriveSystemHealthFromSnapshot` (includes Checkpoint), Success Rate / Ingest Rate / Delivery Rate cards |
| Topology REST (separate from snapshot) | `frontend/src/api/gdcRuntimeTopology.ts` | `fetchRuntimeTopology` — supports `window`, `scoring_mode`, **`snapshot_id`** |
| Topology types | `frontend/src/api/types/gdcApi.ts` | `RuntimeTopologyResponse`, `TopologyStreamNode`, `TopologyRouteNode`, `TopologyDestinationNode` |

Operational Snapshot already encodes the graph edges needed for visualization:

- Stream: `connector_id`, `source_id`, `eps_1m`, `success_rate_5m`, `checkpoint_lag_seconds`, `healthy_route_count`, `failed_route_count`
- Route: `stream_id`, `destination_id`, `delivered_eps_1m`, `failed_eps_1m`, `success_rate_5m`
- Destination: `inbound_eps_1m`, `route_count`, health

That is sufficient to draw Source → Stream → Route → Destination **without a new API**, as long as connector/source labels are joined from catalog lists already loaded on dashboard/streams pages.

### 2.2 Dashboard

| File | Role |
| --- | --- |
| `frontend/src/components/dashboard/dashboard-overview.tsx` | Operations dashboard; uses `useDashboardOverviewData` |
| `frontend/src/components/dashboard/use-dashboard-overview-data.ts` | Loads **operational snapshot first**, then deferred dashboard summary / alerts / streams / connectors. 20s deadline. |
| `frontend/src/components/dashboard/dashboard-visual-panels.tsx` | Recharts timeseries (`EventsOverTimeChart`), health matrix, problems list |
| `frontend/src/components/dashboard/widgets/kpi-summary-widget.tsx` | KPI cards with Recharts mini line |
| `frontend/src/components/dashboard/widgets/pipeline-health-strip.tsx` | Stream health stacked bar (not a topology graph) |
| `frontend/src/components/dashboard/widgets/runtime-volume-widget.tsx` | Recharts volume |
| `frontend/src/components/dashboard/widgets/events-outcome-panel.tsx` | Recharts pie |
| `frontend/src/components/dashboard/widgets/operational-table-styles.ts` | Shared `opTable` / `opTh` / `opTd` used across ops tables |
| `frontend/src/components/dashboard/operations-tier-panels.tsx` | Secondary ops panels |
| `frontend/src/components/dashboard/operations-disclosure.tsx` | Disclosure chrome |

P0 metrics on dashboard: Ingest Rate, Delivery Rate, **Success Rate**, **Checkpoint** in `deriveSystemHealthFromSnapshot`, route/destination health via snapshot-derived strips. Charts are Recharts (`frontend/package.json`: `recharts ^3.8.1`), not graph libs.

### 2.3 Streams

| File | Role |
| --- | --- |
| `frontend/src/components/streams/streams-console.tsx` | Primary streams list. Uses `getOperationalSnapshot` + `createRefreshCycleSnapshotId`. Fixed-row virtualization at ≥50 rows via `computeFixedRowVirtualRange`. |
| `frontend/src/lib/fixed-row-virtual-window.ts` | `computeFixedRowVirtualRange` |
| `frontend/src/lib/windowed-virtual-range.ts` | `computeWindowedRange` (generic fixed-size window) |
| `frontend/src/hooks/use-virtual-window.ts` | React wrapper around `computeWindowedRange` |
| `frontend/src/components/streams/streams-group-kpi-strip.tsx` | Group KPI strip |
| `frontend/src/components/streams/stream-flow-timeline.tsx` | Horizontal **config** timeline (wizard/runtime stages), not live topology |
| `frontend/src/components/streams/stream-runtime-detail-page.tsx` | Per-stream runtime; Recharts; recent events |
| `frontend/src/components/streams/stream-recent-events-panel.tsx` | Caps recent logs at 8 rows — no virtualization |
| `frontend/src/components/streams/stream-issue-rail.tsx` / `stream-recent-issues-panel.tsx` | Issues rail |
| `frontend/src/components/streams/union-schema-tree.tsx` | Recursive tree, **no windowing** (`buildSchemaTree`, full render) |
| `frontend/src/components/streams/mapping-json-tree.tsx` | Recursive JSON tree for samples, **no windowing** |
| `frontend/src/components/streams/route-processing/route-processing-labels.ts` | Canonical concern order: Transform, Protection, Classification, Policy, Delivery |
| `frontend/src/components/streams/route-processing/route-processing-concern-row.tsx` | Per-concern status row |
| `frontend/src/components/streams/route-processing/route-processing-selected-route-summary.tsx` | Selected route processing summary |

Streams Console already virtualizes the **flat table** path; the product-group UI is the primary view. Union Schema and mapping sample trees are unbounded DOM.

### 2.4 Routes

| File | Role |
| --- | --- |
| `frontend/src/components/routes/routes-overview-page.tsx` | Routes ops page: snapshot + `fetchRoutesList`. Virtualizes rows at `ROUTES_VIRTUAL_SCROLL_THRESHOLD` (24). |
| `frontend/src/components/routes/routes-flow-helpers.ts` | `buildRouteFlowTree` groups snapshot routes by stream; `buildProblemRoutes`; `buildDestinationRouteMetrics` |
| `frontend/src/components/routes/routes-flow-tree-table.tsx` | **Route Flow** nested table: Stream → Route / Destination with EPS, Success Rate, Error Rate, Health |
| `frontend/src/components/routes/routes-table-row.tsx` | Row renderer; `ROUTES_TABLE_ROW_HEIGHT`, `ROUTES_VIRTUAL_SCROLL_THRESHOLD = 24` |
| `frontend/src/components/routes/routes-overview-helpers.ts` | `buildRouteRowsFromOperationalSnapshot`, `RouteConsoleRow` |
| `frontend/src/components/routes/routes-problem-routes-panel.tsx` | Problem routes |
| `frontend/src/components/routes/routes-destination-metrics-panel.tsx` | Destination aggregates from snapshot |
| `frontend/src/components/routes/route-edit-page.tsx` | Route editor (processing persist tests exist) |

This is the closest current visualization of One Stream → Many Routes → Many Destinations. It is a **grouped HTML table**, not a canvas. No zoom/pan, no geometric tracing.

### 2.5 Destinations

| File | Role |
| --- | --- |
| `frontend/src/components/destinations/destinations-management-page.tsx` | List + card views, custom `<table>`, pagination, search. No TanStack, no virtualizer. |
| `frontend/src/components/destinations/use-destinations-overview-data.ts` | Catalog list + `getOperationalSnapshot` + destination health |
| `frontend/src/components/destinations/destination-runtime-metrics.ts` | Joins snapshot to list rows |
| `frontend/src/components/destinations/destination-kpi-strip.tsx` | Destination KPIs |
| `frontend/src/components/destinations/destination-card-view.tsx` | Card grid |
| `frontend/src/components/destinations/destination-mini-charts.tsx` | SVG donut / gauges (not Recharts graph) |
| `frontend/src/components/destinations/destination-operational-health-panel.tsx` | Health panel |

### 2.6 Runtime topology (implemented, currently unrouted)

| File | Role |
| --- | --- |
| `frontend/src/components/runtime/runtime-topology-page.tsx` | `RuntimeTopologyPage`: nested cards Connector → Source → Stream → Route → Destination. `PipelineArrow` is an icon, not a graph. `fetchRuntimeTopology` **does not pass `snapshot_id`**. |
| `frontend/src/App.tsx` | `/runtime/topology` and `/monitoring/topology` **redirect to dashboard** (`PreserveSearchRedirect to={NAV_PATH.dashboard}`) |
| `frontend/src/config/nav-paths.ts` | `topology: '/monitoring/topology'` still named, but `legacyRuntimeRedirectTarget` sends `/runtime/topology` to monitoring/dashboard |
| `frontend/src/components/runtime/virtualized-stream-grid.tsx` | Variable-height custom virtualization for stream cards (`buildStreamVirtualItems`) |
| `frontend/src/components/runtime/runtime-overview-page.tsx` / `runtime-overview-sections.tsx` | Runtime overview; Recharts; uses snapshot provider |
| `frontend/src/components/runtime/runtime-health-section.tsx` | Health tables for routes/streams/destinations (`opTable`) |
| `frontend/src/components/runtime/runtime-analytics-page.tsx` | Analytics; `createRuntimeSnapshotId` + `allSnapshotsMatch` |

**Gap:** A topology page exists and has tests (`runtime-topology-page.test.tsx`) but is not in the live route table. Operators currently see flow as Routes “Route Flow” table + dashboard KPIs, not a graph.

### 2.7 Operations, Marketplace, Issues, Governance lists

| Area | File | List style | Snapshot? |
| --- | --- | --- | --- |
| Backup / import (not viz) | `frontend/src/components/operations/operations-backup-page.tsx` | Forms, not a data grid | N/A |
| Connector “marketplace” / catalog | `frontend/src/components/administration/connector-catalog-page.tsx` | Custom table of registry packages | Completeness badges, not EPS |
| Connectors overview | `frontend/src/components/connectors/connectors-overview-page.tsx` | Custom 11-column table, **no virtualization** | Operational health via `useConnectorsOverviewData` |
| Governance issues counts | `frontend/src/components/governance/governance-operational-issues.ts` | `deriveGovernanceOperationalIssues(health, dashboard, streams, snapshot)` | Yes |
| Policy catalog | `frontend/src/components/governance/policy-catalog-page.tsx` | `opTable` | Policy APIs |
| Violations | `frontend/src/components/governance/violation-center-page.tsx` | `opTable` | Mixed |
| Approvals / audit / workspace | `governance/approval-workflow-page.tsx`, `audit-trail-page.tsx`, `governance-workspace-page.tsx` | `opTable` | Mixed |
| Stream issues | `stream-issue-rail.tsx`, `stream-recent-issues-panel.tsx` | Small lists | Snapshot-derived causes |

There is **no component named Marketplace**. The catalog analogue is Connector Catalog + Connectors Overview.

### 2.8 Charts already in stack

`frontend/package.json` dependencies: React `^19.0.0`, Vite, Tailwind 3.4, Recharts `^3.8.1`. No xyflow, dagre, TanStack Table, or TanStack Virtual.

Recharts is used for **time series / pies**, not topology. Graph OSS would be additive, not a Recharts replacement.

### 2.9 Custom virtualization inventory

| Mechanism | Files | Limitation |
| --- | --- | --- |
| Fixed row height window | `windowed-virtual-range.ts`, `use-virtual-window.ts`, `fixed-row-virtual-window.ts` | Assumes constant `itemSize`; O(n) scan in `computeFixedRowVirtualRange` |
| Streams console | `streams-console.tsx` (`STREAMS_CONSOLE_VIRTUALIZE_MIN = 50`) | Flat table only |
| Routes overview | `routes-overview-page.tsx` (≥ 24 rows) | Fixed `ROUTES_TABLE_ROW_HEIGHT` |
| Runtime stream grid | `virtualized-stream-grid.tsx` | Custom prefix-sum for mixed header/card heights |
| Union Schema tree | `union-schema-tree.tsx` | **None** — recursive `<ul>` |
| Mapping / sample JSON tree | `mapping-json-tree.tsx` | **None** |
| Connector lists | `connectors-overview-page.tsx`, `connector-catalog-page.tsx` | **None** |
| Recent events | `stream-recent-events-panel.tsx` | Hard cap 8, not virtualized |

---

## 3. Can Source → Stream → Route → Destination be visualized?

**Yes, as data. Partially, as UI. Not yet as an interactive graph.**

### 3.1 Data is already a DAG

Join keys exist on Operational Snapshot and on `RuntimeTopologyResponse`:

```
Connector → Source (topology.sources.connector_id)
Source → Stream (topology.streams.source_id / snapshot.streams.source_id)
Stream → Route (snapshot.routes.stream_id)
Route → Destination (snapshot.routes.destination_id)
```

Fan-out is already first-class: one stream, many routes, many destinations. Route Processing stages are **not extra graph nodes in snapshot**; they are configuration status on the route (`route-processing-concern-row.tsx`). A canvas should show processing as **badges on the route node/edge**, not as a second pipeline runtime.

### 3.2 What the UI does today

1. **Routes → Route Flow table** (`RoutesFlowTreeTable` + `buildRouteFlowTree`): Stream parent rows, destination child rows, EPS / Success Rate / Health. Best current “topology”.
2. **RuntimeTopologyPage**: Nested cards with arrows; health badges; links to destination/logs/analytics. Unrouted.
3. **Stream flow timeline**: Wizard/config completeness, not live EPS.
4. **Dashboard / Streams / Destinations**: KPI + tables, not a graph.

### 3.3 What is missing for a graph product surface

| Capability | Today | Needed for canvas |
| --- | --- | --- |
| Topology rendering | Nested cards/tables | Node/edge renderer |
| Zoom / pan | Browser scroll only | Viewport transform |
| Node selection | Row click / links | Graph selection + detail drawer |
| Route focus | Filters on Routes page | Highlight one route path |
| Upstream / downstream tracing | Manual navigation | Neighbor walk (`getIncomers` / `getOutgoers` or snapshot join) |
| Auto layout | CSS flex / table | Layered layout (`rankdir: 'LR'`) |
| Large graph performance | HTML virtualization on lists | Viewport culling (`onlyRenderVisibleElements`) |
| Runtime state on nodes | Snapshot fields in table cells | Custom nodes reading snapshot (EPS, health) |
| Snapshot alignment | Dashboard/streams/routes | Topology page currently omits `snapshot_id` |

### 3.4 Architecture-safe visualization rule

A graph may **project** snapshot + catalog entities. It must not:

- compute EPS / success / checkpoint independently,
- introduce a second runtime,
- flatten routes into duplicated streams,
- hide P0 metrics behind zoom.

---

## 4. OSS inspection (source, not README)

### 4.1 xyflow / `@xyflow/react` (React Flow)

**Identity**

- Monorepo `@xyflow/monorepo`, packages `react`, `system`, `svelte`.
- Inspected package: `packages/react/package.json` — name `@xyflow/react`, version **12.11.5**, license **MIT**.
- Peer deps: `react >= 17`, `react-dom >= 17` (covers React 19). Dev/examples still pin `react ^18.2.0`.
- Runtime deps: `@xyflow/system`, `classcat`, **`zustand ^4.4.0`**.
- System deps: `d3-zoom`, `d3-drag`, `d3-selection`, `d3-interpolate`.
- Security: `SECURITY.md` — `@xyflow/react` 12.x fully supported. Last clone commit 2026-08-25 (active).

**Core APIs / files (actually read)**

| Capability | File | Symbol |
| --- | --- | --- |
| Canvas | `packages/react/src/container/ReactFlow/index.tsx` | default `ReactFlow` |
| Public exports | `packages/react/src/index.ts` | `ReactFlow`, `ReactFlowProvider`, `Handle`, edges, `useReactFlow`, `useNodesState`, `useEdgesState`, `MiniMap`, `Controls`, `Background` |
| Zoom/pan | `packages/react/src/container/ZoomPane/index.tsx` | `XYPanZoom` from `@xyflow/system`; props `zoomOnScroll`, `panOnDrag`, `minZoom`, `maxZoom` |
| Custom nodes | `packages/react/src/types/component-props.ts` | `nodeTypes`; default nodes in `components/Nodes/*` |
| Selection | `component-props.ts` | `elementsSelectable`, `onSelectionChange`, `useOnSelectionChange` |
| Viewport culling | `component-props.ts` + `NodeRenderer` | `onlyRenderVisibleElements` (default false) |
| Keyboard a11y | `component-props.ts` | `nodesFocusable`, `edgesFocusable` (default true), `disableKeyboardA11y`, `autoPanOnNodeFocus` |
| Screen reader | `packages/react/src/components/A11yDescriptions/index.tsx` | `A11yDescriptions`, `aria-live` |
| Tracing | `packages/system/src/utils/graph.ts` | `getOutgoers`, `getIncomers` |
| MiniMap / Controls | `packages/react/src/additional-components/` | `MiniMap`, `Controls`, `Background`, `NodeToolbar` |

**Layout:** React Flow does **not** bundle Dagre. Official example `examples/react/src/examples/Layouting/index.tsx` imports **`dagre` 0.8.5** (legacy npm name) and calls `dagreGraph.setGraph({ rankdir })`, `setNode`, `setEdge`, `dagre.layout`, then writes `node.position`. Data Relay should use **`@dagrejs/dagre`** (maintained), not the example’s old `dagre@0.8.5`.

**Bundle impact**

- Source: ~860KB `packages/react/src` + ~380KB `packages/system/src` (unbuilt).
- Transitive: zustand + d3-zoom/drag.
- Expect a **large** client chunk vs current frontend (which has no graph lib). Must lazy-load (`React.lazy`) on a topology route only. Do not import from dashboard/streams console.

**React 19:** Peer range includes 19. No “React 19” mention in repo grep. Zustand 4 is commonly used with React 19. Residual risk: examples are React 18; verify in Data Relay Vite + React 19 before merge. Not a license or architecture blocker.

**A11y / mobile**

- Keyboard node/edge focus exists; canvas still weaker than HTML tables for screen readers.
- Touch: pan/zoom via d3; product should keep a **table fallback** (existing Route Flow) for a11y and small screens.
- Archify’s own research notes React Flow MiniMap / fitView / edge a11y as reference — Archify did not wrap xyflow as a React dependency.

**Fit to Data Relay:** Custom nodes can render EPS, Success Rate, health, checkpoint lag from snapshot fields. `nodesDraggable` / `nodesConnectable` should be **false** for ops topology (view, not editor). `getIncomers`/`getOutgoers` implement route focus and tracing.

---

### 4.2 `@dagrejs/dagre`

**Identity**

- `package.json`: name `@dagrejs/dagre`, version **3.1.2-pre**, license **MIT** (Chris Pettitt 2012–2014; LEGAL.txt in dist repeats MIT).
- Dependency: `@dagrejs/graphlib` **4.0.5** (no React).
- Main: `dist/dagre.esm.js` **48KB** uncompressed; `dist/dagre.cjs` **36KB**. Acceptable.
- No peerDependencies. Fine with React 19 (layout is pure JS).
- Maintenance: commit 2026-08-08 “Bump version and set as pre-release” — **do not pin the `-pre` git clone in production**; use a published stable 1.x/2.x/3.x tag when implementing.

**Core APIs / files**

| File | Symbol |
| --- | --- |
| `index.ts` | `layout`, `Graph`, `graphlib`, `version` |
| `lib/layout.ts` | `layout(g, opts)` — rank, order, position; cluster/`rankdir` recursion |
| `lib/types.ts` | `NodeLabel` (`width`, `height`, `x`, `y`, `rankdir`), `LayoutOptions` |

**Fit:** Layered LR layout for Connector/Source/Stream/Route/Destination ranks. Compound graphs can group routes under a stream. Not a renderer. Not a data source.

**Do not** treat Dagre coordinates as operational truth. Re-run layout when snapshot membership changes (stream/route add/remove), not on every EPS tick (stabilize via `stabilizeOperationalSnapshot`).

---

### 4.3 Archify (`tt-a1i/archify`)

**Identity**

- `archify/package.json`: name `archify`, version `2.16.0-dev.0`, **`private: true`**, `bin: archify`, Node `>=18`, license **MIT** (2026 tt-a1i + 2025 Cocoon AI).
- **No React peer, no React renderer package.** Dev deps: ajv, parse5, saxes, simple-icons.
- Product: JSON-IR → **self-contained HTML/SVG** via Node CLI renderers.
- Active (clone HEAD same day as audit). Desktop-first (`PRODUCT.md`: “Desktop is the primary product surface”).

**Core files (read)**

| File | Role |
| --- | --- |
| `archify/renderers/workflow/render-workflow.mjs` | Lane/column layout constants; SVG generation; **authored** `node.col` / `node.lane` |
| `archify/renderers/dataflow/README.md` + `render-dataflow.mjs` | `diagram_type: "dataflow"`; stages/nodes/flows; schema `dataflow.schema.json` |
| `archify/renderers/shared/geometry.mjs` | Pure geometry (`rectsOverlap`, `polylinePath`, `automaticPortSpread`) |
| `archify/test/authored-reachability.test.mjs` | Upstream/downstream BFS on **authored relationships** |
| `DESIGN.md` / `PRODUCT.md` | Evidence console; anti-dashboard; viewer state outside canonical export |

**Not a React Flow competitor in-process.** Wholesale adoption would mean: generate HTML artifacts offline, or iframe an HTML report. That is not an operational console that refreshes snapshot every 10–30s.

**Dataflow IR vs Data Relay:** Archify dataflow uses authored `stages`, `nodes`, `flows`, `viewBox`. Data Relay topology is **live entity IDs + metrics**. Mapping snapshot → Archify JSON on every poll would fight Archify’s “deterministic portable proof” model and still would not yield React components inside Vite.

**Reachability:** `reachabilityFor` / Route Probe is a **pattern** (BFS on directed edges, upstream button). React Flow already has `getIncomers`/`getOutgoers` for the same job inside React.

**Bundle:** `archify/` tree ~6.8MB including tests/assets. Not tree-shakeable into the SPA.

**Adoption:** `REJECT` as dependency or vendored renderer. `REFERENCE_PATTERN` for highlighting language and maybe SVG geometry hygiene. `HARVESTER_SOURCE` / `TEST_CORPUS`: not applicable.

---

### 4.4 TanStack Table (`@tanstack/react-table` v9)

**Identity**

- Packages: `table-core` **9.2.3**, `react-table` **9.2.3**, MIT (Tanner Linsley).
- Peer: **`react >= 18`**. DevDependencies use **React 19.2.8** — first-class React 19 in this clone.
- Engines: `node >= 20` (table-core / react-table). Data Relay frontend already targets modern Node.
- Deps: `@tanstack/table-core`, `@tanstack/react-store`, `@tanstack/store`.
- Headless: **no DOM table**. You keep `opTable` markup.
- v9 rewrite: `constructTable` (`packages/table-core/src/core/table/constructTable.ts`), `useTable` (`packages/react-table/src/useTable.ts`), `createTableHook`. Legacy v8 API: `packages/react-table/src/legacy.ts` → `useLegacyTable`.
- Features exported from `table-core/src/index.ts`: filtering, sorting, grouping, pagination, column ordering/pinning/visibility, row selection, expanding, faceting, aggregation, virtual-friendly row models.
- Maintenance: commit 2026-08-26 version packages. Mature org.

**Bundle:** Headless core is moderate; still extra store runtime. Smaller than xyflow. Fine if limited to large consoles.

**Fit vs current tables**

Data Relay already implements, per page: search, filters, column toggle (Routes `showRateLimitCol`), pagination (Routes `page`/`pageSize`, Destinations pager), expand (connectors, route flow), problem-first sort (`sortStreamsProblemFirst`).

**Gap Table would close:** consistent column defs, client sort on EPS/success, column visibility persistence, expandable rows without one-off state, easier pairing with TanStack Virtual.

**Gap Table must not close:** snapshot derivation, health badges, run controls, routing to stream/route edit. Those stay in cell renderers.

**v9 vs v8:** Implementing against v9 `useTable` is the clone-accurate path. If implementation later prefers the widely documented v8 `useReactTable`, that is a version pin decision — both MIT. This audit evaluated **v9 source**.

---

### 4.5 TanStack Virtual (`@tanstack/react-virtual`)

**Identity**

- `packages/react-virtual/package.json`: **3.14.10**, MIT.
- Peer: `react` and `react-dom` **`^16.8 \|\| ^17 \|\| ^18 \|\| ^19`** — explicit React 19.
- Core: `packages/virtual-core/src/index.ts` (~2111 lines) — `Virtualizer`, `VirtualItem`, `getVirtualItems`, variable size, lanes (grid), `measureElement`, iOS momentum guards, `observeElementRect`.
- React: `useVirtualizer`, `useWindowVirtualizer`, optional `directDomUpdates` / `flushSync`.
- Maintenance: 2026-08-18 version bump. Small, focused.

**Vs Data Relay custom windowing**

| | Custom `computeWindowedRange` | TanStack Virtual |
| --- | --- | --- |
| Fixed row height tables | Sufficient (Streams, Routes) | Optional later |
| Variable height (Union Schema, JSON tree, mixed stream cards) | Hand-rolled prefix sums (`virtualized-stream-grid.tsx`) | Native `estimateSize` + `measureElement` |
| Dynamic measure after expand | Missing on schema trees | Supported |
| Sticky headers / nested scroll | Manual | Documented patterns |
| Bundle | Zero extra | Small (core + react wrapper) |

**Fit:** P1 for Union Schema tree flattening (visible rows only), connector overview (100s of packages), wizard sample JSON, and optionally replacing `virtualized-stream-grid` custom math. Do **not** block P0 metrics on this.

---

## 5. React Flow + Dagre vs Archify wholesale

| Criterion | React Flow + Dagre | Archify wholesale |
| --- | --- | --- |
| Topology rendering | React nodes/edges in Vite SPA | Offline HTML/SVG artifact |
| Zoom / pan | `ZoomPane` / `XYPanZoom` | Viewer chrome in generated HTML (desktop) |
| Node selection | First-class React state | Viewer focus in artifact; not app router |
| Route focus | Selection + `fitView({ nodes })` | Route Journey / Route Probe in HTML |
| Upstream / downstream | `getIncomers` / `getOutgoers` | Authored BFS in template JS |
| Auto layout | Dagre `layout` + `rankdir: 'LR'` | Authored col/lane or grid; **explicitly killed Mermaid/dagre auto-layout** in `experiments/v3-mermaid-validation/RESULT.md` |
| Large graph | `onlyRenderVisibleElements` | Not an SPA virtualizer; large diagrams are authored |
| Runtime state viz | Custom nodes bound to snapshot | Static IR; motion must not imply unaired activity (`PRODUCT.md`) |
| a11y | Keyboard focus + aria-live; still canvas | Documented, but separate product surface |
| Mobile | Usable with pinch-zoom; keep table fallback | “Containment, not a second interface” |
| Bundle | Lazy `@xyflow/react` + `@dagrejs/dagre` | Whole CLI/renderer (~MB) or iframe |
| Custom nodes | `nodeTypes` React components | SVG templates / brand marks |
| React 19 | Peer `>=17` | N/A (Node CLI) |
| Architecture risk | Low if view-only | **High** — parallel viz product, not ops console |
| License | MIT + MIT | MIT |

**Decision:** React Flow + Dagre for any in-app topology. Archify wholesale **REJECT**. Optional later: generate Archify HTML **exports** for architecture docs (out of operational UI scope).

---

## 6. Capability matrix (requested review items)

| Item | Data Relay now | React Flow | Dagre | Archify | Table | Virtual |
| --- | --- | --- | --- | --- | --- | --- |
| Topology rendering | Nested cards + Route Flow table | Yes | Layout only | HTML export | No | No |
| Zoom / pan | Page scroll | Yes | No | Artifact viewer | No | Scroll lists |
| Node selection | Row/card click | Yes | No | Artifact focus | Row selection feature | Index in view |
| Route focus | Filters + expand | Yes | No | Route Probe (HTML) | Filter/expand | No |
| Upstream / downstream tracing | Manual links | `getIncomers`/`getOutgoers` | No | Authored BFS | No | No |
| Auto layout | CSS | Via Dagre example pattern | `layout()` | Authored positions | No | No |
| Large graph / list perf | Fixed-row virtualization | Viewport culling | CPU layout cost | N/A | Row model + Virtual | Yes |
| a11y | Strong on tables | Medium (keyboard canvas) | N/A | Documented in product | You own markup | You own markup |
| Mobile | Tables wrap / scroll-x | Pinch canvas | N/A | Desktop-first | Horizontal scroll | Touch scroll |
| Bundle | Recharts already | **High** — lazy only | Low (~48KB ESM) | Very high if bundled | Medium | Low |
| Custom nodes | Custom React cards | Yes | N/A | SVG IR | Custom cells | Custom rows |
| Runtime state viz | Snapshot cells | Custom node `data` from snapshot | No | Conflicts with “truth before spectacle” | Custom cells | N/A |

---

## 7. TanStack Table candidate pages

| Candidate | Current file | Snapshot-backed cells? | Recommend Table? | Notes |
| --- | --- | --- | --- | --- |
| Streams | `streams-console.tsx` | Yes (`getOperationalSnapshot`) | P2 | Already filters, group KPI, virtualization. Highest regression risk (run controls, lab EPS visibility). |
| Destinations | `destinations-management-page.tsx` | Yes | P2 | Pagination + cards already. Good first table if starting small. |
| Marketplace (catalog) | `connector-catalog-page.tsx` | Completeness, not runtime | P2 | CompletenessBadge must stay. |
| Connectors overview | `connectors-overview-page.tsx` | Operational health | P2 + Virtual P1 | No virtualization today; more urgent than Table. |
| Routes | `routes-overview-page.tsx` | Yes | P2 | Column menu + virtualization exist. Keep Route Flow nested table or model as expanded rows. |
| Issues | `stream-issue-rail.tsx`, `governance-operational-issues.ts`, dashboard problems | Derived from snapshot | LATER | Small N; Table overhead not justified. |
| Governance lists | `policy-catalog-page.tsx`, `violation-center-page.tsx`, `approval-workflow-page.tsx`, `audit-trail-page.tsx`, `governance-workspace-page.tsx` | Mixed | P2 | Shared `opTable` styling; headless Table can keep those class names. |

**Do not** put mapping builder (`mapping-builder-table.tsx`) on the first Table migration — it is an editor, not an ops list.

---

## 8. TanStack Virtual candidate surfaces

| Candidate | Current | Priority | How |
| --- | --- | --- | --- |
| Union Schema tree | `union-schema-tree.tsx` recursive DOM | **P1** | Flatten visible nodes; `useVirtualizer` + expand state |
| Mapping / sample JSON | `mapping-json-tree.tsx` | **P1** | Same; 10–20+ sample events can explode trees |
| Large connector lists | `connectors-overview-page.tsx`, `connector-catalog-page.tsx` | **P1** | Window rows; keep health cells |
| Large event samples | `stream-recent-events-panel.tsx` (cap 8); wizard preview | **P2** | Virtualize when raising cap; do not drop runtime visibility |
| Streams/Routes tables | Already windowed | **LATER** | Replace custom window only if bugs appear (variable row height, sticky columns) |
| Runtime stream grid | Custom prefix sums | **P2** | `useVirtualizer` would simplify `virtualized-stream-grid.tsx` |

---

## 9. Fifteen audit questions (file / function level)

Answered per OSS. Shared Q1/Q2 (Data Relay) is section 2.

### A. React Flow (`@xyflow/react`)

1. **Where is the function in Data Relay?** Topology: `RuntimeTopologyPage` in `runtime-topology-page.tsx` (unrouted). Flow table: `RoutesFlowTreeTable` / `buildRouteFlowTree`. Dashboard does not draw a graph.
2. **Structure and limits?** Nested HTML; no zoom/pan/tracing; topology omits `snapshot_id`; routes `/runtime/topology` redirect in `App.tsx`.
3. **OSS modules?** `ReactFlow`, `useReactFlow`, `nodeTypes`, `onlyRenderVisibleElements`, `getIncomers`/`getOutgoers`, `MiniMap`, `Controls`, `ZoomPane`.
4. **What improves?** Interactive topology without inventing a renderer; custom nodes for snapshot metrics.
5. **Duplication?** Card layout, PipelineArrow, Route Flow table, stream grid. Keep tables as source of truth for a11y; graph is optional view.
6. **Dependency?** Yes, **lazy** `DIRECT_DEPENDENCY` if product wants a canvas.
7. **Source adaptation?** No fork. Small adapter: snapshot/topology JSON → `{ nodes, edges }`.
8. **Pattern only?** Insufficient if a canvas is required; examples’ layout loop is the pattern to copy.
9. **Harvester?** No.
10. **License?** MIT (root `LICENSE`, package `license: MIT`). NOTICE: retain copyright.
11. **Architecture?** Safe if view-only, nodesConnectable/draggable off, snapshot-driven `data`, no parallel runtime.
12. **Integration points?** New lazy page or restore `RuntimeTopologyPage`; mapper next to `gdcRuntimeTopology.ts` / `buildRouteFlowTree`; pass `snapshot_id` into `fetchRuntimeTopology`. **Do not** wire xyflow into `useDashboardOverviewData`.
13. **Do not apply:** Graph as metrics engine; replacing Route Flow table; importing on every ops page; using xyflow as a stream editor that writes runtime.
14. **Difficulty / regression?** Medium–high UI. Risk: dashboard perf if not lazy; a11y; snapshot desync; hiding P0 metrics in tiny nodes. Runtime behavior unchanged if read-only.
15. **Priority?** **P2**.

### B. Dagre (`@dagrejs/dagre`)

1. **Data Relay?** No layout engine. Positions are CSS.
2. **Limits?** Manual nesting does not scale for dense fan-out diagrams.
3. **OSS?** `layout()` in `lib/layout.ts`; `Graph` from `graphlib`.
4. **Improves?** LR layered layout for Connector/Source/Stream/Route/Destination.
5. **Duplication?** None functionally; overlaps Archify’s abandoned dagre path (do not use Archify’s conclusion against Dagre-in-React-Flow).
6. **Dependency?** Yes, alongside React Flow only.
7. **Adaptation?** Adapter function `layoutOperationalGraph(nodes, edges)` wrapping `layout`.
8. **Pattern?** The xyflow `Layouting/index.tsx` loop is the integration pattern; use `@dagrejs/dagre` not `dagre@0.8.5`.
9. **Harvester?** No.
10. **License?** MIT (root + `dist/*.LEGAL.txt`). graphlib MIT via dependency.
11. **Architecture?** Layout-only; no runtime.
12. **Connect?** Same topology adapter as React Flow. Re-layout on topology membership change, not every EPS poll (`stabilizeOperationalSnapshot`).
13. **Do not apply:** Dagre as clustering “stream duplicates”; pinning `-pre` git version; layout on 10s metric ticks.
14. **Difficulty?** Low–medium. Risk: overlapping nodes if widths wrong; performance on very large graphs (layout is CPU).
15. **Priority?** **P2** (tied to React Flow).

### C. Archify

1. **Data Relay?** No equivalent HTML-IR pipeline. Closest UX: topology cards + Route Flow.
2. **Limits?** Live ops need refresh + snapshot, not static artifacts.
3. **OSS?** `render-dataflow.mjs`, `render-workflow.mjs`, `geometry.mjs`, authored reachability tests.
4. **Improves?** Documentation-quality diagrams; reachability UX vocabulary.
5. **Duplication?** Would duplicate topology page and fight SPA shell (`app-shell-layout.tsx`).
6. **Dependency?** **No.**
7. **Adaptation?** Do not vendor `render-*.mjs` into frontend.
8. **Pattern?** Yes — upstream/downstream highlight, “do not animate fake traffic”.
9. **Harvester?** No.
10. **License?** MIT, but **private** package — not a normal npm library for the SPA.
11. **Architecture?** Wholesale adoption **violates** “no parallel visualization/runtime product” and operational snapshot rule if treated as live ops UI.
12. **Connect?** None in app. Optional future: docs export job (out of this audit’s implement-now scope).
13. **Do not apply:** iframe ops console; replacing snapshot; using dataflow IR as Data Relay architecture; bundling CLI into Vite.
14. **Difficulty?** High integration for near-zero ops benefit.
15. **Priority?** **REJECT** wholesale; **LATER** reference-only.

### D. TanStack Table v9

1. **Data Relay?** Many `opTable` / raw `<table>` implementations listed in §2 and §7.
2. **Limits?** One-off sort/filter/page/column state; no shared column def type; Destinations/Connectors/Catalog not virtualized.
3. **OSS?** `useTable`, `constructTable`, `FlexRender`, feature modules (sort/filter/paginate/expand/visibility).
4. **Improves?** Consistent grid behavior; easier Virtual pairing; less bespoke state.
5. **Duplication?** Replaces *state* of tables, not snapshot selectors or badges.
6. **Dependency?** Optional `DIRECT_DEPENDENCY`.
7. **Adaptation?** Cell renderers stay Data Relay components (`RoutesTableRow`, health badges).
8. **Pattern?** Headless column defs — even without the lib, but the lib is the durable version.
9. **Harvester?** No.
10. **License?** MIT.
11. **Architecture?** Safe. Must not hide EPS/Success Rate columns.
12. **Connect?** Start Destinations or Connector Catalog — **not** Streams Console first (highest regression: run control, lab streams, virtualization tests `streams-console-virtual.test.tsx`).
13. **Do not apply:** Replacing `buildRouteRowsFromOperationalSnapshot`; mapping editor; forcing Table on 8-row issue rails.
14. **Difficulty?** Medium per page; Streams Console **high** regression.
15. **Priority?** **P2** (after Virtual on connector lists if both happen).

### E. TanStack Virtual

1. **Data Relay?** `computeWindowedRange`, `computeFixedRowVirtualRange`, `VirtualizedStreamGrid`, Streams/Routes windows. **Not** on Union Schema / JSON trees / connector tables.
2. **Limits?** Fixed height assumption; schema trees unbounded; `computeFixedRowVirtualRange` is O(n) per scroll.
3. **OSS?** `useVirtualizer`, `Virtualizer.getVirtualItems()`, `measureElement`, lanes.
4. **Improves?** Variable-size trees and long connector lists without dropping rows.
5. **Duplication?** Overlaps custom window helpers — keep helpers until a page migrates.
6. **Dependency?** Yes, **P1** for trees/lists that lack windowing.
7. **Adaptation?** Flatten `SchemaTreeNode` to a list; do not rewrite `unionSchema` inference.
8. **Pattern?** Overscan + spacer divs already exist; Virtual is the robust form.
9. **Harvester?** No.
10. **License?** MIT.
11. **Architecture?** Safe. Must not virtualize away P0 KPI strips (those are small).
12. **Connect?** `union-schema-tree.tsx`, `mapping-json-tree.tsx`, `connectors-overview-page.tsx`. Tests: `union-schema-tree.test.tsx`, `streams-console-virtual.test.tsx` (do not weaken).
13. **Do not apply:** Virtualizing dashboard KPI cards; removing DEV VALIDATION stream rows from the window incorrectly (windowing must still include them when filtered in).
14. **Difficulty?** Medium for trees (flatten + expand); low for flat connector tables.
15. **Priority?** **P1**.

---

## 10. Adoption matrix (Agent 9 columns)

| Area | Data Relay file / module | Current implementation | OSS | OSS file / module | Gap | Reusable part | Adoption method | License | Architecture risk | Integration difficulty | Expected benefit | Priority | Recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Topology canvas | `runtime-topology-page.tsx`, `gdcRuntimeTopology.ts`, `App.tsx` redirects | Nested cards; route unmounted | `@xyflow/react` | `ReactFlow`, `useReactFlow`, `getIncomers`/`getOutgoers`, `onlyRenderVisibleElements` | No interactive graph; topology not in nav | Custom nodes from snapshot fields | `DIRECT_DEPENDENCY` (lazy) | MIT | Low if view-only | Medium | Route focus, pan/zoom | P2 | Optional canvas over snapshot |
| Topology layout | Same | CSS flex | `@dagrejs/dagre` | `layout()`, `Graph` | No auto LR layout | rankdir LR ranks | `DIRECT_DEPENDENCY` | MIT | None (layout) | Low | Readable fan-out | P2 | Pair with React Flow |
| Topology wholesale HTML | N/A | SPA | Archify | `render-dataflow.mjs`, workflow renderer | Not a React lib; not live snapshot | Reachability BFS idea | `REJECT` | MIT | **High** (parallel product) | High | None for ops UI | REJECT | Do not adopt |
| Reachability UX | Route Flow table | Manual | Archify tests `authored-reachability.test.mjs` | BFS upstream/downstream | No one-click trace | Algorithm idea | `REFERENCE_PATTERN` | MIT | None | Low | Highlight path | LATER | Implement with xyflow utils or snapshot joins |
| Streams table state | `streams-console.tsx` | Custom filters + virtualization | `@tanstack/react-table` | `useTable`, features | Inconsistent grid APIs | Cell renderers, snapshot join | `DIRECT_DEPENDENCY` | MIT | Low | **High** regression | Consistency | P2 | Not first migration |
| Destinations list | `destinations-management-page.tsx` | Custom table + pager | react-table | same | Manual columns | KPI strip, snapshot metrics | `DIRECT_DEPENDENCY` | MIT | Low | Medium | Sort/filter | P2 | Candidate #1 if Table adopted |
| Connector catalog | `connector-catalog-page.tsx` | Custom table | react-table | same | No shared grid | CompletenessBadge | `DIRECT_DEPENDENCY` | MIT | Low | Low | Sort/filter | P2 | Safe list |
| Connectors overview | `connectors-overview-page.tsx` | Unvirtualized table | react-virtual (+ optional table) | `useVirtualizer` | Large list jank | Health cells | `DIRECT_DEPENDENCY` | MIT | Low | Medium | Scroll perf | P1 | Virtual first |
| Routes list | `routes-overview-page.tsx` | Custom + virtual + Route Flow | react-table | expanding rows | Nested flow is custom | `buildRouteFlowTree` | `DIRECT_DEPENDENCY` | MIT | Low | Medium | Column state | P2 | Keep flow table |
| Issues lists | issue rail, governance issues | Small lists | react-table | — | None material | Derivations | `REJECT` / LATER | MIT | None | Low | Low | LATER | Skip |
| Governance tables | policy/violations/audit | `opTable` | react-table | `FlexRender` | One-off state | `opTable` classes | `DIRECT_DEPENDENCY` | MIT | Low | Medium | Consistency | P2 | After destinations |
| Union Schema tree | `union-schema-tree.tsx` | Full recursive render | `@tanstack/react-virtual` | `useVirtualizer` | Unbounded DOM | `buildSchemaTree` | `DIRECT_DEPENDENCY` | MIT | None | Medium | Wizard perf | P1 | Flatten + window |
| Sample JSON tree | `mapping-json-tree.tsx` | Full recursive render | react-virtual | same | Unbounded DOM | Path pickers | `DIRECT_DEPENDENCY` | MIT | None | Medium | Wizard perf | P1 | Same pattern |
| Event samples | `stream-recent-events-panel.tsx` | Slice 8 | react-virtual | same | Cap hides data | Panel chrome | `DIRECT_DEPENDENCY` | MIT | Must not hide runtime | Low | More events visible | P2 | When raising cap |
| Fixed-row ops tables | `fixed-row-virtual-window.ts` | Custom | react-virtual | — | Good enough | Existing tests | `REFERENCE_PATTERN` | MIT | None | — | — | LATER | Keep until pain |
| Timeseries charts | Recharts widgets | Recharts 3.8 | (none of these OSS) | — | — | — | `REJECT` (as graph-lib replacement) | — | Would regress charts | — | — | REJECT | Keep Recharts |
| Snapshot fetch | `operationalSnapshot.ts`, `runtimeSnapshotSync.ts` | Canonical | **None** | — | Topology page missing snapshot_id | Entire snapshot stack | `REJECT` replacement | — | **P0 violation** if replaced | — | — | REJECT | Never replace |

---

## 11. Never-adopt list (hard)

1. **Do not replace Runtime Snapshot / Operational Snapshot** with graph library state, Archify IR, or client-only metrics.
2. **Do not hide** EPS, Success Rate, Checkpoint, Route Health, or Delivery Health behind zoom, collapsed nodes, or “pretty” diagrams.
3. **Do not adopt Archify** as the in-app operational topology (CLI/HTML product, not React 19 SPA).
4. **Do not introduce a parallel pipeline/runtime** to feed the graph.
5. **Do not duplicate streams** per destination; graph edges are routes.
6. **Do not model Route Processing as a second runtime path** — Transform → Protection → Classification → Policy → Delivery stay badges/config on the route.
7. **Do not replace Recharts** with xyflow for volume/success timeseries.
8. **Do not import `@xyflow/react` from dashboard, streams console, or destination list** (bundle).
9. **Do not use xyflow as a writable stream/route editor** that bypasses existing wizards/APIs.
10. **Do not pin `@dagrejs/dagre@3.1.2-pre`** from this shallow clone; use a published release.
11. **Do not use legacy npm `dagre@0.8.5`** from the xyflow example `package.json`.
12. **Do not virtualize away DEV VALIDATION / DEV E2E streams** or reduce their operational visibility.
13. **Do not treat TanStack Table as a reason to drop `opTable` accessibility** or problem-first sorting without equivalent behavior.
14. **Do not use graph animation to imply live event motion** that snapshot did not report (Archify principle worth keeping).

---

## 12. If a topology canvas is built later (audit guidance only — not implementation)

Read-only recipe (for planners, not this change set):

1. Keep `getOperationalSnapshot` / `fetchRuntimeTopology(..., { snapshot_id })` as data.
2. Map stream/route/destination rows to xyflow `Node`/`Edge` in a pure function beside `routes-flow-helpers.ts`.
3. Dagre `rankdir: 'LR'` with ranks: Source, Stream, Route, Destination (connectors optional parent).
4. Custom nodes: show EPS, Success Rate, health; stream node shows checkpoint lag; route node shows delivery health.
5. `nodesDraggable={false}` `nodesConnectable={false}`; selection opens existing detail routes (`streamRuntimePath`, `routeEditPath`, `destinationDetailPath`).
6. Tracing: `getIncomers` / `getOutgoers` (or snapshot joins) to dim non-path nodes.
7. Lazy route; restore nav without removing Route Flow table.
8. Playwright: P0 metrics visible at default zoom; lab streams still listed.

This does **not** change Runtime behavior.

---

## 13. License / React 19 / maintenance summary

| OSS | License (root + package) | Copyleft | React 19 | Maintenance (clone) | Supply-chain notes |
| --- | --- | --- | --- | --- | --- |
| `@xyflow/react` 12.11.5 | MIT | No | Peer `>=17`; examples React 18 | Active 2026-08-25; SECURITY.md 12.x | zustand + d3-*; lazy import |
| `@dagrejs/dagre` 3.1.2-pre | MIT (+ LEGAL.txt in dist) | No | N/A | Active 2026-08-08; **pre** version | Use published non-pre |
| Archify 2.16.0-dev.0 | MIT | No | N/A (Node CLI, private) | Active 2026-08-28 | Not an npm SPA library |
| `@tanstack/react-table` 9.2.3 | MIT | No | Dev on React 19.2; peer `>=18`; node `>=20` | Active 2026-08-26 | v9 API ≠ v8 `useReactTable` |
| `@tanstack/react-virtual` 3.14.10 | MIT | No | Peer includes `^19` | Active 2026-08-18 | Small surface |

No copyleft blocker. Agent 8 may still flag NOTICE aggregation for MIT copyright strings.

---

## 14. Implementation order (if later approved — evidence-based)

Not executed in this audit.

1. **P1** TanStack Virtual on Union Schema + mapping JSON trees, then connector overview/catalog lists.  
   Verify: existing virtualization tests still pass; schema tree tests; no snapshot API change.
2. **P2** Optional React Flow + Dagre topology view; pass `snapshot_id`; keep Route Flow table.  
   Verify: runtime tests untouched; dashboard bundle does not include xyflow.
3. **P2** TanStack Table on Destinations or Catalog first; Streams Console last.  
   Verify: `routes-overview-virtualization.test.tsx`, `streams-console-virtual.test.tsx`, destination tests.
4. **LATER** Virtualize recent events when uncapping; replace custom stream grid virtualizer if costly.
5. **REJECT** Archify wholesale; Recharts replacement; snapshot replacement.

Parallelizable later: Virtual (trees) ∥ Virtual (connector lists). Table migrations should not overlap Streams Console work. Graph work should not land in the same PR as table rewrites (conflict on Routes page).

---

## 15. Unverified / residual risks

- npm published gzip sizes were inferred from source/dist, not `npm pack` on the registry.
- React Flow + React 19 was not runtime-tested in this Vite app (peer allows it; examples are React 18).
- `@dagrejs/dagre` clone is a **pre-release**; published stable version numbers on npm were not re-fetched.
- `RuntimeTopologyResponse.time` snapshot field alignment vs `allSnapshotsMatch` was not end-to-end tested (topology unrouted).
- TanStack Table **v9** vs community v8 docs — implementers must follow v9 `useTable` or explicit `legacy` entry.
- Marketplace as a named product surface was not found; catalog pages used as proxy.
- Agent 1 UI-foundation choices (Base UI, etc.) may affect how custom xyflow nodes are styled; no conflict if graph is isolated.

---

## 16. Short answers for the parent report

| # | Item |
| --- | --- |
| P0 immediate | None of these OSS are P0. Snapshot + P0 metrics already exist. |
| P1 | `@tanstack/react-virtual` for Union Schema, sample JSON, connector lists |
| P2 | `@xyflow/react` + `@dagrejs/dagre` topology canvas; `@tanstack/react-table` on Destinations/Catalog/Governance |
| REJECT | Archify wholesale; graph libs as snapshot replacement; xyflow as pipeline runtime; Recharts replacement |
| Already have | Operational Snapshot, Route Flow table, custom list virtualization, Recharts, Route Processing badges |
| Architecture exclusions | Parallel runtime, duplicated streams, Archify as live ops UI, hiding P0 metrics |
| License exclusions | None (all MIT). Do not ship dagre `-pre` blindly. |

### Summary matrix

| Priority | OSS | Data Relay target | Adoption | Benefit | Risk | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| P1 | `@tanstack/react-virtual` | `union-schema-tree.tsx`, `mapping-json-tree.tsx`, connector lists | `DIRECT_DEPENDENCY` | Window large trees/lists | Medium (expand state) | Implement later; keep snapshot/trees semantics |
| P2 | `@xyflow/react` | Lazy topology view; `RuntimeTopologyPage` / new mapper | `DIRECT_DEPENDENCY` | Zoom/pan/trace | Bundle, a11y, snapshot_id | Optional; table fallback remains |
| P2 | `@dagrejs/dagre` | Layout helper for that view | `DIRECT_DEPENDENCY` | Auto LR layout | Pre-release pin | Pair with xyflow; published version |
| P2 | `@tanstack/react-table` | Destinations, catalog, governance | `DIRECT_DEPENDENCY` | Headless grid | Streams Console regression if done first | Start on smaller lists |
| LATER | Archify reachability | Highlight pattern only | `REFERENCE_PATTERN` | Trace UX copy | None | Use xyflow graph utils instead |
| REJECT | Archify wholesale | — | `REJECT` | — | Parallel product | Do not add |
| REJECT | Any graph lib as metrics source | `operationalSnapshot.ts` | `REJECT` | — | Breaks Snapshot rule | Never |
