# OSS v1.0.1 Sprint 7 — Sensitive Detection Batch Upsert

## Status

Implemented (S4-09 Sensitive Detection Batch Upsert).

## Scope

Replace per-hit SELECT + INSERT/UPDATE in `persist_sensitive_hits` with batch aggregate + bulk load + batched writes.

## Excluded (unchanged)

SSO/SAML/OIDC, Enterprise IAM, Fan-out parallelization, multi-node, OpenTelemetry.

## S4-09 Batch Upsert

- `app/sensitive_detection/detection.py`:
  - `_aggregate_hits`: one entry per `(field_path, sensitivity_class)` per batch.
  - `_load_existing_findings_map`: single SELECT for all candidate keys.
  - `_load_related_drift_ids_map`: single SELECT for drift links.
  - `_upsert_sensitive_hits_batch`: `add_all` for inserts + `bulk_update_mappings` for updates.
- Semantics unchanged: confirm gate, resolved-not-reopened, unique constraint per stream/path/class.

## Regression

Sensitive Detection, Protection, Policy, Classification, Replay, AI Gateway suites must remain PASS.

## Measurement

Sprint 7 tests assert reduced DB query count on multi-hit batches vs O(hits) per-hit pattern.
