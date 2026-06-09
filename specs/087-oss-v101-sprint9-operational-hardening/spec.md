# OSS v1.0.1 Sprint 9 — Operational Hardening

## Status

Implemented (S4-14 Cumulative Metrics Cache, S4-15 Replay Rate Limiter).

## Scope

- Ingest committed delivery_logs into incremental read model on run/replay complete.
- Governance/dashboard KPI reads use cumulative cache (same formulas, SQL fallback).
- Replay destination sends respect shared `DestinationRateLimiter`.

## Excluded (unchanged)

SSO/SAML/OIDC, Enterprise IAM, Fan-out parallelization, multi-node, OpenTelemetry.

## S4-14 Cumulative Metrics Cache

- `app/logs/incremental_aggregates.ingest_delivery_log_row`
- `app/runtime/cumulative_metrics_cache.get_window_kpi_counts`
- StreamRunner ingests after commit; replay observability logs ingest on flush.
- Governance `_build_24h_delivery_log_metrics` uses cache first.

## S4-15 Replay Rate Limiter

- `app/rate_limit/process_destination_limiter.py` — process-wide limiter.
- `execute_replay_event` checks route/destination `rate_limit_json` before send.
- Raises `ReplayEventStateError(REPLAY_DESTINATION_RATE_LIMITED)` when throttled.

## Regression

Dashboard, Replay, Failover, Policy, Classification, AI Gateway suites must remain PASS.
