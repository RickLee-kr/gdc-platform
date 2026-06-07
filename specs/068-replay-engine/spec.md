# 068 — Replay Engine MVP (M11)

## Scope

Store **protected delivery payloads** on final destination delivery failures; operators manually replay or discard via API and Runtime Replay Panel.

## Storage

Table `stream_replay_events`:

- `stream_id`, `destination_id`, optional `route_id`, `dynamic_route_id`, `failover_route_id`
- `delivery_kind`: `base_route` | `failover_secondary` | `dynamic_route`
- `status`: `pending` | `replayed` | `failed` | `discarded`
- `protected_payload_json` (events list only — not enriched source)
- `delivery_context_json` (destination_type, formatter_override, prefix_context)
- Indexes on `(stream_id, status)`, `(stream_id, created_at)`, `(status)`

## Record when

- Base route final send failure (after failover not recovered)
- Failover secondary send failure
- Dynamic route send failure

## Exclude

- HTTP 429, destination/dynamic rate-limited skips, dry-run, backfill time-window runs, preview paths

## Replay

- Resend stored protected payload via destination adapter only
- No mapping, enrichment, protection, policy re-execution
- Checkpoint never updated
- Row lock (`SELECT FOR UPDATE`) on replay/discard

## APIs

- `GET /runtime/streams/{id}/replay-events`
- `POST /runtime/replay-events/{id}/replay`
- `POST /runtime/replay-events/{id}/discard`
- `GET /runtime/streams/{id}/replay/summary`
- `GET /runtime/replay/summary`

Legacy `POST /runtime/replay/delivery-log/{id}` and backfill replay unchanged.

## Excluded (post-MVP)

Auto scheduler, DLQ, quarantine, classification, message bus, payload regeneration.
