# Fan-out Parallelization Review

**OSS v1.0.1 Sprint 6 — design-only (implementation excluded)**

## Current Model

StreamRunner executes one poll cycle per enabled stream on a dedicated scheduler worker thread. After Mapping and Enrichment, the pipeline evaluates Protection, Policy, optional Dynamic Routing, then **sequentially** iterates enabled routes in `_fan_out`:

1. Resolve destination adapter and rate limits per route.
2. Optionally load failover bindings and attempt secondary delivery on eligible failures.
3. Send the full event batch to each route destination (HTTP webhook, syslog, AI provider post, etc.).
4. Track per-route success under route `failure_policy` (`REQUIRE_ALL` vs `LOG_AND_CONTINUE`).
5. Advance checkpoint only when all required routes succeed for the batch.

Dynamic-route deliveries and failover attempts are also serialized within the same worker thread. Source and destination rate limiters are process-local and keyed by stream/route.

## Checkpoint Constraint

Checkpoint updates occur **only after successful destination delivery** for the batch (constitution + specs 002/004). The checkpoint cursor is derived from the last successfully delivered enriched event.

Parallel fan-out would mean multiple destinations completing at different times while sharing one checkpoint decision:

- A slow or failing route could block or race checkpoint advancement.
- Partial parallel success would require a new consensus rule (which route’s success defines “delivered”?).
- Failover and dynamic routing already add alternate paths; parallelizing base routes increases ordering ambiguity without changing the checkpoint contract.

**Conclusion:** Any parallel fan-out must preserve a single, deterministic checkpoint outcome per batch. That requires additional coordination (barriers, per-route delivery state, revised partial-success semantics) beyond OSS v1.0.1 scope.

## Failure Model

Today’s model is intentionally simple:

| Policy | Behavior |
|--------|----------|
| `REQUIRE_ALL` | One route failure fails the batch; checkpoint not advanced. |
| `LOG_AND_CONTINUE` | Failed routes logged; batch may still checkpoint if all `REQUIRE_ALL` routes succeed. |

Parallel sends introduce:

- Non-deterministic failure ordering in logs and metrics.
- Harder replay: replay eligibility ties to stored delivery_logs and checkpoint boundaries.
- Rate-limit interactions: concurrent sends to the same destination could bypass existing limiter semantics unless limiters become async-aware.

## Ordering Impact

Sequential fan-out preserves stable log ordering (`route_send_*` stages) and predictable retry/backoff per route. Parallel delivery would interleave HTTP attempts, complicating:

- Delivery log correlation by `run_id`.
- Run-level timing attribution (Sprint 6 `timing_trace_ms`).
- Operator debugging in Stream Runtime UI.

## Expected Gain

Rough upper bound for typical OSS deployments (1–3 routes, small batches):

| Scenario | Sequential today | Parallel (theoretical) | Net gain |
|----------|------------------|------------------------|----------|
| 2 webhooks ~300ms each | ~600ms destination_send | ~300ms + overhead | ~40–50% of destination phase |
| 1 route | No benefit | No benefit | ~0% |
| AI + webhook mixed latency | Dominated by slowest route | Similar wall clock | Low unless routes are symmetric |

Scheduler context cache (S4-04) and slimmer delivery_logs (Sprint 5) already reduce overhead outside destination I/O. Parallel fan-out helps only when **multiple slow destinations** share a batch **and** checkpoint/failure rules are redesigned.

Estimated platform-wide impact for median stream: **low to moderate** (destination_send is often one route or dominated by source fetch).

## Risk Analysis

| Risk | Severity | Notes |
|------|----------|-------|
| Checkpoint regression | **High** | Violates core invariant if parallel success is mis-counted. |
| Replay / quarantine inconsistency | **High** | Ordering and idempotency assumptions break. |
| Rate limiter correctness | **Medium** | Process-local limiters not thread-safe for concurrent route sends without refactor. |
| Operational complexity | **Medium** | Debugging parallel failures requires tracing tooling (explicitly out of scope: OpenTelemetry). |
| Test / regression cost | **High** | Full e2e matrix (failover, dynamic routing, AI gateway) must be re-validated. |

## Decision

### **NO-GO** for OSS v1.0.1

Rationale:

1. Checkpoint-after-success is non-negotiable and not compatible with naive parallel fan-out.
2. Failure policies and replay semantics assume sequential, deterministic route evaluation.
3. Expected gain is limited for typical single- or dual-route streams and does not justify regression risk in this stabilization sprint.
4. Sprint 6 scope explicitly forbids fan-out implementation; overhead reduction is better served by context caching and observability.

### Future considerations (post OSS v1.0.1)

If revisited, a viable approach would be:

- Parallel **network I/O only** with a join barrier before checkpoint.
- Explicit per-route delivery ledger for the batch.
- Async-aware rate limiters and structured run sub-spans (not raw multi-threading of the full pipeline).

Until those prerequisites exist, maintain sequential fan-out in StreamRunner.
