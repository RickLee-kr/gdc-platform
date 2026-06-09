# OSS v1.0.1 Sprint 5 — Runtime Copy & delivery_logs Optimization

## Status

Implemented (S4-07 deepcopy optimization, S4-08 delivery_logs lightweight persistence).

## Scope

- Reduce CPU/memory from redundant `deepcopy` in Mapping, Enrichment, Protection, Checkpoint, Replay, and `delivery_logs` persistence.
- Slim `payload_sample` and drop duplicate low-value stage rows per run.
- **No new product features.** Excluded: fan-out parallelization, scheduler cache, OpenTelemetry, multi-thread runtime.

## Invariants (unchanged)

- StreamRunner remains the transaction owner.
- Checkpoint updates only after successful destination delivery.
- Mapping and Enrichment remain separate stages.
- Replay manual recovery must keep `replay_events` / `events` / `enriched_events` on failed delivery rows.
- Structured delivery failure logs remain persisted.

## S4-07 Deepcopy Optimization

- `app/runtime/copy_utils.py`: `copy_json_value` deep-copies dict/list only; scalars pass through.
- Hot paths use `copy_json_value` / `copy_events` instead of blanket `deepcopy`.
- Protection still deep-copies per event when rules mutate in place.

## S4-08 delivery_logs Optimization

- `app/logs/payload_sample.py`: whitelist + slim checkpoint previews + bounded replay event copies.
- `StreamRunner._persist_delivery_log` stores `build_delivery_log_payload_sample(payload)` (no full-payload deepcopy).
- Low-value per-run rows moved to logger-only `_emit_obs`: `route` fan-out start, mapping/enrichment completion summaries.

## Regression

Replay, Failover, AI Gateway, Protection, Policy, Governance test suites must remain PASS.

## Measurement

Sprint 5 tests assert fewer persisted rows per successful run and smaller checkpoint payloads in `payload_sample` vs full event bodies.
