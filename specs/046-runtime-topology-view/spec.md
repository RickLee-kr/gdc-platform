# Runtime Topology View (MVP)

## Goal

Visualize the configured runtime relationship:

Source → Stream → Mapping → Enrichment → Route → Destination

## Scope

- Read-only backend aggregation at `GET /api/v1/runtime/topology`
- Frontend page at `/runtime/topology`
- Reuse existing health scoring (`current_runtime` by default)
- No StreamRunner, schema, or fake data changes

## Response

Flat node lists (connectors, sources, streams, routes, destinations) plus summary counts and per-node health/enabled flags.

## UI

- Grouped by connector → source → stream
- Route fan-out to multiple destinations per stream
- Actions: stream runtime, filtered logs, destination detail

## Out of scope

- Live graph layout engine / drag-and-drop
- Historical replay or backfill overlays
