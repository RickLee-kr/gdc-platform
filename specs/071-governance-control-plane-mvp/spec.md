# 071 — Governance Control Plane MVP (M15)

## Goal

Provide a **Data Control Governance Center** that aggregates configuration counts, pending operational work, and recent activity across existing data-control engines — without new engines or editors.

## Scope

### In scope

- `GET /api/v1/governance/summary` — platform-wide governance snapshot
- Governance dashboard UI (sidebar: **Governance**)
- Risk overview strip (RESTRICTED / CONFIDENTIAL / quarantine / replay / AI Gateway blocks)
- Cross-links from dashboard cards to **existing** detail screens (stream runtime panels, AI Gateway page, logs explorer)

### Out of scope

- New engines, policy actions, or changes to Classification / Protection / Replay / AI Gateway runtime behavior
- New rule/route/policy editors
- New delivery_logs stages (reuse existing observability only)

## Architecture

Governance is a **read-only control plane** that composes existing platform summaries and bounded `delivery_logs` window queries.

```text
GovernanceSummaryService
  ├─ rule/route counts (SQL COUNT on existing tables)
  ├─ pending counts (stream_quarantine_events, stream_replay_events)
  ├─ cumulative classification distribution (latest classification_complete per stream)
  └─ recent_24h activity (delivery_logs + ai_gateway_requests)
```

No StreamRunner or pipeline stage changes.

## API

### `GET /api/v1/governance/summary`

Auth: same read RBAC as runtime summary endpoints.

Response (additive fields; all integers ≥ 0):

| Field | Source |
|-------|--------|
| `classification_rules` | `stream_classification_rules` count |
| `protection_rules` | `stream_protection_rules` count |
| `policy_rules` | `stream_policy_rules` count |
| `dynamic_routes` | `stream_dynamic_routes` count |
| `failover_routes` | `stream_failover_routes` count |
| `pending_replay_events` | `stream_replay_events` where status=pending |
| `pending_quarantine_events` | `stream_quarantine_events` where status=quarantined |
| `ai_gateway_policies` | `ai_gateway_policies` count |
| `recent_24h.classified_events` | `delivery_logs` stage `classification_complete` |
| `recent_24h.protected_events` | sum `protected_event_count` from `protection_complete` |
| `recent_24h.quarantined_events` | `delivery_logs` stage `quarantine_event_created` |
| `recent_24h.replayed_events` | `delivery_logs` stage `replay_event_replayed` |
| `recent_24h.blocked_ai_requests` | `ai_gateway_requests` decision=block |
| `risk_overview.restricted_events` | cumulative restricted from classification metrics |
| `risk_overview.confidential_events` | cumulative confidential from classification metrics |
| `risk_overview.quarantine_pending` | same as `pending_quarantine_events` |
| `risk_overview.replay_pending` | same as `pending_replay_events` |
| `risk_overview.ai_gateway_blocks` | cumulative `ai_gateway_requests` decision=block |
| `cards.*` | per-domain `rule_count`, `pending_count`, `recent_activity_count`, `last_activity_at`, `top_stream_id` |

## UI

- Route: `/governance`
- Cards: Classification, Protection, Policy, Quarantine, Replay, AI Gateway
- Each card: Rule Count, Pending Count, Recent Activity (24h)
- Card click navigates to existing screens (no new editor)

## Observability

Reuse `delivery_logs` stages documented in M5–M14 specs. Governance queries are bounded to a rolling 24h window on `created_at`.

## Tests

- Summary API shape and aggregation
- Dashboard rendering (cards + risk overview)
- Cross-link targets
- Empty state (zero counts)
- Large count formatting
