# 073 — Operational UX & Observability Cleanup (M16.3)

## Scope

Operational UX cleanup only — no new engines, runtime features, or subsystem behavior changes.

## Goals

1. Fix Governance → Logs Explorer stage drill-down parity (shared stage enum, no empty-table false negatives).
2. Disambiguate platform `/runtime` vs stream `/streams/:id/runtime` in labels only (URLs unchanged).
3. Hide stream Runtime History placeholder tabs without data.
4. Fix Governance empty-state CTAs to point at configurable surfaces.
5. Document delivery_logs stage inventory and observability coverage.
6. Audit navigation dead paths.

## Non-goals

- New classification, protection, policy, replay, failover, or AI Gateway behavior.
- URL route changes.
- Backend stage writer changes (documentation-first for unused stages).

## Acceptance

- Governance card links use `GOVERNANCE_LOG_DRILLDOWN_STAGES` constants.
- Logs Explorer shows rows when `?stage=` matches API filter (no conflicting client pipeline filter).
- Stream Runtime History shows Run History only.
- Governance no-rules state links to Streams list with setup guidance (no false AI Gateway config CTA).
- Tests cover navigation, stage parity, history tabs, empty state, streams virtualization threshold.
- Architecture reports under `docs/architecture/m16-3-*`.
