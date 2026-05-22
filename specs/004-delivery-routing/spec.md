# Delivery Routing

## Destination Types
- SYSLOG_UDP
- SYSLOG_TCP
- SYSLOG_TLS (RFC5425-style TCP+TLS delivery; see `specs/024-syslog-tls-destination/spec.md`)
- WEBHOOK_POST

## Failure Policy
- LOG_AND_CONTINUE
- PAUSE_STREAM_ON_FAILURE
- DISABLE_ROUTE_ON_FAILURE
- RETRY_AND_BACKOFF

## Rules
- Fan-out required
- All routes success → checkpoint update
- Any failure → no checkpoint (except LOG_AND_CONTINUE)

---

# Route-Level Delivery Reliability (future, optional)

Authoritative policy: `specs/048-runtime-reliability/spec.md`.

These features are **optional** runtime durability capabilities. Lightweight deployments may use `DIRECT` mode with today's synchronous StreamRunner send path only.

## Future concepts (per Route / Stream)

| Concept | Purpose |
|---------|---------|
| `delivery_queue` | Buffer between enrichment and wire send |
| `dead_letter_queue` | Hold permanently failed or exhausted-retry events |
| `retry scheduling` | Defer redelivery attempts |
| `exponential backoff` | Increase delay between attempts (composes with `RETRY_AND_BACKOFF`) |
| `queue_depth` | Operational visibility of pending work |
| `oldest pending age` | SLA and backlog alerting |
| `route delivery ACK` | Explicit per-route success before checkpoint |
| `dedupe` / `event_hash` | Suppress duplicate delivery on replay |
| `replay` / `requeue` | Operator-initiated recovery |

## Failure policy interaction

Existing failure policies remain:

- `LOG_AND_CONTINUE`
- `PAUSE_STREAM_ON_FAILURE`
- `DISABLE_ROUTE_ON_FAILURE`
- `RETRY_AND_BACKOFF`

Future queue and dead-letter behavior must not bypass Route fan-out or checkpoint-after-ACK rules. Queue retry is a **destination delivery** concern, not a Source fetch concern.

## Observability (future)

Per route and destination, when queues are enabled:

- queue depth, retry count, dead letter count
- oldest pending event age
- destination health, route backpressure state
- dropped event count, delivery ACK latency

## Constraints

- No global mandatory persistent queue
- No requirement to run external Kafka for default deployments
- Route-based fan-out remains mandatory
