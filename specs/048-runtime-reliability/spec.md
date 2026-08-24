# Runtime Reliability Architecture

## Status

**Specification and constitution only.** This document defines architecture policy, terminology, acceptance criteria, and a future optional runtime mode.

**Not in scope for this spec:**

- StreamRunner behavior changes
- Database migrations
- Queue processing implementation
- Delivery worker implementation

Current production runtime remains the direct StreamRunner pipeline documented in `specs/002-runtime-pipeline/spec.md`.

## Purpose

GDC is a lightweight Source-to-Destination connector platform. Push-based ingestion (for example `WEBHOOK_RECEIVER`, future `SYSLOG_RECEIVER`) may require optional durability and buffering when downstream delivery fails. Polling-based sources (for example `HTTP_API_POLLING`, `DATABASE_QUERY`) often have upstream persistence and may safely use lightweight direct delivery.

The platform MUST support **selectable reliability and buffering modes per Stream** without making durable queuing mandatory globally.

## Required Invariants (unchanged)

- Connector ≠ Stream
- Source ≠ Destination
- Stream is the runtime execution unit
- Route-based fan-out is the only Stream-to-Destination path
- Mapping and Enrichment remain separate stages
- Checkpoint updates only after successful destination delivery ACK
- Source rate limit and Destination rate limit remain separate
- Delivery failures must be logged structurally
- StreamRunner remains the only transaction owner for **current** committed runtime DB writes until a future Delivery Worker mode is explicitly implemented and enabled per Stream

## Lightweight-by-Default Principles

1. GDC must remain lightweight by default.
2. Persistent buffering must never be globally mandatory.
3. Reliability behavior must be selectable per Stream.
4. Push-based ingestion sources may **recommend** buffering modes; they must not require platform-wide durable queue infrastructure.
5. Polling-based sources may safely use `DIRECT` mode when upstream persistence exists.
6. Durable delivery requires explicit operational tradeoff acceptance (CPU, memory, disk, operational complexity).
7. Backpressure handling must exist independently from Stream fetch lifecycle (future runtime).
8. Destination failure must not automatically imply Source failure.
9. Queue depth and delivery health must be observable at runtime when buffering or queue features are enabled.

## Reliability Modes (per Stream)

Each Stream selects one reliability mode. Default for new Streams SHOULD be `DIRECT` unless the Source type documentation recommends otherwise.

| Mode | Description | Durability | Typical use |
|------|-------------|------------|-------------|
| `DIRECT` | Process and deliver immediately; no persistent buffer | None on platform | `HTTP_API_POLLING`, `DATABASE_QUERY`, `S3_OBJECT_POLLING`, `REMOTE_FILE_POLLING` |
| `MEMORY_BUFFER` | In-memory burst absorption and downstream backpressure | Lost on restart/crash | Lightweight push ingestion |
| `PERSISTENT_QUEUE` | DB/disk-backed delivery queue with retry/recovery | Survives restart | High-reliability Streams |
| `EXTERNAL_BUFFER` | Durability delegated to external system | Depends on external platform | GDC stays lightweight; Vector, Kafka, Redis Streams, NATS, RabbitMQ, etc. |

### DIRECT

- Lowest resource usage.
- No persistent buffering.
- Events are processed and delivered in the same runtime pass as today.
- Recommended default for polling-based sources.

### MEMORY_BUFFER

- Temporary burst absorption and downstream backpressure handling.
- May lose buffered events on process restart or crash.
- Recommended for lightweight push ingestion when brief downstream outages are acceptable.

### PERSISTENT_QUEUE

- Uses a platform-managed durable delivery queue (future DB/disk-backed).
- Supports retry and recovery after restart.
- Higher CPU, memory, and disk usage is expected and must be accepted explicitly by operators.

### EXTERNAL_BUFFER

- GDC ingests or hands off to an external buffering platform.
- Platform remains lightweight; durability and replay semantics are owned by the external system.
- GDC Stream configuration references external buffer connection metadata (future).

## Source-Type Guidance (non-mandatory defaults)

| Source category | Examples | Typical recommended mode |
|-----------------|----------|---------------------------|
| Polling | `HTTP_API_POLLING`, `DATABASE_QUERY`, `S3_OBJECT_POLLING`, `REMOTE_FILE_POLLING` | `DIRECT` |
| Push | `WEBHOOK_RECEIVER`, future `SYSLOG_RECEIVER` | `MEMORY_BUFFER` or `PERSISTENT_QUEUE` / `EXTERNAL_BUFFER` when lossless ingestion is required |

Recommendations are not hard requirements: operators may choose `DIRECT` on push sources when they accept loss on downstream failure.

## Current Runtime Pipeline

```text
StreamRunner
  -> Fetch (Source Adapter)
  -> Mapping
  -> Enrichment
  -> Formatter
  -> Route Fan-out
  -> Destination Send
  -> Checkpoint Update (on delivery ACK)
  -> Structured Logs / Runtime State
```

## Future Optional Runtime: Delivery Queue + Delivery Worker

This architecture is **optional per Stream** and **not mandatory** for lightweight or single-node deployments.

When `PERSISTENT_QUEUE` or equivalent internal queue semantics are enabled (future implementation):

```text
StreamRunner
  -> Fetch
  -> Mapping
  -> Enrichment
  -> Delivery Queue Enqueue

DeliveryWorker (separate lifecycle)
  -> Route Delivery
  -> Retry / Backoff
  -> Delivery ACK
  -> Checkpoint Update
```

### Separation of concerns

- **Fetch lifecycle** (polling interval, source checkpoint cursor, rate limits) must not be tightly coupled to **destination retry lifecycle**.
- Source fetch success must not be rolled back solely because a Destination is temporarily unavailable (unless Stream policy explicitly pauses fetch).
- Destination retry, backoff, and dead-letter handling occur in the delivery path (StreamRunner extension or DeliveryWorker), not in the Source adapter.

## Route-Level Delivery Reliability (future, optional)

These mechanisms are **optional** runtime durability features. They are **not** required for lightweight deployments.

| Concept | Definition |
|---------|------------|
| `delivery_queue` | Durable or buffered holding area between enrichment and route send |
| `dead_letter_queue` | Storage for events that exceeded retry policy or failed permanently |
| `retry scheduling` | Time-based re-attempt of pending deliveries |
| `exponential backoff` | Increasing delay between retries per route or destination policy |
| `queue depth` | Count of events awaiting delivery |
| `oldest pending age` | Age of the oldest undelivered event in queue |
| `route delivery ACK` | Explicit success signal per route before checkpoint eligibility |
| `dedupe` / `event hash` | Idempotency key to suppress duplicate delivery on replay |
| `replay` / `requeue` | Operator or system-initiated re-delivery of queued or dead-lettered events |

Route failure policies in `specs/004-delivery-routing/spec.md` (`LOG_AND_CONTINUE`, `PAUSE_STREAM_ON_FAILURE`, etc.) remain valid. Future queue features compose with those policies; they do not replace them.

## Operational Observability (future runtime)

When reliability modes beyond `DIRECT` are enabled, runtime observability MUST expose (read-only APIs and/or runtime state):

- `queue_depth`
- `retry_count`
- `dead_letter_count`
- `oldest_pending_event_age`
- `destination_health`
- `route_backpressure_state`
- `dropped_event_count`
- `delivery_ack_latency`

Existing `delivery_logs`, runtime analytics (`specs/011-runtime-analytics/spec.md`), and health scoring (`specs/012-runtime-health-scoring/spec.md`) remain the baseline for committed outcomes. Queue metrics are additive.

## Implementation Constraints (forbidden patterns)

The following are forbidden in future implementation unless an explicit future spec narrows an exception:

1. Forcing `PERSISTENT_QUEUE` or any durable buffer mode globally for all Streams.
2. Tightly coupling Source fetch lifecycle with destination retry lifecycle (single failure domain).
3. Introducing Kafka-scale operational complexity as the **default** runtime behavior.
4. Breaking lightweight single-node deployments (direct mode must remain fully supported).
5. Updating checkpoint before route delivery ACK.
6. Bypassing Route for Destination delivery.

## Competitive Architecture References

Runtime reliability direction is informed by operational patterns from:

- **Vector** — buffering and backpressure
- **Cribl Stream** — persistent queues and route-level delivery
- **Fluent Bit** — lightweight buffering modes
- **Benthos / Redpanda Connect** — ACK-oriented delivery model
- **Apache NiFi** — queue depth and backpressure observability

GDC is **not** intended to become a generic distributed stream processing platform. Its primary purpose remains lightweight operational data collection, transformation, enrichment, and multi-destination delivery.

## Acceptance Criteria (spec phase)

- [ ] Constitution documents reliability modes and lightweight-by-default principles.
- [ ] `specs/001-core-architecture/spec.md` references per-Stream reliability selection.
- [ ] `specs/002-runtime-pipeline/spec.md` documents current vs future pipeline and observability requirements.
- [ ] `specs/003-db-model/spec.md` documents future terminology for queue-related persistence (no migrations in this phase).
- [ ] `specs/004-delivery-routing/spec.md` documents route-level future delivery reliability concepts.
- [ ] `.specify/specs-index.md` lists this spec.
- [ ] No StreamRunner, migration, or queue worker code changes in the same change set as this spec-only task.

## Related Specs

- `specs/001-core-architecture/spec.md`
- `specs/002-runtime-pipeline/spec.md`
- `specs/003-db-model/spec.md`
- `specs/004-delivery-routing/spec.md`
- `specs/011-runtime-analytics/spec.md`
- `specs/012-runtime-health-scoring/spec.md`
- `specs/043-observability-scale-foundation/spec.md`

---

## DATA RELAY MARKETPLACE ADDENDUM v1.0 — Package Reliability Hints

Status: Architecture Direction / Implementation Pending
Authority: Additive only. Existing Product Charter, Runtime Is Truth, Stream/Route, Credential, Governance, and Checkpoint invariants remain authoritative.
Reference: `docs/architecture/DATA-RELAY-CONNECTOR-MARKETPLACE-ARCHITECTURE-CHARTER-v1.0-DRAFT.md`


A package may declare compatibility/runtime hints only for reliability modes the platform supports.
Package content MUST NOT ship a custom retry/queue/circuit/checkpoint implementation.
Runtime configuration and current reliability policy remain authoritative over package recommendations.
