# Durable Delivery Queue — Architecture Audit & Minimal Design

**Status:** Audit / design only (no queue implementation, no migrations)  
**Baseline HEAD:** `6038d355afc704f735019dac5572e629e4a4bdc4`  
**Date:** 2026-08-23  
**Authority:** Runtime code + `specs/048-runtime-reliability`, `specs/002-runtime-pipeline`, constitution checkpoint rule

---

## 0. Executive verdict

| Question | Answer |
|----------|--------|
| Current delivery durability | **DIRECT / in-memory only** — events after Source fetch exist only in process memory until Destination ACK; durable DB state is checkpoint + delivery_logs (+ optional replay/quarantine on terminal paths) |
| Event-loss windows | **Yes** (push / non-refetchable sources; also polling if source watermark advances independently) |
| Duplicate windows | **Yes** (Destination ACK received, success not yet committed → restart re-sends) |
| Queue required for stated goal | **YES** (`PERSISTENT_QUEUE` per Stream) |
| Chosen persistence unit | **Route + Destination delivery batch** |
| Proposed model | `StreamDeliveryQueueItem` (`stream_delivery_queue_items`) |
| Reuse existing queue/outbox? | **None exists** — do not overload `stream_replay_events` or `stream_quarantine_events` |

**Non-goals of this document:** implement queue worker, create Alembic migrations, change StreamRunner behavior.

---

## 1. Inventory — what already exists (do not duplicate)

### 1.1 Runtime pipeline (implemented)

```text
StreamRunner.run
  → resolve checkpoint (DB)
  → SourceRateLimiter.allow
  → fetch / extract / map / enrich  (in-memory)
  → [optional] Route Processing stages
  → release caller DB txn before Destination I/O
  → per-route DestinationRateLimiter + send (Webhook/Syslog/…)
  → optional in-process RETRY_AND_BACKOFF (time.sleep)
  → optional Active/Standby failover secondary send
  → on terminal failure: record StreamReplayEvent (operator replay)
  → stage checkpoint only if required routes succeeded
  → _flush_pending_writes: delivery_logs + checkpoint + status (one short TX)
```

Primary code: `app/runners/stream_runner.py`, `app/route_delivery/stage.py`, `app/delivery/*`.

### 1.2 Persistence that looks queue-like (but is not a delivery outbox)

| Artifact | Table / location | Purpose | Overlap with Durable Queue? |
|----------|------------------|---------|------------------------------|
| Checkpoint | `checkpoints` | Stream cursor; advance **only after delivery success** | Cursor only — cannot store undelivered payloads |
| Delivery logs | `delivery_logs` | Structured evidence / dedup registry seeds | Observability, not delivery ownership |
| Stream replay | `stream_replay_events` | Operator re-send after **final** destination failure | Terminal / manual — not in-flight retry |
| Quarantine | `stream_quarantine_events` | Policy hold of protected payloads | Governance — not destination outage retry |
| Dedup “queue” | In-memory `DedupQueueEntry` + registry in logs | Pre-transform duplicate suppression | Not durable delivery |
| Failover routes | `stream_failover_routes` | Secondary destination binding | Config — not a queue |
| Spec terminology | `delivery_queue` in specs 001–004, 048 | Future optional `PERSISTENT_QUEUE` | **This design implements that concept** |

**Finding:** There is **no** `outbox`, `delivery_queue` table, or DeliveryWorker in the codebase. Spec 048 already names the future mode; this audit binds it to verified Runtime gaps.

### 1.3 Spec / constitution alignment

- Checkpoint after Destination ACK only — preserved.
- One Stream → Many Routes → Many Destinations; Route isolation — preserved.
- Reliability modes per Stream (`DIRECT` default; `PERSISTENT_QUEUE` optional) — `specs/048-runtime-reliability/spec.md`.
- Lightweight-by-default; durable queue never globally mandatory — preserved.

---

## 2. Audit answers (required)

### Q1. After Source fetch, where do events live? Crash before delivery?

**Today:** Only in local variables (`events` / `enriched_events` / route payloads) inside `StreamRunner.run`. Nothing persists the batch for later send.

**On crash before delivery:**

- Checkpoint is **not** advanced (`_pending_checkpoint` cleared on exception; failure path emits `checkpoint_held`).
- **Polling sources** with stable upstream data: next scheduler cycle re-fetches from the same checkpoint → usually no loss.
- **Push / non-refetchable / side-effecting sources:** events are **lost**.
- Scheduler restart drops in-flight worker memory; next poll uses DB checkpoint only.

### Q2. Crash immediately before / during / after Destination I/O?

| Window | Current behavior | Loss? | Duplicate? |
|--------|------------------|-------|------------|
| **A** Fetched → before send | Memory only; checkpoint held | Push: **yes**. Polling: usually no if source re-readable | No |
| **B** Request sent → before success persisted | Network may have succeeded; `route_send_success` / checkpoint only staged in memory until `_flush_pending_writes` | No (checkpoint held → re-attempt) | **Yes** (at-least-once). Proven by toxiproxy `reset_peer` e2e |
| **C** Success persisted → before checkpoint advance | **Not a separate durable state today** — logs + checkpoint commit in **one** `_flush_pending_writes` transaction | N/A as split window | N/A |
| **D** `RETRY_AND_BACKOFF` waiting (`time.sleep`) → restart | Retry state is in-process only; no `available_at` | Same as A | Same as A on re-fetch |

**Proposed durable behavior** (see §8): enqueue before I/O; claim → send → mark `DELIVERED` in short TX; advance checkpoint only when the fetch-batch’s required route items are `DELIVERED`; never hold DB TX across network I/O.

### Q3. After Runtime restart, what state can delivery resume from?

**Today:**

1. `checkpoints.checkpoint_value_json` (stream cursor).
2. Enabled stream + route/destination config (reloaded each poll).
3. Optional `stream_replay_events` with `status=pending` (operator-driven, not automatic).
4. Dedup registry seeds from recent `delivery_logs` (when scope ≠ `current_run`).

There is **no** automatic resume of “already fetched, not yet ACKed” batches.

**Proposed:** resume from `stream_delivery_queue_items` where `status IN (PENDING, RETRY_WAIT)` or stale `IN_FLIGHT` (lease expired), ordered by `available_at`, filtered by stream/route.

### Q4. Can checkpoint alone implement durable retry?

**No.**

Checkpoint stores a **cursor**, not undelivered payloads, per-route ACK state, attempt counts, or retry schedules. Advancing checkpoint without a queue would either:

- skip undelivered events (loss), or
- force full source re-fetch (duplicates + couples fetch lifecycle to destination outage — forbidden by spec 048).

Hence a separate **delivery queue / outbox** is required for `PERSISTENT_QUEUE`.

### Q5. Queue persistence unit (decision)

**Candidates:** Stream | Route | Route + Destination | Delivery batch

**Decision: Route + Destination delivery batch**

Rationale:

1. Runtime send unit is already **one route → one primary destination** (`_send_route_events`), with optional failover secondary destination.
2. Route isolation requires independent retry/backpressure per route; stream-scoped queue items would serialize unrelated destinations.
3. Failover and existing replay both key by `destination_id`; queue items must name the destination actually being attempted.
4. Payload is a **batch** (current send path), not one row per event — keeps volume and checkpoint eligibility aligned with today’s fan-out.
5. Stream-level checkpoint still aggregates route ACKs via shared `batch_id` (= run/fetch batch id).

Rejected:

- **Stream-only:** breaks route isolation.
- **Route-only without destination:** insufficient for failover secondary / dynamic destination targeting.
- **Per-event rows:** heavier than current batch send + formatter semantics; defer unless a later phase needs it.

### Q6. Minimal DB model

Align naming with `stream_replay_events` / `stream_quarantine_events` and spec term `delivery_queue`.

```text
StreamDeliveryQueueItem  →  table stream_delivery_queue_items
```

| Field | Required | Notes |
|-------|----------|-------|
| `id` | yes | PK |
| `stream_id` | yes | FK streams |
| `route_id` | yes | FK routes — isolation + observability |
| `destination_id` | yes | FK destinations — primary or failover secondary target |
| `batch_id` | yes | Shared fetch/run batch; checkpoint eligibility key (reuse SharedBatchContext.batch_id / run_id) |
| `delivery_kind` | yes | `base_route` \| `failover_secondary` \| `dynamic_route` (same vocabulary as replay) |
| `payload_json` | yes | Protected/delivery-ready event batch snapshot (JSONB) |
| `status` | yes | See §7 |
| `attempt_count` | yes | Increment on each claim/send |
| `available_at` | yes | Retry scheduling; claim only when `<= now()` |
| `lease_owner` / `lease_expires_at` | yes | Crash-safe `IN_FLIGHT` reclaim (minimal lease) |
| `created_at` / `updated_at` | yes | Ops + oldest-pending age |
| `delivered_at` | yes | ACK latency / observability |
| `last_error` | optional (phase 1+) | Truncated string; helps ops without new DLQ |

**Removed from the example list as non-essential for v1:**

- Separate `run_id` column — store as `batch_id` (already run-scoped today) or inside payload metadata; avoid two correlators unless metrics require both.
- `payload_reference` indirection — inline JSONB matches replay/quarantine MVP; add object-store refs only if size becomes a measured problem.

**Not a dead-letter table:** exhausted retries → create/update existing `StreamReplayEvent` (operator path). Do not invent a parallel DLQ.

### Q7. State machine

```text
PENDING
  → (claim) IN_FLIGHT
       → (HTTP/syslog ACK) DELIVERED
       → (retryable failure) RETRY_WAIT
            → (available_at elapsed) PENDING   # or claim directly to IN_FLIGHT
       → (non-retryable / attempts exhausted) EXHAUSTED
            → hand off to stream_replay_events (pending)
            → terminal for queue worker

Stale IN_FLIGHT (lease expired) → PENDING (reclaim)
```

| Status | Meaning |
|--------|---------|
| `PENDING` | Ready to claim |
| `IN_FLIGHT` | Claimed; Destination I/O in progress or unknown after crash |
| `RETRY_WAIT` | Retry scheduled; not claimable until `available_at` |
| `DELIVERED` | Destination ACK recorded |
| `EXHAUSTED` | Automatic retries done; operator replay owns next step |

**Do not add** `FAILED` / `DEAD_LETTER` as a second quarantine/replay system. Policy quarantine remains `stream_quarantine_events` only.

### Q8. Transaction boundaries

**Invariant:** never hold a DB transaction open across Destination network I/O (already true for caller session via `_release_caller_db_before_io`).

Proposed order:

```text
TX1 (short): INSERT queue items for batch (PENDING) for each required route(+destination)
             — after transform/protection; before any Destination send
             — commit

[no TX] Destination I/O for claimed item

TX2 (short): UPDATE item → DELIVERED (or RETRY_WAIT / EXHAUSTED + replay row)
             — commit

TX3 (short): IF all required items for batch_id are DELIVERED
             → upsert checkpoint (success-only rule)
             → commit
```

Notes:

- `route_send_success` / evidence logs may accompany TX2; checkpoint **must not** move in TX2 unless the batch is fully ACKed (multi-route).
- Partial route success (`LOG_AND_CONTINUE`): checkpoint policy stays as today — advance only when constitution/runtime says required routes recovered; queue items for failed absorbed routes may still be `EXHAUSTED`→replay without blocking siblings.
- Fetch lifecycle remains independent: Source poll can continue or pause per existing failure policies; queue depth drives **destination** backpressure, not silent source rollback.

### Q9. Duplicate prevention strategy

**Reuse** `app/runners/stream_dedup.py` + delivery_logs registry:

- Record dedup registry **only after** queue item reaches `DELIVERED` (same “after success” rule as today).
- On reclaim/re-send, existing scoped dedup (`checkpoint_window` / `last_n_hours`) suppresses duplicates when keys are configured.
- At-least-once remains the transport default (toxiproxy reset_peer already documents sink duplicates).
- **Do not** build a parallel dedup engine or new hash store for the queue.

Idempotency keys for destinations (webhook headers etc.) are destination-config concerns, not a new platform engine.

### Q10. Queue backpressure model

When `PERSISTENT_QUEUE` is enabled, expose (and gate fetch/enqueue when thresholds exceeded):

| Metric | Definition | Observability hook |
|--------|------------|--------------------|
| `pending_depth` | count `status IN (PENDING, IN_FLIGHT, RETRY_WAIT)` per stream (and per route) | Additive to runtime evidence / health APIs (spec 048) |
| `oldest_pending_age` | `now - min(created_at)` among pending/retry | Same |
| `retry_depth` | count `status = RETRY_WAIT` | Same |

Actions (minimal):

1. Block **new enqueue** (and optionally Source fetch for that stream) when `pending_depth` or `oldest_pending_age` exceeds stream config.
2. Emit structured stages compatible with `app/observability/runtime_evidence.py` correlation keys (`stream_id`, `route_id`, `destination_id`, `attempt`).
3. Do **not** conflate with SourceRateLimiter / DestinationRateLimiter token buckets.

### Q11. Responsibility boundaries

| Component | Owns | Does not own |
|-----------|------|--------------|
| **SourceRateLimiter** | Poll / fetch admission | Destination retries, queue depth |
| **DestinationRateLimiter** | Send admission per route | Source polling, durable retry schedule |
| **HTTP Resilience** (`app/http/resilience`) | Per-request attempt classification, short backoff inside one send call | Cross-restart durable retry (`available_at`), checkpoint |
| **Route `RETRY_AND_BACKOFF`** (today) | In-process sleeps in StreamRunner | Surviving process death |
| **Durable Queue** (proposed) | Persist batch, claim/lease, `available_at` retry across restarts | Source HTTP retries, policy quarantine |
| **Failover engine** | Choose secondary destination on primary failure | Persist payload (queue does) |
| **Replay / Quarantine** | Operator / policy terminals | Automatic in-flight recovery |

### Q12. Failover × Durable Queue

1. Enqueue initially targets **primary** `destination_id` (`delivery_kind=base_route`).
2. On primary failure (same eligibility as today’s failover): either  
   - update the same item’s `destination_id` to secondary + `delivery_kind=failover_secondary`, or  
   - insert a child item linked by `batch_id` / `route_id` and mark primary `EXHAUSTED` without checkpoint advance.  
   Prefer **update-in-place** for v1 (one outstanding delivery per route per batch).
3. Checkpoint advances only after the **effective** successful destination ACK for required routes (unchanged semantics).
4. If secondary also fails to exhaustion → existing `StreamReplayEvent` path (`failover_secondary` kind already supported).

### Q13. Migration / rollout

| Concern | Decision |
|---------|----------|
| Default mode | Keep **`DIRECT`** (current behavior) for all existing streams |
| Enablement | Per-stream `reliability_mode=PERSISTENT_QUEUE` (feature flag / stream_config; matches spec 048) |
| Schema | Additive table only; no change to `checkpoints` meaning |
| Cutover | Flag off → zero behavior change; flag on → enqueue path for that stream only |
| Safe migration | Yes — additive DDL + flag; no need to stop streams if deploy is backward compatible |
| Dual-write | Not required for DIRECT streams |

### Q14. Implementation phases (code later — not this change set)

| Phase | Scope |
|-------|--------|
| **1. DB foundation** | Model + migration + repository claim/lease APIs; feature flag plumbing; metrics stubs |
| **2. Webhook destination** | Enqueue after transform; worker/claim path for WEBHOOK; TX boundaries; evidence stages |
| **3. Restart recovery** | Stale `IN_FLIGHT` reclaim; retry `available_at`; scheduler/worker coexistence |
| **4. Other destinations** | Syslog / remaining adapters; failover update-in-place; EXHAUSTED → replay handoff |
| **5. Backpressure + ops** | Depth/age gates; dashboard fields; tune lease timeouts |

Phase 0 (this doc) remains design-only.

---

## 3. Crash windows — current vs proposed

| ID | Current | Proposed (`PERSISTENT_QUEUE`) |
|----|---------|--------------------------------|
| **A** | Memory loss (push) / re-fetch (poll) | Items already in `PENDING` after TX1 → resume without source re-fetch |
| **B** | Checkpoint held; sink may already have event → duplicate on retry | Item stays `IN_FLIGHT`/reclaim → re-send (still at-least-once); dedup registry + destination idempotency mitigate |
| **C** | Not split today (atomic flush) | Explicit TX2 `DELIVERED` then TX3 checkpoint — crash after TX2 before TX3: no loss; next cycle advances checkpoint without re-send |
| **D** | In-process sleep lost on restart | `RETRY_WAIT` + `available_at` survives restart |

### Verification performed (this audit)

- Code probes on `stream_runner.py`: memory-only collect; single flush TX for logs+checkpoint; in-process `RETRY_AND_BACKOFF` sleep; no queue models.
- Pytest: `tests/test_runtime_observability_evidence.py::test_destination_failure_emits_delivery_attempt_and_checkpoint_held`, `tests/test_runtime_db_session_boundary.py` (9 passed).
- Prior e2e evidence: `tests/test_toxiproxy_network_fault_e2e.py` documents at-least-once sink duplicates under `reset_peer`.

---

## 4. Product defect / gap classification

| Item | Classification |
|------|----------------|
| No durable in-flight delivery store | **Known architecture gap** (spec 048 future mode) — not a regression from baseline |
| In-process-only retry | Gap vs restart durability goal |
| Checkpoint cannot express per-route undelivered state | By design of cursor model |

No new production code defect was introduced or fixed in this change set.

---

## 5. Design summary diagram

```text
                    DIRECT (today / default)
Source → … → Route send → stage success → flush(logs+checkpoint)

                    PERSISTENT_QUEUE (proposed)
Source → … → TX1 enqueue(Route+Dest batch)
                → claim → [network I/O] → TX2 DELIVERED|RETRY_WAIT|EXHAUSTED
                → TX3 checkpoint iff batch required routes DELIVERED
```

---

## Exactly-once limitation (Phase 2 — Webhook path)

**Crash window B** (audit §Q2 / §Q9): Destination network may succeed while
`stream_delivery_queue_items.status` is still `IN_FLIGHT` if the process dies
before the short TX that marks `DELIVERED`. On reclaim/re-send the sink may
receive a duplicate.

Mitigations (reuse only — no parallel engine):

1. Optional webhook header `X-Data-Relay-Delivery-Id` = `{batch_id}:{queue_item_id}`
   when the durable Webhook path sends (operators may configure destination
   idempotency; unknown headers are ignored by naive sinks).
2. Existing stream dedup registry is recorded **after** `DELIVERED` (same as today).

**Not guaranteed:** exactly-once delivery when the destination lacks idempotency.
Events are **never** dropped solely to force `duplicate=0`.

Phase 2 does **not** implement restart recovery workers; undelivered rows remain
durable in PostgreSQL for Phase 3 reclaim.

---

## 6. References

- `app/runners/stream_runner.py` — transaction policy, fan-out, retry, checkpoint staging
- `app/checkpoints/service.py` — success-only update
- `app/replay/models.py` / `app/quarantine/models.py` — terminal / policy stores
- `app/rate_limit/source_limiter.py`, `destination_limiter.py`
- `app/http/resilience/*` — per-request resilience
- `app/observability/runtime_evidence.py`
- `app/scheduler/scheduler.py` — restart = new workers; reload checkpoint from DB
- `specs/048-runtime-reliability/spec.md`, `specs/002-runtime-pipeline/spec.md`, `specs/003-db-model/spec.md`
- Constitution: checkpoint only after successful Destination delivery
