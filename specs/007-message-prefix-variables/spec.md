# Message prefix template variables

## Purpose

Route `message_prefix_template` supports placeholders resolved **only** at destination send time. Mapping, enrichment, and checkpoints are unchanged.

## Placeholders

- `{{stream.name}}`, `{{stream.id}}`
- `{{destination.name}}`, `{{destination.type}}`
- `{{route.id}}`
- `{{timestamp}}` (UTC ISO8601)
- `{{event.event_type}}`, `{{event.event_name}}`, `{{event.vendor}}`, `{{event.product}}`

Missing values resolve to empty string. Unknown placeholders resolve to empty string.

## Preview API

`POST /api/v1/runtime/format-preview` returns `resolved_prefix` and `final_payload` for UI without delivery.
