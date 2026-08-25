# Data Relay Runtime & Reliability

**Document Version:** 2.0  
**Last Updated:** 2026-08-25  
**Status:** CANONICAL

## 1. Runtime objective

Data Relay must remain lightweight by default while allowing stronger delivery durability when required.

Reliability choices must not change the core checkpoint invariant or create a vendor-specific runtime.

## 2. Current source capability summary

| Source type | Status | Notes |
|---|---|---|
| `HTTP_API_POLLING` | `IMPLEMENTED` | Primary path |
| `S3_OBJECT_POLLING` | `IMPLEMENTED` | Extended |
| `DATABASE_QUERY` | `PARTIAL` | Production query path is PostgreSQL-centric |
| `REMOTE_FILE_POLLING` | `IMPLEMENTED` | Extended |
| `WEBHOOK_RECEIVER` | `IMPLEMENTED` | Registered source adapter + ingest path |
| `AI_PROXY_RECEIVER` | `OUT_OF_SCOPE` | Present in code legacy paths; not current OSS product scope |
| Inbound `SYSLOG_RECEIVER` | `TARGET` | Not a first-class source adapter |

Older capability-matrix wording that omitted webhook receiver is stale relative to current code.

## 3. Current destination capability summary

| Destination type | Status | Notes |
|---|---|---|
| `WEBHOOK_POST` | `IMPLEMENTED` | Supports durable queue when configured |
| `SYSLOG_UDP` | `IMPLEMENTED` | |
| `SYSLOG_TCP` | `IMPLEMENTED` | Supports durable queue when configured |
| `SYSLOG_TLS` | `IMPLEMENTED` | |
| `AI_PROVIDER_POST` | `OUT_OF_SCOPE` | Code may exist; not current OSS product scope |

The capability matrix remains a detailed operational reference and must be updated when adapters change.

## 4. Authentication architecture

Runtime authentication uses platform-managed Credential capabilities rather than secrets embedded in packages.

### Current implementation

| Capability | Status |
|---|---|
| Basic / Bearer / API Key | `IMPLEMENTED` |
| Session login | `IMPLEMENTED` |
| OAuth2 Client Credentials | `IMPLEMENTED` |
| OAuth2 Authorization Code (+ PKCE where applicable) | `IMPLEMENTED` |
| Access/refresh token lifecycle | `IMPLEMENTED` |
| Encrypted credential storage (AES-GCM envelopes) | `IMPLEMENTED` |
| Runtime decryption only at the boundary that needs the secret | `IMPLEMENTED` |

Marketplace packages may declare auth requirements and placeholders but never carry live credentials.

## 5. HTTP resilience

HTTP request reliability remains a common runtime capability.

**Status:** `IMPLEMENTED`

Responsibilities include:

- timeout/connection classification
- retryable vs fatal HTTP status handling
- retry backoff
- `Retry-After` handling for 429
- session/auth refresh behavior
- structured failure evidence

Package content may provide hints but may not ship an alternative retry engine.

## 6. Reliability modes

| Mode | Contract | Status |
|---|---|---|
| `DIRECT` | Lightweight immediate processing/delivery path. | `IMPLEMENTED` (default) |
| `MEMORY_BUFFER` | In-memory burst buffering; not durable across restart. | `TARGET` |
| `PERSISTENT_QUEUE` | Platform-managed durable delivery for supported paths. | `IMPLEMENTED` for `WEBHOOK_POST` and `SYSLOG_TCP` when enabled |
| `EXTERNAL_BUFFER` | Durability owned by an external buffering system. | `TARGET` |

### Status clarification

Older specs describe `PERSISTENT_QUEUE` as future-only. That wording is stale.

Selected durable delivery paths have been implemented, including durable queue and restart-recovery work for supported webhook and SYSLOG TCP delivery use cases. `DIRECT` remains a valid lightweight mode.

Do not generalize this into “all sources and destinations are durably queued.” Capability remains path/config dependent.

## 7. Reliability layers are separate

Do not merge these responsibilities:

| Layer | Responsibility | Status |
|---|---|---|
| Source Rate Limiter | Source requests over time | `IMPLEMENTED` |
| HTTP Resilience | Request retry / Retry-After | `IMPLEMENTED` |
| Destination Circuit Breaker | Suppress repeated requests during sustained destination failure | `IMPLEMENTED` (process-local) |
| Adaptive Concurrency | Concurrent destination I/O tuning | `IMPLEMENTED` (opt-in) |
| Backpressure | Prevent uncontrolled growth when durable delivery is saturated | `IMPLEMENTED` for durable-queue paths |
| Durable Queue | Persistent pending/retry delivery state | `IMPLEMENTED` for supported destinations |
| Checkpoint | Source progress eligibility | `IMPLEMENTED` |

Each layer solves a different failure mode.

## 8. Delivery guarantee

Data Relay should describe persistent delivery semantics as **at-least-once** where applicable.

Exactly-once delivery must not be promised.

A delivery identifier may help downstream idempotency, but it does not change the platform guarantee to exactly-once.

## 9. Checkpoint invariant

Checkpoint is source progress state.

It must not advance merely because:

- fetch succeeded;
- parsing succeeded;
- mapping succeeded;
- a package was installed;
- a Marketplace package was upgraded;
- a runtime configuration was previewed.

Checkpoint eligibility is determined only after the required delivery outcome defined by the Stream/Route reliability policy.

## 10. Transaction boundary

Runtime request/caller sessions must not be treated as globally owned by the runner when they are request-owned.

Destination network I/O must not hold inappropriate long-lived caller DB transactions.

Runtime state updates use controlled short persistence boundaries consistent with the current runtime transaction design.

StreamRunner remains the sole transaction owner for runtime DB writes.

## 11. Observability evidence

Runtime evidence should support correlation by:

- `run_id`
- `stream_id`
- `route_id`
- `destination_id`
- attempt/retry information

Operational evidence should be sufficient to answer:

```text
Was source fetch attempted?
Was data extracted?
Which route/stage failed?
Was delivery attempted?
Did delivery succeed?
Did checkpoint advance?
Was retry/recovery successful?
```

## 12. Target reliability improvements

Approved product direction (**Status: `TARGET`**):

- operator-friendly replay/reprocess workflows;
- clear retained/pending data impact;
- destination/API health surfaces;
- failure/recovery timeline;
- safe canary of configuration changes;
- stronger evidence that no checkpoint/data-loss invariant was violated.

These are product/UX targets and must be status-tagged independently of the underlying runtime features.
