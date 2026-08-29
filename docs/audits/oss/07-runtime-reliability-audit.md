# Agent 7 — Delivery / Reliability Pattern Audit

> **Closure (2026-08-29):** Scheduled OSS Fit implementation is complete. W2 and W10 remain ALREADY_IMPLEMENTED. W9/W11 remain `DEFERRED_PRODUCT_DECISION` and are not OSS Fit blockers. This file remains the pre-implementation audit record. See [DATA-RELAY-OSS-IMPLEMENTATION-WORKPLAN.md](./DATA-RELAY-OSS-IMPLEMENTATION-WORKPLAN.md).

**Product:** Data Relay (`gdc-platform`)  
**Requested baseline branch:** `feature/post-m29-development`  
**Reconciliation workspace:** `audit/code-to-oss-fit-reconcile` @ `99dd3bac886760460201f54deaaa282ec0e98bc1`  
**Original investigation HEAD (stale vs this branch):** `fix/route-processing-ux-p0-1-classification-policy` @ `1f270e8`  
**Reconciliation date:** 2026-08-29  
**Canonical authority:** `docs/canonical/03-RUNTIME-RELIABILITY.md`  
**Scope:** Compare **reliability patterns** in OpenTelemetry Collector, Fluent Bit, Vector, Redpanda Connect (Benthos), Apache Camel, and Telegraf against the **existing Data Relay runtime**. Do not adopt those projects as a delivery engine.

## Constraints (this audit)

- Audit markdown only. No Data Relay source, tests, configs, Full Matrix, or QA Lab changes.
- No implementation.
- **Do not** propose adopting OTel Collector, Fluent Bit, Vector, Redpanda Connect, Apache Camel, or Telegraf as the Data Relay runtime.
- Architecture: **One Stream → Many Routes → Many Destinations**. Preserve checkpoint, retry, and delivery.
- Runtime-First: do not recommend replacing runtime. Real gaps → **IMPROVE EXISTING** Data Relay code, never a parallel delivery/retry/checkpoint engine.
- Every pattern is classified as exactly one of: `USE EXISTING` | `IMPROVE EXISTING` | `REFERENCE ONLY` | `DO NOT ADOPT`.
- OSS collector / agent / Camel **runtimes** remain **REJECT** / **DO NOT ADOPT** even when Data Relay now has its own queue, circuit breaker, or jitter helper.

---

## Correct-branch reconciliation

**Agent B — Runtime Reliability Delta Reconciliation.**  
**Investigated functions + tests on `99dd3ba` (`feature/post-m29-development` via `audit/code-to-oss-fit-reconcile`). File existence was not treated as proof. Independent re-check 2026-08-29 confirmed: `WebhookSender.send` constructs `RetryPolicy(...)` **without** `jitter_ratio` (defaults `0.0`); `ResponseClassifier.classify_response` maps other 4xx → FATAL, 429 → RATE_LIMIT + Retry-After; `SourceRateLimiter.allow` is a real token bucket; `Route` ORM has `failure_policy` only (no `retry_count` / `backoff_seconds` columns).**

### W2 / W9 / W10 / W11 verdict table

| ID | Old claim (1f270e8) | Classification on 99dd3ba | Exact functions (wired) | Tests |
| --- | --- | --- | --- | --- |
| **W2** | Webhook retries all HTTP status; dest `Retry-After` missing | **ALREADY_IMPLEMENTED** | `WebhookSender.send` → `ResponseClassifier.classify_response` / `classify_exception`; FATAL 4xx (except 408) aborts with no further attempt; 429 → `HttpOutcome.RATE_LIMIT`; `RetryPolicy.delay_seconds` prefers `ClassificationResult.retry_after_seconds` (header wins, no jitter). Same classifier in `HttpPoller.fetch`, `oauth2_token_http` token POST, `classify_destination_send_error`. Helpers: `parse_retry_after_header`. | `tests/test_http_resilience.py`: `test_classify_response_status_matrix`, `test_classify_429_captures_retry_after`, `test_retry_policy_prefers_retry_after`. `tests/test_http_resilience_callers.py`: `test_webhook_4xx_fatal_no_retry`, `test_webhook_429_uses_retry_after`, `test_webhook_retries_5xx_then_succeeds`, `test_poller_4xx_fatal_no_retry`, `test_poller_429_uses_retry_after`. `tests/test_delivery_queue_webhook_phase2.py`: `test_d_429_retry_after_available_at`, `test_f_fatal_4xx_exhausted_no_retry`. `tests/test_oauth2_authorization_code_lifecycle.py`: `test_q_http_resilience_regression`. |
| **W9** | No jitter anywhere in `app/` | **PARTIALLY_IMPLEMENTED** | `RetryPolicy.apply_jitter` / `delay_seconds` implement full-jitter scaled by `jitter_ratio`. **Default `jitter_ratio=0.0`.** Production constructors do **not** opt in: `WebhookSender.send` (`RetryPolicy(max_attempts=retries+1, initial_backoff_seconds=backoff)`), `HttpPoller.fetch` (same), `oauth2_token_http`, `compute_retry_available_at`. `StreamRunner._apply_failure_policy` (`policy == "RETRY_AND_BACKOFF"`) sleeps `backoff_seconds * 2**idx` with no jitter. `compute_scheduler_backoff_wait_sec` is deterministic `min(300, interval * 2**min(failures, 5))`. | `tests/test_http_resilience.py`: `test_retry_policy_jitter_is_bounded` (opts in `jitter_ratio=1.0`), `test_retry_policy_exponential_backoff_without_jitter`. **No** caller-level test asserts production jitter on webhook/poller/scheduler sleeps. |
| **W10** | `SourceRateLimiter.allow` always `True` (stub) | **ALREADY_IMPLEMENTED** | `SourceRateLimiter.allow` — real per-stream token bucket (`max_requests` / `per_seconds`); empty/invalid config → allow. Wired in `StreamRunner.run` **before fetch**: `self.source_limiter.allow(stream_id, source_rate_limit_json)` → status `RATE_LIMITED_SOURCE`, no poll. Instance-local buckets (not a process singleton). Separate from dest limiter and from HTTP 429 (`source_limiter.py` docstring). | `tests/test_source_rate_limiter.py`: `test_allows_requests_under_limit`, `test_blocks_when_limit_exceeded`, `test_refill_recovers_after_window`, `test_empty_or_invalid_config_allows`, `test_http_poller_skipped_when_source_rate_limited`, `test_load_stream_context_includes_source_rate_limit_json`. `tests/test_delivery_queue_restart_recovery_phase3.py`: `test_source_rate_limiter_still_applies_when_queue_empty`. `tests/test_delivery_queue_backpressure_phase5.py`: `test_l_source_rate_limiter_still_independent`. |
| **W11** | Route `retry_count` / `backoff_seconds` not on `routes` | **STILL_MISSING** (persist) | Runtime **loop exists**: `load_stream_context` copies `_get(route, "retry_count", 2)` / `_get(route, "backoff_seconds", 1.0)` into the in-memory route dict; `StreamRunner._apply_failure_policy` (`RETRY_AND_BACKOFF`) retries that many times. **Not persisted:** `Route` ORM (`app/routes/models.py`) has `failure_policy` only — no retry columns. `RouteBase` (`app/routes/schemas.py`) has no `retry_count` / `backoff_seconds`. Operators cannot save route-level knobs; production always gets defaults unless tests mutate `context.routes[i]`. Destination `config_json.retry_count` (webhook adapter inner loop) **is** persisted — different layer. | Persist: **none**. Runtime loop: `tests/test_stream_runner_e2e.py` `test_retry_and_backoff_success_updates_checkpoint_with_single_commit`, `test_retry_and_backoff_exhausted_does_not_update_checkpoint_with_single_commit` (inject keys on the loaded context). Same injection in `tests/test_runtime_observability_evidence.py`, `tests/test_stream_dedup_runtime.py`. |

**None of W2 / W9 / W10 / W11 is `BEHAVIOR_CHANGE_REQUIRED` as remaining work.** W2’s 4xx-FATAL change already landed (callers + tests assert a single 400 POST). Enabling production `jitter_ratio>0` would be a **future** timing behavior change (still classified PARTIALLY_IMPLEMENTED, not an open product-required flip).

### Residuals (do not re-open as “missing modules”)

- **Retry-After cap:** `RetryPolicy.delay_seconds` uses the header as-is; no `maxInterval` clamp (Connect pattern). Optional IMPROVE EXISTING on the same helper — not W2-missing.
- **`respect_retry_after`:** saved in stream `rate_limit` JSON (`tests/test_runtime_stream_rate_limit_save_endpoint.py`) but **unread** by `SourceRateLimiter`. 429 / Retry-After is owned by HTTP resilience (`HttpPoller.fetch`, `WebhookSender.send`), matching the limiter docstring. Not a stub-limiter gap.
- **AI adapter:** `should_retry_ai_provider_error` still classifies 4xx vs 5xx/429 independently of `ResponseClassifier` (`app/ai_providers/retry.py`). Canonical HTTP resilience is IMPLEMENTED on webhook/poller/OAuth/queue outcome; AI path is OUT_OF_SCOPE in the canonical destination table.
- **Lab EPS (W10):** DEV VALIDATION / DEV E2E streams set `rate_limit_json={"max_requests": 120, "per_seconds": 60}` (2 fetch tokens/s) with polling interval 1–4s (`lab_throughput_config.py`). Empty config allows. Token-bucket enforcement does **not** starve the 5–20 EPS band at current lab caps.
- **Webhook batch all-or-nothing** and **shutdown drain-complete** were P2 in the original audit; still IMPROVE EXISTING; not in W2–W11.

### New modules — wired, not orphan files

Verified against `StreamRunner` / `Scheduler` call sites (not directory listing):

| Module | Wired? | Key symbols | Tests |
| --- | --- | --- | --- |
| `app/http/resilience/classifier.py` + `retry_policy.py` | **Yes** | `ResponseClassifier.classify_response`, `RetryPolicy.delay_seconds` / `should_continue` | `test_http_resilience.py`, `test_http_resilience_callers.py` |
| `app/delivery/webhook_sender.py` | **Yes** | `WebhookSender.send` uses `_CLASSIFIER` + `RetryPolicy` | `test_http_resilience_callers.py` |
| `app/delivery/circuit_breaker.py` + `process_circuit_breaker.py` | **Yes** | `DestinationCircuitBreaker.allow` / `record_success` / `record_failure`; `StreamRunner._circuit_gate_destination_send`, `_circuit_record_destination_success`, `_circuit_record_destination_failure`; `get_process_destination_circuit_breaker`. CLOSED → OPEN → HALF_OPEN; 429/FATAL 4xx **not** counted (`is_circuit_failure_outcome`). Process-local; restart resets to CLOSED. | `tests/test_destination_circuit_breaker.py` (`test_b_c_d_threshold_opens_blocks_io_holds_queue`, `test_e_f_half_open_probe_success_closes`, `test_o_http_resilience_429_does_not_open_circuit`, `test_q_checkpoint_held_while_open`, …) |
| `app/delivery/adaptive_concurrency.py` + `process_adaptive_concurrency.py` | **Yes (opt-in)** | `DestinationAdaptiveConcurrency.try_acquire` / `release`; `resolve_adaptive_concurrency_config` (`enabled` default **False**); `StreamRunner._adaptive_acquire_destination_slot`. Canonical: IMPLEMENTED opt-in. | `tests/test_adaptive_destination_concurrency.py` (`test_a_adaptive_disabled_unchanged`, `test_b_healthy_increase`, …) |
| `app/delivery_queue/` | **Yes, path-dependent** | `uses_durable_destination_queue` (`reliability_mode=PERSISTENT_QUEUE` + `WEBHOOK_POST`/`SYSLOG_TCP`); `enqueue` / `claim_next` / `mark_delivered` / `mark_retry_wait`; `StreamRunner._recover_durable_webhook_queue`; `Scheduler._expire_durable_queue_leases_on_stop` → `force_expire_inflight_leases`. Default remains `DIRECT`. | `test_delivery_queue_foundation.py`, `test_delivery_queue_webhook_phase2.py`, `test_delivery_queue_restart_recovery_phase3.py`, `test_delivery_queue_syslog_tcp_phase4.py`, `test_delivery_queue_backpressure_phase5.py` |
| `app/rate_limit/source_limiter.py` | **Yes** | `SourceRateLimiter.allow` from `StreamRunner.run` | `test_source_rate_limiter.py` |
| `app/runners/stream_runner.py` retry / checkpoint | **Yes** | `_apply_failure_policy` RETRY_AND_BACKOFF; `_update_checkpoint_after_success` only when `successful_events` non-empty; durable path holds checkpoint until `mark_delivered` | `test_stream_runner_e2e.py` retry+checkpoint tests; queue phase-2 `test_a_normal_enqueue_claim_delivered_checkpoint` |
| `app/scheduler/scheduler.py` | **Yes** | `is_transient_scheduler_error`, `compute_scheduler_backoff_wait_sec` (no jitter); durable lease expire on worker stop | scheduler tests + queue recovery tests |
| Checkpoint / replay / DLQ | **Unchanged contract** | `CheckpointService.update_checkpoint_after_success`; `record_stream_replay_event` is still the delivery DLQ | `test_stream_runner_e2e.py`, `test_replay_engine_m11.py`, `test_replay_hardening_m11_1.py` |

### Pattern class updates vs original USE EXISTING / IMPROVE EXISTING / DO NOT ADOPT

OSS **runtimes** stay **REJECT / DO NOT ADOPT**. Data Relay **already implemented** several patterns the original matrix marked IMPROVE or absent:

| Pattern | Original class | Correct-branch class | Why |
| --- | --- | --- | --- |
| Retry classification (4xx FATAL, 429 RATE_LIMIT) | IMPROVE EXISTING | **USE EXISTING** | Shared `ResponseClassifier` wired in `WebhookSender.send` / `HttpPoller.fetch` |
| Retry-After (destination + source HTTP) | IMPROVE EXISTING | **USE EXISTING** | Header parsed in classifier; `RetryPolicy.delay_seconds` honors it. Residual: no max cap; `respect_retry_after` unused by limiter |
| Jitter | IMPROVE EXISTING | **IMPROVE EXISTING** (helper exists) | Algorithm in `RetryPolicy.apply_jitter`; production `jitter_ratio` still 0; scheduler/route loops unjittered |
| Bounded / persistent exporter queue (OTel/Vector/Fluent Bit/Telegraf) | DO NOT ADOPT | **DO NOT ADOPT** (unchanged REJECT) | Collector WAL/queue engines still a parallel delivery runtime |
| Data Relay `PERSISTENT_QUEUE` (PostgreSQL `stream_delivery_queue_items`) | claimed absent | **USE EXISTING** | Canonical reliability mode; WEBHOOK_POST + SYSLOG_TCP when `reliability_mode=PERSISTENT_QUEUE`; default DIRECT |
| Backpressure (source limiter stub) | IMPROVE EXISTING | **USE EXISTING** | Token bucket + durable-queue backpressure (`evaluate_backpressure`). `queue_delay_p95` still honestly unavailable |
| Circuit breaker (Camel EIP / Resilience4j) | DO NOT ADOPT | **DO NOT ADOPT** (library/EIP) **and** Data Relay process-local breaker **USE EXISTING** | `DestinationCircuitBreaker` is in-process, destination-keyed, no new failure engine, no Camel. Do not import Resilience4j |
| Acknowledgment / replay / DLQ / checkpoint | USE EXISTING | **USE EXISTING** | Checkpoint-after-success invariant preserved; queue ack is `mark_delivered` then checkpoint |
| Adaptive concurrency | not in original matrix | **USE EXISTING** (opt-in) | AIMD in `DestinationAdaptiveConcurrency`; disabled by default |

### Canonical cross-check (`docs/canonical/03-RUNTIME-RELIABILITY.md`)

| Canonical row | Code on 99dd3ba |
| --- | --- |
| HTTP resilience IMPLEMENTED | Matches `ResponseClassifier` + `RetryPolicy` callers |
| Source Rate Limiter IMPLEMENTED | Matches `SourceRateLimiter.allow` + `StreamRunner.run` |
| Destination Circuit Breaker IMPLEMENTED (process-local) | Matches `DestinationCircuitBreaker` + process singleton |
| Adaptive Concurrency IMPLEMENTED (opt-in) | Matches `enabled=False` default + runner acquire/release |
| `PERSISTENT_QUEUE` IMPLEMENTED for WEBHOOK_POST and SYSLOG_TCP when enabled | Matches `uses_durable_destination_queue` |
| `DIRECT` default | Matches `resolve_reliability_mode` |
| Checkpoint invariant | Matches `_update_checkpoint_after_success` gated on successful delivery / durable DELIVERED |
| OSS collectors as runtime | Still **REJECT** — durable queue is Data Relay PostgreSQL, not OTel `persistent_queue` |

### Reconciliation verdict (one paragraph)

On `99dd3ba`, W2 and W10 are **already implemented and tested** (classifier in `WebhookSender.send`, real source token bucket before fetch). W9 is **partial**: jitter math exists and is unit-tested but **not opted in** at webhook/poller/scheduler/route-retry sleep sites. W11 persist is **still missing** (no `routes.retry_count` / `backoff_seconds` columns or API fields); the RETRY_AND_BACKOFF **loop** already runs on in-memory defaults. Circuit breaker, durable queue, and opt-in adaptive concurrency are **wired into StreamRunner**, not leftover stubs. Keep rejecting OTel/Fluent Bit/Vector/Connect/Camel/Telegraf as a delivery runtime. Remaining IMPROVE EXISTING items: enable jitter at existing `RetryPolicy` call sites, optional Retry-After cap, persist route retry knobs if operators must tune RETRY_AND_BACKOFF, partial webhook batch, stop-interrupt of sleep.

---

## Historical verdict (original Agent 7 @ 1f270e8 — superseded for W2/W9/W10/W11)

Data Relay already owns a complete delivery reliability loop: poll/push → route processing → adapter send with retry/backoff → failure policy → Active/Standby failover → replay-event recording (delivery DLQ) → success-only checkpoint commit → runtime health scoring. OSS collectors implement **asynchronous exporter queues, disk WALs, end-to-end acks, and circuit-breaker EIPs** that would become a parallel delivery engine if adopted. Those runtimes are **DO NOT ADOPT**. **Correct-branch note:** the following original gap list is stale — webhook classification + dest Retry-After (W2) and `SourceRateLimiter` (W10) are implemented on `99dd3ba`; jitter (W9) is a helper with default-off; route retry persist (W11) remains; Data Relay now also has a process-local circuit breaker and path-dependent PostgreSQL durable queue. Do not import collector queues.

---

## 1. Architecture guardrail

```
One Stream
    ↓
Many Routes   (Transform → Protection → Classification → Policy → Delivery)
    ↓
Many Destinations
```

Forbidden if introduced because of OSS:

- Parallel Connector Runtime
- Parallel Delivery Engine
- Parallel Retry Engine
- Parallel Checkpoint Engine
- Parallel Governance Engine

Data Relay durability model (keep):

| Concern | Data Relay mechanism | Persistence |
| --- | --- | --- |
| Cursor / ack | Checkpoint after successful delivery | PostgreSQL `checkpoints` |
| Failed send payload | Stream replay events | PostgreSQL `stream_replay_events` |
| Policy hold | Quarantine events | PostgreSQL `stream_quarantine_events` |
| Operator evidence | Delivery logs + runtime snapshot | PostgreSQL `delivery_logs` + snapshot tables |

This is **not** a Fluent Bit chunk store or a Vector disk buffer. Treat those as pattern references only.

---

## 2. Data Relay implementation map

Cited as `path` → `symbol`. Paths below are under the reconcile workspace (`/home/aella/gdc-oss-reconcile`). Original Agent 7 citations used `/home/aella/gdc-platform` at `1f270e8`; **Correct-branch reconciliation above is authoritative for W2/W9/W10/W11.**

### 2.1 Pipeline owner

| Capability | File | Function / type |
| --- | --- | --- |
| Source → map → enrich → fan-out → checkpoint | `app/runners/stream_runner.py` | `StreamRunner.run`, `_fan_out`, `_send_route_events` |
| Shared send primitive (Route-ON and Route-OFF) | `app/runners/stream_runner.py` | `_send_route_events` |
| Route delivery disposition | `app/route_delivery/stage.py` | `route_delivery_stage`, `resolve_delivery_disposition` |
| Route send outcome | `app/route_delivery/config.py` | `RouteSendOutcome`, `RouteDeliveryResult` |
| Context load (retry defaults on in-memory route dict) | `app/runners/stream_loader.py` | `load_stream_context` (`retry_count`, `backoff_seconds`) |
| Push ingest (sync run, 409 on lock) | `app/ingest/router.py` | `ingest_webhook` |
| Webhook receiver | `app/runners/webhook_receiver.py` | `WebhookReceiver.dispatch` |
| Cross-process run lock | `app/runners/stream_runtime_lock.py` | `try_acquire`, `release` |

### 2.2 Retry / backoff

| Layer | File | Function | Behavior |
| --- | --- | --- | --- |
| Webhook adapter | `app/delivery/webhook_sender.py` | `WebhookSender.send` | Shared `ResponseClassifier` + `RetryPolicy`; 4xx FATAL (no retry except 408); 429 RATE_LIMIT + Retry-After; 5xx/timeout RETRY. **W2 ALREADY_IMPLEMENTED.** |
| HTTP poller (source) | `app/pollers/http_poller.py` | `HttpPoller.fetch` | Same classifier/policy; 429 Retry-After; other 4xx FATAL without retry |
| AI destination | `app/destinations/adapters/ai_provider_post.py` | `AiProviderPostDestinationAdapter.send` | Exponential backoff gated by `should_retry_ai_provider_error` |
| AI retry class | `app/ai_providers/retry.py` | `should_retry_ai_provider_error` | Retry 5xx, 429, timeout/connect; **no retry** on other 4xx |
| Route failure policy | `app/runners/stream_runner.py` | `_apply_failure_policy` | `LOG_AND_CONTINUE`, `PAUSE_STREAM_ON_FAILURE`, `DISABLE_ROUTE_ON_FAILURE`, `RETRY_AND_BACKOFF` |
| Route RETRY_AND_BACKOFF | `app/runners/stream_runner.py` | `_apply_failure_policy` (`policy == "RETRY_AND_BACKOFF"`) | Additional `retry_count` loops, sleep `backoff_seconds * 2**idx` |
| Scheduler cycle backoff | `app/scheduler/scheduler.py` | `is_transient_scheduler_error`, `compute_scheduler_backoff_wait_sec` | Transient connect/timeout classification; cap `min(300, interval * 2**min(failures, 5))` |
| Syslog | `app/delivery/syslog_sender.py` | `SyslogSender.send` / `_send_tls` | **No adapter-level retry**; relies on route `failure_policy` |
| Failover eligibility | `app/failover_routing/failover_eligibility.py` | `is_failover_eligible_error` | 5xx + connect/timeout; **not** 429; **not** other 4xx |

**W11 still missing (persist):** `Route` SQLAlchemy model (`app/routes/models.py`) has `failure_policy` but **no** `retry_count` / `backoff_seconds` columns. `stream_loader` uses `_get(route, "retry_count", 2)` which falls back to defaults unless tests inject keys. Destination webhook `retry_count` lives in destination `config_json` (adapter inner loop — not route persist).

**W2 closed:** `WebhookSender.send` classifies via `ResponseClassifier`; 400/401/404 are FATAL. Tests: `tests/test_http_resilience_callers.py` (`test_webhook_4xx_fatal_no_retry`). AI still uses `should_retry_ai_provider_error`; failover: `tests/test_failover_routing_m10.py` (`test_4xx_not_failover_eligible_except_handled_by_status`).

**W9 partial:** `RetryPolicy.apply_jitter` exists; production `jitter_ratio` defaults to 0. Scheduler `compute_scheduler_backoff_wait_sec` remains deterministic.

### 2.3 Rate limit / backpressure

| Capability | File | Function | Status |
| --- | --- | --- | --- |
| Destination EPS window | `app/rate_limit/destination_limiter.py` | `DestinationRateLimiter.allow` | Implemented (`max_events` / `per_seconds`) |
| Process-wide limiter | `app/rate_limit/process_destination_limiter.py` | `get_process_destination_rate_limiter` | Shared by runtime + replay |
| Source limiter | `app/rate_limit/source_limiter.py` | `SourceRateLimiter.allow` | **W10 ALREADY_IMPLEMENTED:** token bucket; empty config allows. Wired in `StreamRunner.run` before fetch. |
| Stream rate-limit save | `app/runtime/control_service.py` + `app/runtime/schemas.py` | `RuntimeStreamRateLimitSaveRequest` | Persists `max_requests` / `per_seconds` (enforced by limiter). `respect_retry_after` may be stored in JSON; limiter does not read it — 429 is HTTP resilience. |
| Destination skip | `app/runners/stream_runner.py` | `_send_route_events` | Sets `RATE_LIMITED_DESTINATION`, returns `rate_limited=True` |
| Push backpressure | `app/ingest/router.py` | `ingest_webhook` | HTTP **409** `RUN_ALREADY_ACTIVE` when lock held |
| Queue delay KPI | `app/platform_admin/health_summary.py` | `build_platform_health_summary` | `queue_delay_p95` **explicitly unavailable** |

### 2.4 Checkpoint / acknowledgement

| Capability | File | Function |
| --- | --- | --- |
| Success-only DB upsert | `app/checkpoints/service.py` | `update_checkpoint_after_success`, `update` |
| Model | `app/checkpoints/models.py` | `Checkpoint` |
| Stage + persist | `app/runners/stream_runner.py` | `_update_checkpoint_after_success`, `_flush_pending_writes` |
| Semantics | Checkpoint advances only when `successful_events` is non-empty; `LOG_AND_CONTINUE` absorbed route failures still allow `partial_delivery_success` | |

This **is** Data Relay’s acknowledgement: the stream cursor does not move until at least one route delivered (or absorbed per policy). It is **not** Vector-style source↔sink end-to-end ack.

### 2.5 Replay / DLQ / quarantine

| Capability | File | Function | Role |
| --- | --- | --- | --- |
| Record failed payload | `app/replay/recording.py` | `record_stream_replay_event` | Delivery-failure snapshot (max 500 events) |
| Eligibility | `app/replay/eligibility.py` | `is_replay_record_eligible` | Skip 429 / rate-limited / AI policy blocks |
| Replay / discard | `app/replay/service.py` | `replay_delivery_log` path, `discard_replay_event`, row `FOR UPDATE NOWAIT` | Operator-driven redelivery |
| Runtime hook | `app/runners/stream_runner.py` | `_maybe_record_replay_event` | After exhausted retry / failed send |
| Policy quarantine | `app/quarantine/` | `StreamQuarantineEvent`, `execute_quarantine_release` | **Not** a delivery DLQ; policy hold before send |
| Failover | `app/failover_routing/failover_engine.py` | `load_failover_bindings_by_primary` | Secondary destination on eligible primary failure |

Quarantine ≠ DLQ. Replay events **are** the product DLQ.

### 2.6 Queues / buffers (what exists vs what does not)

| Name | File | What it is |
| --- | --- | --- |
| Dedup insert queue | `app/runners/stream_dedup.py` | In-memory **processing** queue after extract; not a delivery buffer |
| HTTP client pool | `app/delivery/connection_pool.py` | Persistent `httpx.Client` reuse |
| Syslog TCP/TLS pool | `app/delivery/syslog_sender.py` | Socket reuse + stale-socket discard |
| Delivery exporter queue (OSS) | — | **DO NOT ADOPT** as a collector engine |
| Data Relay durable queue | `app/delivery_queue/` | **USE EXISTING** when `reliability_mode=PERSISTENT_QUEUE` for WEBHOOK_POST / SYSLOG_TCP (`enqueue`, `claim_next`, `mark_delivered`). Default `DIRECT` remains synchronous send. |
| Disk WAL / chunk store | — | **Does not exist** (and must not; PostgreSQL queue + checkpoint/replay instead) |

### 2.7 Circuit breaker

**Correct-branch:** process-local `DestinationCircuitBreaker` (`app/delivery/circuit_breaker.py`) is **wired** in `StreamRunner._circuit_gate_destination_send` (CLOSED → OPEN → HALF_OPEN, single probe). 429 / FATAL 4xx do not count. Restart resets to CLOSED; durable queue items survive. This is **USE EXISTING** Data Relay code. Camel Circuit Breaker EIP / Resilience4j remain **DO NOT ADOPT**.

Additional sticky operator controls (still valid):

- `DISABLE_ROUTE_ON_FAILURE` — opens the route until an operator re-enables (`_set_route_enabled`)
- `PAUSE_STREAM_ON_FAILURE` — pauses the stream
- Scheduler consecutive-failure backoff — slows polling; not the destination breaker

### 2.8 Partial batch / shutdown / health

| Topic | Evidence |
| --- | --- |
| Partial batch | `WebhookSender.send` loops batches; failure after retries raises `DestinationSendError` for the **whole send**. No per-item accept/reject. Checkpoint `partial_success` refers to **routes**, not events in a webhook batch. |
| Shutdown | `app/main.py` `lifespan` finally: `scheduler.stop()`; `Scheduler.stop` sets stop events and `thread.join(timeout=5.0)`. `control_service.stop_stream` waits `GDC_STREAM_STOP_WAIT_SEC` (default 5s) then confirms. Fluent Bit-style “drain then ack” is not implemented. |
| Health | `app/route_delivery/health.py` `classify_route_delivery_health`; `app/runtime/health_service.py` scores from `delivery_logs`; `app/runtime/health_router.py` `/api/v1/runtime/health/*`; snapshots in `app/runtime/runtime_snapshot_*`. P0 metrics (EPS, success rate, checkpoint, route health, delivery health) already exist. |

### 2.9 Errors

`app/runtime/errors.py`: `DestinationSendError` (optional `http_status`), `SourceFetchError`, `RateLimitError`, `CheckpointError`.

---

## 3. OSS clones inspected

Shallow clones under `/tmp/oss-audit-clones/` (reused existing Agent 4 clones). README was not the sole source; implementation files below were read.

| Project | Clone path | License (root / relevant) | Role in this audit |
| --- | --- | --- | --- |
| OpenTelemetry Collector | `opentelemetry-collector` | Apache-2.0 (`LICENSE`) | Exporter helper retry + memory/persistent queue |
| Fluent Bit | `fluent-bit` | Apache-2.0 (`LICENSE`) | Scheduler full jitter, `Retry_Limit`, filesystem chunks |
| Vector | `vector` | **MPL-2.0** (`LICENSE`, `lib/vector-core/LICENSE`) | Fibonacci retry + full jitter, disk buffer, e2e acks |
| Redpanda Connect | `connect` + `benthos` | **Mixed:** Apache-2.0 free bundle (`public/bundle/free/LICENSE`); Enterprise/RCL (`public/license/license.go` cites Redpanda Community License) | HTTP retry+jitter+Retry-After; retry/fallback outputs; nacks |
| Apache Camel | `camel` | Apache-2.0 (`LICENSE.txt`) | `RedeliveryPolicy`, `DeadLetterChannel`, Circuit Breaker EIP |
| Telegraf | `telegraf` | MIT (`LICENSE`) | Bounded metric buffer, partial-batch `Transaction`, disk buffer strategy |

**License flags (defer to Agent 8 for binding grades):**

- Vector MPL-2.0 is file-level copyleft if source is copied into Data Relay.
- Redpanda Connect enterprise files are **not** Apache-2.0; do not copy those modules.
- Even Apache-2.0/MIT collector **runtimes** remain **DO NOT ADOPT** as Data Relay delivery engines.

### 3.1 OpenTelemetry Collector — files

| Pattern | File | Symbol |
| --- | --- | --- |
| Retry + jitter + throttle | `exporter/exporterhelper/internal/retry_sender.go` | `retrySender.Send`, `NewThrottleRetry` |
| Permanent vs retryable | `consumer/consumererror/permanent.go` | `NewPermanent`, `IsPermanent` |
| Partial failed subset | `consumer/consumererror/signalerrors.go` | `NewLogs` / `NewMetrics` / `NewTraces` (`Retryable`) |
| Backoff config | `config/configretry/generated_config.go` | `BackOffConfig` (defaults: initial 5s, max interval 30s, multiplier 1.5, randomization 0.5, max elapsed 5m) |
| Memory queue + backpressure | `exporter/exporterhelper/internal/queue/memory_queue.go` | `Offer`, `blockOnOverflow`, `ErrQueueIsFull` |
| Persistent queue | `exporter/exporterhelper/internal/queue/persistent_queue.go` | file-storage-backed indices |
| Default queue | `exporter/exporterhelper/internal/queue_sender.go` | 1000 requests, 10 consumers, non-blocking when full |
| Shutdown interrupt of retry | `retry_sender.go` | `select` on `stopCh` → `experr.NewShutdownErr` |

### 3.2 Fluent Bit — files

| Pattern | File | Symbol |
| --- | --- | --- |
| Full jitter backoff | `src/flb_scheduler.c` | `backoff_full_jitter`, `flb_sched_request_create` (AWS “full jitter” article cited in-source) |
| Retry limit | `src/flb_output.c` | `retry_limit` config (`Retry_Limit`) |
| Filesystem chunks | `src/flb_storage.c` | `flb_storage_metrics_update` (mem vs fs chunks) |
| Shutdown retry | `flb_sched_request_create` | `config->is_shutting_down` → wait `0` then `+1` second |

### 3.3 Vector — files

| Pattern | File | Symbol |
| --- | --- | --- |
| Retry classification + partial retry | `src/sinks/util/retries.rs` | `RetryLogic`, `RetryAction::{Retry, RetryPartial, DontRetry, Successful}` |
| Fibonacci + full jitter | `src/sinks/util/retries.rs` | `FibonacciRetryPolicy`, `JitterMode::Full` |
| Disk buffer | `src/topology/builder.rs`, reload tests | `BufferType::DiskV2` |
| End-to-end acks | topology / source configs | `acknowledgements.enabled` |

Vector is a **pipeline runtime**, not a library Data Relay can drop in.

### 3.4 Redpanda Connect / Benthos — files

| Pattern | File | Symbol |
| --- | --- | --- |
| Shared backoff ctor | `connect/internal/retries/retries.go` | `CommonRetryBackOffCtorFromParsed` (`cenkalti/backoff`) |
| HTTP status class + jitter + Retry-After | `connect/internal/httpclient/transport_retry.go` | `retryTransport.RoundTrip`, `backoff` (Retry-After capped to `maxInterval`), `calculateBackoff` |
| Retry output (avoid reprocess) | `benthos/internal/impl/pure/output_retry.go` | `retry` output; comments point to `fallback` as DLQ |
| Retry processor | `benthos/internal/impl/pure/processor_retry.go` | child processors until success |
| Nack auto-retry | `benthos/public/service/input_auto_retry.go` | `AutoRetryNacks` |
| DLQ analog | fallback output (tests under `benthos/public/service/strict_fallback_test.go`) | `fallback:` YAML |

No first-class circuit-breaker type found under `benthos/` (Camel/Resilience4j is the circuit-breaker EIP reference).

### 3.5 Apache Camel — files

| Pattern | File | Symbol |
| --- | --- | --- |
| Redelivery | `core/camel-core-processor/.../RedeliveryPolicy.java` | exponential backoff, collision avoidance (±15%), `allowRedeliveryWhileStopping` |
| DLQ | `.../DeadLetterChannel.java` | after redelivery exhausted |
| Circuit breaker EIP | `core/camel-core-model/.../CircuitBreakerDefinition.java` | Resilience4j / MicroProfile Fault Tolerance |

Camel is an integration **framework**. Adopting it would be a parallel routing/delivery engine.

### 3.6 Telegraf — files

| Pattern | File | Symbol |
| --- | --- | --- |
| Bounded buffer + flush | `models/running_output.go` | `DefaultMetricBufferLimit = 10000`, `DefaultMetricBatchSize = 1000`, `BufferStrategy` / `BufferDirectory` |
| Partial batch | `models/buffer.go` | `Transaction.{Accept, Reject, InferKeep}` |
| Disk buffer | `models/buffer_disk_test.go` | disk vs memory strategies |

Telegraf is a metrics agent with a **metric buffer in front of outputs**. Same architectural mismatch as collector exporter queues.

---

## 4. Comparison matrix

Legend for **Data Relay** column: implemented / partial / absent.  
**Verdict** is the only adoption class for Data Relay planning (`USE EXISTING` | `IMPROVE EXISTING` | `REFERENCE ONLY` | `DO NOT ADOPT`).

| Pattern | Data Relay | OTel Collector | Fluent Bit | Vector | Redpanda Connect | Camel | Telegraf | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Retry | Adapter + `RETRY_AND_BACKOFF` + scheduler | `retrySender` | `Retry_Limit` + scheduler | `RetryLogic` + Fibonacci policy | HTTP `retryTransport` + `retry` output | `RedeliveryPolicy` | Output write retries via buffer | **USE EXISTING** |
| Retry classification | Shared `ResponseClassifier` in webhook + poller + OAuth + queue outcome; AI helper still separate | `IsPermanent` vs retryable | Plugin return codes | `is_retriable_error` / `DontRetry` | `retryStatuses` / `dropStatuses` | `onException` predicates | Startup retryable vs not | **USE EXISTING** |
| Exponential backoff | `2**n` in webhook, poller, AI, route retry; scheduler capped at 300s | `cenkalti/backoff` multiplier 1.5 | `base * 2^n` in jitter helper | Fibonacci (not pure exp) | `inner * 2^attempt` capped | `backOffMultiplier` (off by default) | Connect retry 15s (agent) | **USE EXISTING** |
| Jitter | **Helper exists** (`RetryPolicy.apply_jitter`); production `jitter_ratio=0`; scheduler/route loops unjittered | `RandomizationFactor` 0.5 | **Full jitter** (`backoff_full_jitter`) | **Full jitter default** | ±50% of delay | Collision avoidance 15% | Flush jitter on output interval | **IMPROVE EXISTING** |
| Retry-After | Webhook + poller + durable-queue `available_at`; HTTP-date ignored; **no max cap**; stream `respect_retry_after` unused by limiter | `NewThrottleRetry` delay | Not a first-class HTTP header in scheduler | Sink-specific | Header honored, **capped** to max interval | Not core EIP | N/A (metrics) | **USE EXISTING** |
| Bounded queue | Dest EPS window; ingest 409; **Data Relay PostgreSQL durable queue** when PERSISTENT_QUEUE (not an OSS exporter queue) | Memory queue capacity + `ErrQueueIsFull` | Chunk/storage limits | Memory/disk buffer bounds | `maxInFlight` / buffers | SEDA/thread pools (framework) | `MetricBufferLimit` | **DO NOT ADOPT** (no OSS exporter queue engine); Data Relay queue **USE EXISTING** |
| Persistent buffer | PostgreSQL checkpoint + replay + optional `stream_delivery_queue_items` | `persistent_queue.go` storage extension | Filesystem chunks (`flb_storage.c`) | `BufferType::DiskV2` | SQLite/disk buffers in some components | Persistent stores / JMS | `disk` / `disk_write_through` | **DO NOT ADOPT** (disk WAL / collector FS) |
| Backpressure | Dest limiter skip; ingest 409; **source token bucket**; durable-queue `evaluate_backpressure` | `blockOnOverflow` vs drop | Input pause / storage | Buffer backpressure tests | Nacks to source | Blocking endpoints | Buffer drop counters | **USE EXISTING** |
| Circuit breaker | Process-local `DestinationCircuitBreaker` (half-open probe); plus pause/disable route. **Not** Camel EIP | Not core exporterhelper | Not core | Not core retry | Not found in Benthos core | **Circuit Breaker EIP** | Not core | Data Relay breaker **USE EXISTING**; Camel/Resilience4j **DO NOT ADOPT** |
| Acknowledgment | Success-only checkpoint | Queue `waitForResult` / refcount | Chunk ack after flush | **Source↔sink acknowledgements** | `AckFunc` / nacks | Exchange completion | `Transaction.Accept` | **USE EXISTING** (checkpoint-as-ack) |
| Replay | `app/replay` operator replay | Re-read persistent queue | Re-ingest chunks | Replay from disk buffer | `auto_replay_nacks` | Redelivery | Re-flush buffer | **USE EXISTING** |
| DLQ | `stream_replay_events` (delivery); quarantine (policy) | Drop after max elapsed (not a named DLQ) | Drop after retry limit | Dead-letter sinks (optional) | `fallback` output | **`DeadLetterChannel`** | Drop / reject indices | **USE EXISTING** |
| Checkpoint | `CheckpointService.update_checkpoint_after_success` | Not a stream cursor (OTLP positions differ) | Tail DB / chunk offset | Source checkpoint + acks | Input offsets + acks | Idempotent consumer patterns | N/A (metrics) | **USE EXISTING** |
| Partial batch failure | Route-level partial; **webhook batch all-or-nothing** | `consumererror` retryable subset | Chunk granularity | `RetryPartial` | Per-message nack in batches | Split EIP | **`Transaction.Accept/Reject`** | **IMPROVE EXISTING** |
| Shutdown draining | 5s join / stop wait; no in-flight complete guarantee | Retry loop watches `stopCh` | Shutdown zeros retry delay | Topology drain | `Jeffail/shutdown` in retry output | `allowRedeliveryWhileStopping` | Flush remaining buffer | **IMPROVE EXISTING** |
| Health reporting | Runtime health scoring + snapshot + route health | Collector telemetry on queue/retry | cmetrics storage gauges | Internal metrics | Component metrics | Dev console / HealthCheck | selfstat write errors | **USE EXISTING** |

**Telegraf** is included in the narrative and license table; the user matrix columns were OTel / Fluent Bit / Vector / Redpanda / Camel. Telegraf patterns match “bounded buffer + partial batch” and remain **DO NOT ADOPT** as runtime.

---

## 5. Answers to the 15 investigation questions

### 1. Where is the capability implemented in Data Relay?

See §2 and the Correct-branch reconciliation. Delivery lives in `StreamRunner._send_route_events` → destination adapters (`WebhookPostDestinationAdapter` → `WebhookSender`, syslog, AI). `WebhookSender.send` uses `ResponseClassifier` + `RetryPolicy`. Retry is split: adapter loops + route `failure_policy`. Optional `PERSISTENT_QUEUE` enqueue/claim/`mark_delivered`. Checkpoint is `CheckpointService.update_checkpoint_after_success` committed in `_flush_pending_writes`. Replay DLQ is `record_stream_replay_event`. Health is `health_service` over `delivery_logs`.

### 2. Structure and limits of the current implementation?

**Strengths:** Stream-scoped cursor, per-route failure policy, failover eligibility already classifies 4xx vs 5xx, replay store, destination rate limit, operator health, connection pooling, success-only checkpoint (including `partial_delivery_success` when `LOG_AND_CONTINUE` absorbs some routes).

**Limits (updated 99dd3ba):** (a) **Closed W2** — webhook/poller classify 4xx FATAL. (b) **W9 partial** — jitter helper default-off; multi-stream 5xx can still synchronize. (c) **Closed W10** — `SourceRateLimiter.allow` is a real token bucket. (d) `respect_retry_after` saved on stream JSON is not wired to the limiter (429 is HTTP resilience). (e) **W11** Route retry knobs not on `routes` table. (f) Webhook/AI inner retry plus `RETRY_AND_BACKOFF` can multiply attempts. (g) Durable queue exists for PERSISTENT_QUEUE webhook/syslog TCP; DIRECT remains sync (by design). (h) Stop is timeout-based, not drain-complete; scheduler does expire IN_FLIGHT leases. (i) Syslog UDP/TLS have no durable queue. (j) Process-local half-open circuit exists; disable/pause remain sticky operator policy.

### 3. Which OSS files/modules are relevant?

OTel `retry_sender.go`, `permanent.go`, `signalerrors.go`, `memory_queue.go`, `persistent_queue.go`. Fluent Bit `flb_scheduler.c` (`backoff_full_jitter`), `flb_output.c` (`retry_limit`), `flb_storage.c`. Vector `src/sinks/util/retries.rs`. Redpanda `transport_retry.go`, Benthos `output_retry.go` / `processor_retry.go` / `input_auto_retry.go`. Camel `RedeliveryPolicy.java`, `DeadLetterChannel.java`, `CircuitBreakerDefinition.java`. Telegraf `running_output.go`, `buffer.go` (`Transaction`).

### 4. What would OSS reduce or improve if used?

If **adopted as runtime**: nothing Data Relay should take — it would duplicate Stream → Route → Destination. If **patterns are copied into existing files**: remaining items are jitter opt-in, Retry-After cap, persist route retry knobs, partial-batch indices, shutdown-interrupt of sleep. Those belong in `retry_policy.py` call sites, `stream_runner.py`, `source_limiter.py` / route models — not new engines. **W2 classification is already in `WebhookSender.send`.**

### 5. What duplicates existing Data Relay features?

Collector exporter queues duplicate (badly) what checkpoint + replay already guarantee for a poll-based stream, and now also overlap Data Relay’s own `PERSISTENT_QUEUE`. Camel DLQ duplicates `stream_replay_events`. Vector e2e acks duplicate checkpoint-after-success. Camel circuit breaker overlaps `DestinationCircuitBreaker` plus `DISABLE_ROUTE_ON_FAILURE` / `PAUSE_STREAM_ON_FAILURE`. Fluent Bit filesystem chunks duplicate PostgreSQL persistence with a different durability model.

### 6. Should OSS be added as a dependency?

**No** for Collector, Fluent Bit, Vector, Connect, Camel, Telegraf as delivery/retry/checkpoint libraries or sidecars. Optional micro-deps (e.g. a tiny jitter helper) are unnecessary; Python `random` is enough if jitter is added in-process.

### 7. Should code be adapted (source copy)?

**No** for queue/WAL/ack topology implementations. **Do not** copy Vector (`retries.rs` is MPL-2.0) or Redpanda Enterprise/RCL files. Apache-2.0 OTel/Fluent Bit/Camel **algorithms** may be reimplemented in Data Relay modules (jitter formula, permanent-error flag) without importing Go/Java.

### 8. Algorithms/patterns only?

**Yes**, for: remaining full-jitter **opt-in**, Retry-After **cap**, optional per-sub-batch failure recording. **No** for: OTel/Fluent Bit/Vector persistent exporter queues, disk buffers, Camel circuit-breaker EIP libraries, Vector acknowledgements graph. Data Relay already has its own queue + process-local breaker.

### 9. Connector Harvester source?

**Out of scope for Agent 7.** Harvester (Agent 4) may mine Telegraf/OTel/Fluent Bit/Camel **connector metadata**. That is not a delivery-runtime adoption path.

### 10. License usable?

- OTel, Fluent Bit, Camel, Telegraf (MIT): license-ok for **reference**; still **DO NOT ADOPT** as runtime.
- Vector: MPL-2.0 — **REFERENCE ONLY**; copying files into Data Relay has source-disclosure obligations on modified files.
- Redpanda Connect: Apache-2.0 **free** bundle vs **RCL** enterprise — **REFERENCE ONLY** for patterns in Apache-licensed HTTP retry; **DO NOT ADOPT** enterprise modules or the Connect runtime.

### 11. Does it invade Data Relay architecture?

**Yes, if adopted as runtime.** Exporter queues, disk buffers, Camel routes, and Vector topologies are parallel delivery engines. Pattern-only improvements **inside** `StreamRunner` / adapters **do not** invade architecture.

### 12. If applied, which Data Relay files would connect?

| Pattern improvement | Target files (existing only) |
| --- | --- |
| Retry classification (webhook) | **Done:** `webhook_sender.py` + `app/http/resilience/classifier.py` |
| Jitter opt-in | `RetryPolicy` call sites in `webhook_sender.py`, `http_poller.py`, `stream_runner.py` `_apply_failure_policy`, `scheduler.py` `compute_scheduler_backoff_wait_sec` |
| Retry-After max cap | `retry_policy.py` `delay_seconds` |
| Honor `respect_retry_after` on source limiter | Optional; 429 already handled by poller classifier |
| Persist route retry knobs | `app/routes/models.py` + alembic + `stream_loader.py` (schema change — high regression) |
| Partial batch | `webhook_sender.py` + replay recording of failed sub-batch only |
| Shutdown interrupt of sleep | retry loops checking scheduler stop event / `stop_stream` |
| Health | already `app/runtime/health_*`; optional `queue_delay_p95` only from existing durable-queue timestamps — do not add an OSS exporter queue |

### 13. What must not be applied?

- OTel/Fluent Bit/Vector/Connect/Camel/Telegraf as sidecar or in-process runtime
- Persistent exporter queue in front of destinations
- Vector disk buffer / Fluent Bit chunk FS as checkpoint replacement
- Camel Circuit Breaker EIP / Resilience4j
- Vector source acknowledgements replacing checkpoint
- New retry engine beside `_apply_failure_policy`
- Changing One Stream → Many Routes → Many Destinations
- Full Matrix / QA Lab / production config edits as part of this work

### 14. Implementation difficulty and regression risk?

| Item | Difficulty | Regression risk | Why |
| --- | --- | --- | --- |
| Classify webhook 4xx vs 5xx | — | **Done (W2)** | `WebhookSender.send` + tests in `test_http_resilience_callers.py` |
| Jitter opt-in | Low | Low | Timing-only; keep 0 jitter in tests via `jitter_ratio=0` or seed |
| Source limiter real enforcement | — | **Done (W10)** | Lab 120 req/60s vs 1–4s poll; empty config allows; do not tighten lab caps |
| Persist route retry columns | Medium | Medium | Loader/API/UI + migrations (**W11 still open**) |
| Partial batch success | High | High | Checkpoint and replay semantics; Runtime-First |
| Shutdown drain complete | Medium | Medium | Stop API + scheduler join vs in-flight HTTP |
| Exporter queue / disk WAL | — | **Unacceptable** | Architecture violation |

Required verification if those IMPROVE EXISTING items are ever implemented: focused pytest for delivery/retry/checkpoint, `tests/test_stream_runner_e2e.py` retry tests, webhook/syslog E2E, **do not** reduce E2E EPS.

### 15. Introduction priority?

| Priority | Item | Class |
| --- | --- | --- |
| **DONE (W2)** | Webhook/HTTP destination retry classification (do not retry 4xx except 429/408) | USE EXISTING |
| **DONE (W2)** | Destination `Retry-After` on webhook 429 | USE EXISTING |
| **P1 (W9)** | Opt in jitter on exponential backoff (adapters + scheduler) via existing `RetryPolicy.jitter_ratio` | IMPROVE EXISTING |
| **DONE (W10)** | `SourceRateLimiter` token bucket using saved `rate_limit_json` (lab 120/60; empty allows) | USE EXISTING |
| **P1 (W11)** | Persist `retry_count` / `backoff_seconds` on routes if operators must tune `RETRY_AND_BACKOFF` | IMPROVE EXISTING |
| **P2** | Interrupt backoff sleep on stream stop | IMPROVE EXISTING |
| **P2** | Sub-batch failure isolation for webhook `batch_size` | IMPROVE EXISTING |
| **DONE (optional half-open)** | Consecutive-failure half-open is `DestinationCircuitBreaker` (process-local) | USE EXISTING |
| **REJECT** | Any OSS collector/agent/Camel as delivery runtime; disk WAL; e2e ack topology; Resilience4j / Camel circuit-breaker library | DO NOT ADOPT |

---

## 6. Pattern notes (why each verdict)

### Retry — USE EXISTING

Data Relay already retries at three layers. Do not add OTel `retrySender` or Benthos `retry` output as a fourth. Nested retries (adapter × `RETRY_AND_BACKOFF`) should be documented/tuned, not replaced.

### Retry classification — USE EXISTING

`ResponseClassifier` / `HttpOutcome` implement the **idea** of `consumererror.IsPermanent` / Vector `DontRetry` / Connect `retryStatuses`. `WebhookSender.send` and `HttpPoller.fetch` call it. Do not import Go packages. Do not add a second classifier. AI `should_retry_ai_provider_error` remains a parallel helper (canonical AI destination is OUT_OF_SCOPE).

### Exponential backoff — USE EXISTING

Already `2**n`. OTel uses 1.5 multiplier and max interval; Data Relay webhook has **no max interval cap** (can sleep large). Optional cap is IMPROVE EXISTING on the same sleep lines, not a new library.

### Jitter — IMPROVE EXISTING

Fluent Bit `backoff_full_jitter` and Vector `JitterMode::Full` exist to avoid synchronized retry storms. Data Relay has `RetryPolicy.apply_jitter` but **defaults `jitter_ratio=0`**. Opt in at existing sleep sites. **REFERENCE ONLY** for the AWS full-jitter formula; **DO NOT ADOPT** Fluent Bit C scheduler.

### Retry-After — USE EXISTING

`HttpPoller.fetch` and `WebhookSender.send` parse `Retry-After` on 429 via `parse_retry_after_header` (delay-seconds only). Durable queue `compute_retry_available_at` reuses `RetryPolicy.delay_seconds`. Optional remaining IMPROVE EXISTING: cap to max interval (Connect pattern). Stream JSON `respect_retry_after` is unused by the source limiter by design (429 is HTTP resilience).

### Bounded queue — DO NOT ADOPT

A sized **OSS** exporter queue (`memory_queue.Offer`, Telegraf `MetricBufferLimit`, Vector memory buffer) is a **parallel delivery engine**. Data Relay’s unit of work is a stream run. Data Relay’s own `PERSISTENT_QUEUE` (`app/delivery_queue`) is PostgreSQL-backed and path/config dependent — **USE EXISTING**, not an OTel queue port.

### Persistent buffer — DO NOT ADOPT

`persistent_queue.go`, Fluent Bit FS chunks, Vector `DiskV2`, Telegraf disk buffer would bypass or duplicate PostgreSQL checkpoint/replay **and** Data Relay’s `stream_delivery_queue_items`. Crash durability of **failed** sends is already `stream_replay_events`. In-flight uncommitted DIRECT runs correctly do not advance checkpoint.

### Backpressure — USE EXISTING

Destination limiter, ingest 409, source token bucket, and durable-queue `evaluate_backpressure` exist. `queue_delay_p95` is honestly “not available”. Do not invent queue delay by adopting a collector queue.

### Circuit breaker — USE EXISTING (Data Relay) / DO NOT ADOPT (Camel EIP)

Camel `CircuitBreakerDefinition` / Resilience4j would be a **new** failure engine — still **DO NOT ADOPT**. Data Relay `DestinationCircuitBreaker` is process-local, destination-keyed, wired in `StreamRunner`, with half-open single probe. Existing `DISABLE_ROUTE_ON_FAILURE` / `PAUSE_STREAM_ON_FAILURE` remain operator sticky policy.

### Acknowledgment — USE EXISTING

Checkpoint-after-success **is** the ack. Vector `acknowledgements.enabled` couples source commit to sink success across an async topology Data Relay does not have. **DO NOT ADOPT** that graph.

### Replay — USE EXISTING

`app/replay/service.py` is operator replay with locking and rate-limit reuse. OSS “replay” is mostly “retry the queue.” Do not replace.

### DLQ — USE EXISTING

`record_stream_replay_event` is the DLQ. Camel `DeadLetterChannel` and Benthos `fallback` are the same **pattern** already implemented. Quarantine stays policy-side. **DO NOT ADOPT** Camel error-handler stack.

### Checkpoint — USE EXISTING

Hard preserve. OSS collector queues are not a substitute. `tests/test_stream_runner_e2e.py` (`test_retry_and_backoff_success_updates_checkpoint_with_single_commit`, exhausted path does not update) is the contract.

### Partial batch failure — IMPROVE EXISTING

Telegraf `Transaction.Accept/Reject` and OTel `consumererror` subset retry are the useful patterns. Data Relay webhook treats a failed sub-batch as total send failure (then route policy). Improving this means recording/retrying **failed batches only** in `WebhookSender` + replay, without changing stream-level checkpoint rules carelessly.

### Shutdown draining — IMPROVE EXISTING

OTel interrupts backoff on `stopCh`; Fluent Bit collapses retry delay when `is_shutting_down`. Data Relay `Scheduler.stop` / `stop_stream` join 5 seconds and may cut a sleep or HTTP call. Improve by checking stop events inside retry sleeps in **existing** loops. Do not add a collector-style queue drain.

### Health reporting — USE EXISTING

`classify_route_delivery_health`, `health_service`, runtime snapshot, platform health summary (except the honest missing queue p95). OTel/Fluent Bit internal metrics are for **their** engines. Do not add duplicate metric pipelines.

---

## 7. Mapping: OSS code → Data Relay → Gap → Integration → Method → Risk → Priority

| OSS | OSS module | Data Relay target | Gap | Reusable part | Adoption method | Risk | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| OTel | `consumererror.IsPermanent` | `webhook_sender.py`, `classifier.py` | **Closed (W2)** | Permanent vs retryable flag | REFERENCE_PATTERN (already reimplemented) | Low | DONE |
| OTel | `NewThrottleRetry` | `retry_policy.py` `delay_seconds` | Header honored; **no max cap** | Delay vs backoff `max()` | REFERENCE_PATTERN | Low | optional P2 |
| OTel | `retry_sender` stopCh | retry `time.sleep` sites | Stop during backoff | Cancel sleep | REFERENCE_PATTERN | Medium | P2 |
| OTel | `memory_queue` / `persistent_queue` | — | N/A (undesired OSS engine) | — | REJECT | Architecture | REJECT |
| Fluent Bit | `backoff_full_jitter` | `RetryPolicy.apply_jitter` | Helper exists; **not opted in** | Full jitter formula | REFERENCE_PATTERN | Low | P1 (W9) |
| Fluent Bit | `flb_storage` chunks | — | — | — | REJECT | Architecture | REJECT |
| Vector | `RetryLogic` / `RetryPartial` | webhook batches | All-or-nothing batch | Partial retry enum | REFERENCE_PATTERN (no file copy; MPL) | High if implemented | P2 |
| Vector | DiskV2 + e2e acks | — | — | — | REJECT | License + architecture | REJECT |
| Connect | `transport_retry.go` | webhook + poller | Classification + Retry-After **done**; jitter/cap residual | Status sets + cap | REFERENCE_PATTERN (Apache files only) | Low | residual P1–P2 |
| Connect / Benthos | `retry` / `fallback` outputs | — | Duplicates failure_policy + replay | — | REJECT | Parallel retry engine | REJECT |
| Camel | `RedeliveryPolicy` jitter | same as Fluent Bit jitter | — | Collision avoidance | REFERENCE_PATTERN | Low | P1 (W9) |
| Camel | `DeadLetterChannel` | `app/replay` | None | — | REJECT | Duplicate DLQ | REJECT |
| Camel | Circuit Breaker EIP | — | Data Relay breaker exists; **do not adopt EIP lib** | — | REJECT | Parallel failure engine | REJECT |
| Telegraf | `Transaction.Accept/Reject` | webhook batches | Partial batch | Index sets | REFERENCE_PATTERN | High | P2 |
| Telegraf | metric buffer / disk | — | — | — | REJECT | Parallel buffer | REJECT |

Adoption method vocabulary for Agent 9: `REFERENCE_PATTERN` or `REJECT` only. **No** `DIRECT_DEPENDENCY`, **no** `SOURCE_ADAPTATION` of collector runtimes.

---

## 8. What Data Relay already has (do not re-propose as new features)

- Exponential backoff on webhook, HTTP poll, AI, route `RETRY_AND_BACKOFF`, scheduler
- Shared HTTP `ResponseClassifier` + `RetryPolicy` (4xx FATAL, 429 Retry-After) — **W2**
- Route failure policies including pause/disable
- Process-local destination circuit breaker (half-open probe)
- Opt-in destination adaptive concurrency (AIMD)
- Path-dependent `PERSISTENT_QUEUE` for WEBHOOK_POST / SYSLOG_TCP (enqueue / claim / ack / restart recovery)
- Active/Standby failover with HTTP class
- Destination rate limiting (EPS window)
- Source rate limiting (token bucket) — **W10**
- Success-only checkpoint + staged commit
- Replay events (delivery DLQ) with eligibility
- Policy quarantine (separate from DLQ)
- Runtime health scoring and snapshots
- Delivery logs with `retry_count`
- Connection pooling
- Push ingest 409 backpressure
- Durable-queue backpressure (depth/age gates)
- Dedup processing queue (not a delivery buffer)

---

## 9. Architecture conflicts (exclude)

| Item | Why excluded |
| --- | --- |
| OTel Collector as exporter process | Parallel Delivery + Retry + Queue engines |
| Fluent Bit as shipper | Parallel runtime; chunk store vs checkpoint |
| Vector as pipeline | Parallel runtime; MPL; e2e acks vs checkpoint |
| Redpanda Connect / Benthos stream | Parallel routing/delivery; mixed license |
| Apache Camel context | Parallel routing + error-handler stack |
| Telegraf agent | Metrics buffer in front of outputs; not Stream/Route/Destination |
| Disk WAL in front of destinations | Bypasses checkpoint/replay contract |
| Resilience4j / Camel circuit breaker | Parallel failure engine (Data Relay already has `DestinationCircuitBreaker`) |

---

## 10. Unverified / residual

- Vector buffer crate path was observed via `BufferType::DiskV2` in topology tests; full `lib/vector-buffers` tree was not line-audited (clone is large). Pattern is still disk WAL — **DO NOT ADOPT**.
- Fluent Bit `tests/runtime` tree has dangling files that broke some glob searches; `src/flb_scheduler.c`, `src/flb_output.c`, `src/flb_storage.c` were read directly.
- Redpanda Connect **enterprise** component list was not exhaustively inventoried; `public/license/license.go` is enough to forbid RCL modules.
- Whether production operators rely on webhook **not** retrying 4xx is confirmed in tests (`test_webhook_4xx_fatal_no_retry`); live config sampling was not done.
- Reconciliation git HEAD is `99dd3bac886760460201f54deaaa282ec0e98bc1` on `audit/code-to-oss-fit-reconcile` (feature/post-m29-development). Original write-up at `1f270e8` is superseded for W2/W9/W10/W11.

---

## 11. Recommended next actions (planning only)

1. Keep Data Relay runtime; **REJECT** collector/agent/Camel adoption (unchanged).
2. Do **not** re-propose W2 classification or W10 source limiter as gaps.
3. Remaining IMPROVE EXISTING: W9 jitter opt-in at existing `RetryPolicy` call sites; W11 persist route retry columns if operators need them; optional Retry-After cap; P2 stop-interrupt / partial batch.
4. Do not add OSS exporter queues, disk buffers, or circuit-breaker **libraries**. Data Relay already has PostgreSQL durable queue + process-local breaker.
5. Agent 9 should mark Vector/Connect **runtime** rows as **CONFLICT** if other agents suggest dependency: this audit says **REJECT**.

---

## Document control

| Field | Value |
| --- | --- |
| Agent | 7 — Delivery / Reliability Pattern Audit; Agent B reconciliation 2026-08-29 |
| Output | `docs/audits/oss/07-runtime-reliability-audit.md` |
| Implementation | None (audit only) |
| Reconcile HEAD | `99dd3bac886760460201f54deaaa282ec0e98bc1` |
| OSS runtimes as Data Relay runtime | Forbidden (REJECT) |
| Classification vocabulary | USE EXISTING \| IMPROVE EXISTING \| REFERENCE ONLY \| DO NOT ADOPT |
| W2/W9/W10/W11 | ALREADY_IMPLEMENTED \| PARTIALLY_IMPLEMENTED \| STILL_MISSING \| BEHAVIOR_CHANGE_REQUIRED |
