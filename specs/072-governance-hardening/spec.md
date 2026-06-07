# 072 — Governance Hardening & Operational Readiness (M15.1)

## Goal

Harden the M15 Governance Control Plane for production operators: bounded summary queries, accurate risk alignment, empty-state UX, activity timeline, and health indicators — **without new engines** or changes to Classification / Protection / Policy / Replay / AI Gateway runtime.

## Scope

### In scope

- `GET /api/v1/governance/summary` performance (single bounded `delivery_logs` aggregate, no full-table `ai_gateway_requests` scan)
- Additive response fields: `has_governance_rules`, `health`, `activity_timeline`
- `risk_overview.ai_gateway_blocks` aligned with `recent_24h.blocked_ai_requests` (24h window)
- Dashboard: no-rules empty state, health banner, 24h activity timeline, risk cross-links
- Tests and operational verification

### Out of scope

- Engine or pipeline changes
- New editors or write APIs

## API additions

| Field | Description |
|-------|-------------|
| `has_governance_rules` | true when any classification/protection/policy/AI Gateway policy rule exists |
| `health.status` | `healthy` / `warning` / `critical` from pending quarantine/replay and 24h AI blocks |
| `activity_timeline[]` | Recent `classification_complete`, `quarantine_event_created`, `replay_event_replayed`, `ai_gateway_evaluation_complete`, and AI block events (24h, capped) |

## Health thresholds

| Signal | Warning | Critical |
|--------|---------|----------|
| `pending_quarantine_events` | ≥ 5 | ≥ 25 |
| `pending_replay_events` | ≥ 5 | ≥ 25 |
| `ai_gateway_blocks_24h` | ≥ 10 | ≥ 50 |

## Performance

- One conditional-aggregate query for 24h `delivery_logs` stage metrics
- One grouped query for per-stage `last_activity_at` within 24h
- One bounded `ai_gateway_requests` count for 24h blocks (reused for risk + health)
- No unbounded `MAX(created_at)` on full `delivery_logs` history

## Tests

- Summary bounded aggregation and risk/health alignment
- Dashboard no-rules state, health, timeline, cross-link fallbacks
- Large count locale formatting (frontend)
