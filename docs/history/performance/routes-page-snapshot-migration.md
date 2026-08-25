# Routes Page — Operational Snapshot Migration (Phase 2)

## Summary

The Routes Overview page (`frontend/src/components/routes/routes-overview-page.tsx`) now uses **`GET /api/v1/runtime/operational-snapshot`** as the primary runtime data source for initial render. Phase 1 introduced the backend contract; Phase 2 wires the Routes UI to that contract.

## Before (pre–Phase 2)

Initial load could trigger a waterfall / N+1 pattern:

| Call | Purpose |
|------|---------|
| `GET /routes/` | Route metadata |
| `GET /streams/` | Stream names |
| `GET /destinations/` | Destination names |
| `GET /runtime/observability/summary?window=…` | KPI / summary |
| `GET /runtime/streams/{id}/metrics?window=…` | Per-stream metrics (N calls when analytics visible) |
| `GET /runtime/routes/{id}/health` | Per-route health (on row select) |
| `GET /runtime/logs/search` | Recent / panel logs |

Route table runtime columns depended on assembling per-stream metrics and optional health detail.

## After (Phase 2)

| Call | When | Purpose |
|------|------|---------|
| `GET /api/v1/runtime/operational-snapshot` | Initial load + manual refresh | Global KPIs, route table runtime columns, problems list |
| `GET /api/v1/routes/` | Initial load (parallel) | Config metadata: rate limits, names, edit/toggle actions |

**Removed from initial path:**

- Streams list fetch
- Destinations list fetch
- Observability summary fetch
- Per-stream metrics fetch for table rows
- Per-route health fetch on selection (status from `snapshot.routes[].health_status`)

**Still on-demand (not initial table path):**

- **Load Analytics** charts: per-stream metrics + delivery outcomes by destination (user-triggered, visibility-gated)
- **Route panel**: delivery log search + single destination fetch for endpoint details when a row is selected
- Destination connectivity test action

## Frontend modules

| Module | Role |
|--------|------|
| `frontend/src/api/operationalSnapshot.ts` | Typed client + request cache |
| `frontend/src/components/routes/routes-overview-helpers.ts` | `buildRouteRowsFromOperationalSnapshot`, health/EPS formatters |
| `frontend/src/components/routes/routes-overview-page.tsx` | Page wiring |

## Remaining limitations

- Backend snapshot remains a **virtual aggregate** (bulk SQL per request), not a physical read model (Phase 4).
- Snapshot windows are fixed at **1m / 5m** delivery aggregates; the page metrics window selector applies only to lazy analytics and panel logs.
- **Runtime Overview Command Center** and **Streams** pages are not migrated in Phase 2.
- **Logs explorer** is unchanged; Routes no longer bulk-loads logs on initial paint.

## Tests

```bash
cd frontend && npm run test -- --run \
  src/api/operationalSnapshot.test.ts \
  src/components/routes/routes-overview-helpers.test.ts \
  src/components/routes/routes-overview-page.test.tsx
```
