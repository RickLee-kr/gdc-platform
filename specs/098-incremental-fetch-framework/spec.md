# Incremental Fetch Framework

## Goal

Provide a connector-common incremental fetch framework so connectors declare a strategy
and the runtime performs fetch watermark management, closed-window bounds, and
fetch/delivery checkpoint separation.

## Strategies

| Strategy | Runtime responsibility |
|----------|------------------------|
| `cursor` | Store `connector_cursor`; substitute into request templates |
| `timestamp_watermark` | Store `incremental_fetch_watermark`; substitute into templates |
| `closed_window_watermark` | Compute `upper_bound = now - stability_lag`; advance watermark after fetch |
| `custom` | Connector/plugin handles incremental logic; runtime does not auto-advance |

## Checkpoint keys (generic)

- `incremental_fetch_watermark` — fetch position for timestamp strategies
- `connector_cursor` — opaque cursor for cursor strategies
- `delivery_checkpoint` — nested delivery state (`last_success_event`, derived aliases)
- `last_fetch_at`, `last_delivery_at`, `fetch_window`

## Compatibility

Streams without `config_json.incremental_fetch` keep legacy behaviour: a single
checkpoint updated only after successful destination delivery.

Legacy `config_json.checkpoint.mode` maps to framework strategies when
`incremental_fetch` is not explicitly set.

## Pagination

Connectors paginate within the current fetch window. Events outside the window
are deferred to the next fetch cycle.

## Incremental test

`POST /runtime/streams/{id}/incremental-test` never mutates production checkpoints.
It returns strategy, fetch window, and query preview for operator validation.
