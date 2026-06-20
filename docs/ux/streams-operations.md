# Streams Operations UX (P1)

The Streams console at `/streams` is the operator workspace for monitoring 20–50 streams grouped by source product. P1 adds search, filters, problem-first ordering, and fast drill-down to stream runtime.

## Operator goals

- Find problem streams within ~5 seconds
- Jump from Dashboard group summary → expanded group on Streams
- Open stream runtime for investigation and action

## Features

### Stream search

- **Location:** `StreamsOperationsToolbar` search input (`data-testid="streams-search-input"`)
- **Fields:** stream name, source product label, connector name, destination names (from existing routes/destinations list APIs)
- **Behavior:** case-insensitive live filter; no new backend endpoints

### Quick filters

| Filter | Shows |
|--------|--------|
| All | Every stream |
| Healthy | Operational severity healthy |
| Warning | Warning severity |
| Critical | Critical severity |
| Issues Only | Warning + Critical |

### Problem-first sort

Default ordering (groups and streams within groups):

1. Critical → Warning → Healthy (stopped between healthy and warning)
2. Issue count descending
3. Name ascending

Implemented in `frontend/src/lib/streams-console-operations.ts`.

### Group filter

- Dropdown: **All Products** + each source product group from loaded streams
- Uses `resolveSourceProductLabel` / `groupRowsBySourceProduct` — same model as Dashboard P0

### Stream operations summary

Strip above filters (`StreamsOperationsSummaryStrip`):

- Healthy Streams
- Warning Streams
- Critical Streams
- Issues Streams (warning + critical)

Counts are computed from full loaded rows (not filter-scoped).

### Problem Streams panel

- Lists warning and critical streams from **current filter set**
- Columns: severity, stream name, group, issue count
- Click → `/streams/{id}/runtime`
- Empty: *No streams currently require attention.*

### Dashboard drill-down

- Dashboard group summary links to `/streams?expand_group={productLabel}`
- Streams console:
  - Auto-expands matching group
  - Highlights group row (`ring-violet-500`)
  - Scrolls group into view

## Empty states

| Condition | Message |
|-----------|---------|
| Active filters, no matches | No streams match your filters. |
| Problem panel, all healthy | No streams currently require attention. |
| No groups after filter | No stream groups found. (via filter empty state) |

## Constraints

- No runtime engine changes
- No new API endpoints (routes/destinations list used for destination search only)
- Dashboard P0 surfaces unchanged

## Related files

| Area | File |
|------|------|
| Filter/sort logic | `frontend/src/lib/streams-console-operations.ts` |
| Page wiring | `frontend/src/components/streams/streams-console.tsx` |
| Toolbar | `frontend/src/components/streams/streams-operations-toolbar.tsx` |
| Summary | `frontend/src/components/streams/streams-operations-summary-strip.tsx` |
| Problem list | `frontend/src/components/streams/streams-problem-panel.tsx` |
| Deep link path | `frontend/src/config/nav-paths.ts` (`streamsExpandedGroupPath`) |
| Tests | `streams-console-operations.test.ts`, `streams-console-filters.test.tsx`, `streams-console-expand.test.tsx` |
