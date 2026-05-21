# Pipeline Debugger (MVP)

## Purpose

Allow operators to inspect how one sample event moves through the runtime pipeline without executing StreamRunner or sending to destinations.

## API

- `POST /api/v1/runtime/streams/{stream_id}/pipeline-debug`
- Optional body: `{ "raw_event": <payload> }`
- When `raw_event` is omitted, use `source_config.sample_payload` or `raw_sample_payload` when present.

## Pipeline stages (read-only)

1. Raw event (first extracted event)
2. Mapped event (`apply_mappings`)
3. Enriched event (`apply_enrichments` + source metadata copy)
4. Formatted payload (`compact_event_json` on enriched event)
5. Per-route delivery preview (reuse `build_route_delivery_preview_messages`; no adapter send)

## Constraints

- No StreamRunner invocation
- No checkpoint update
- No destination delivery
- No `delivery_logs` persistence
- No DB commit from debugger path
- VIEWER role may call endpoint (preview-only POST whitelist)

## UI

- Pipeline Debugger panel on Stream Runtime Detail page
- Stage cards + route delivery preview + warnings/errors
