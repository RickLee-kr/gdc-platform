# 067 — Failover Routing MVP (M10)

## Scope

Active/Standby failover only: when a **primary** destination send fails with eligible errors, deliver once to a configured **secondary** destination. Not additive fan-out (unlike M9 dynamic routing).

## Storage

Table `stream_failover_routes`:

- `stream_id`, `primary_destination_id`, `secondary_destination_id`, `enabled`
- UNIQUE (`stream_id`, `primary_destination_id`)
- Index (`stream_id`, `enabled`)

Policy: `ACTIVE_STANDBY` only (implicit; no Active/Active).

## Eligible failures

- TCP connect / syslog send failures (`DestinationSendError`)
- UDP sender exceptions
- Webhook timeout
- Webhook HTTP 5xx

**Not** eligible: HTTP **429** (existing route failure policy only).

## Runtime

Hook inside `StreamRunner._fan_out` after primary route send failure, before route failure policy:

1. Primary success → no secondary
2. Primary fail + eligible + enabled rule → `failover_route_attempt` → secondary send
3. Secondary success → `failover_route_send_success`; route treated as recovered for checkpoint
4. Secondary fail → `failover_route_send_failed`; route failure policy applies
5. End of fan-out (when rules exist) → `failover_routing_complete` with cumulative metrics

## Checkpoint

Unchanged rule: update only after successful destination delivery. Primary fail + secondary success counts as success.

## Preview

`failover_plan`: list of `{ primary, secondary }` destination **names** — no simulated send.

## APIs

- `GET/POST /streams/{id}/failover-routes`, `PATCH .../failover-routes/{id}`
- `GET /streams/{id}/failover-routing/summary`, `GET /failover-routing/summary`

## Excluded (post-MVP)

Active/Active, multi-level failover, replay, DLQ, quarantine, classification.
