# OSS v1.0.1 Sprint 8 — Replay Engine Optimization

## Status

Implemented (S4-12 Replay Queue N+1 removal, S4-13 Replay index optimization).

## Scope

- Batch quarantine lookup for Governance Replay list (in-memory join).
- Composite indexes on `stream_replay_events` for list/queue queries.

## Excluded (unchanged)

SSO/SAML/OIDC, Enterprise IAM, Fan-out parallelization, multi-node, OpenTelemetry.

## S4-12 Replay Queue N+1 Removal

- `app/governance_replay/service.py`:
  - `_load_quarantine_for_replays`: single SELECT for all stream_ids in list batch.
  - In-memory match: latest quarantine with `created_at <= replay.created_at`.
  - `list_governance_replay_events` passes preloaded map to `_row_to_entry`.

## S4-13 Replay Index Optimization

- Migration `20260609_0052_replay_list_indexes`:
  - `idx_stream_replay_events_created_at_id` — `(created_at DESC, id DESC)` for window list.
  - `idx_stream_replay_events_status_created_at_id` — `(status, created_at DESC, id DESC)` for status queues.

## Regression

Replay, Governance, Quarantine, AI Gateway, Policy, Classification suites must remain PASS.

## Measurement

Sprint 8 tests assert replay list query count does not scale with row count for quarantine lookup.
