# OSS v1.0.1 Sprint 6 — Runtime Overhead Reduction & Observability Foundation

## Status

Implemented (S4-04 Scheduler Context TTL Cache, S4-11 Run-Level Timing Trace, Fan-out design review).

## Scope

- TTL + fingerprint cache for scheduler `load_stream_context` path (checkpoint always fresh).
- Run-level wall-clock timing trace on `run_complete` delivery_logs rows.
- Fan-out parallelization design review only (no implementation).

## Excluded (unchanged)

- Fan-out parallelization, multi-thread runtime, OpenTelemetry, Prometheus, distributed tracing, enterprise auth.

## S4-04 Scheduler Context TTL Cache

- `app/scheduler/context_cache.py`: process-local TTL cache (default 45s) keyed by stream_id.
- Invalidation: explicit `invalidate_stream_context_cache`, TTL expiry, config fingerprint change (`updated_at` on stream/source/mapping/enrichment/routes/destinations).
- Metrics: hits, misses, invalidations, version_invalidations, ttl_expirations, load_latency_ms_total.
- Scheduler poll loop uses `load_scheduler_stream_context`; manual/API paths keep `load_stream_context`.

## S4-11 Run-Level Timing Trace

- `app/runners/run_timing.py`: `RunTimingTrace` + `PhaseTimer`.
- `run_complete.payload_sample` includes `run_duration_ms` and `timing_trace_ms` (source_fetch, parse, mapping, enrichment, schema_drift, sensitive_detection, classification, protection, policy, routing, destination_send, checkpoint, run_total).
- `run_complete.latency_ms` set to run wall-clock total.

## Fan-out Review

- `docs/architecture/FANOUT_PARALLELIZATION_REVIEW.md` — decision: **NO-GO** for OSS v1.0.1 (checkpoint + failure model constraints).

## Regression

Scheduler, Replay, Failover, Dynamic Routing, AI Gateway suites must remain PASS.

## Measurement

Sprint 6 tests assert cache hit/miss metrics, reduced DB queries on cache hit, fresh checkpoint on hit, and run_complete timing trace presence/accuracy.
