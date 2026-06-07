# 078 — Governance Dashboard (M18.5)

## Goal

Reconfigure Governance Dashboard from engine-centric to policy-centric UX for Governance Operator.

## Scope

### In scope

- Extend `GET /api/v1/governance/summary` with `policy_dashboard` aggregates
- Policy KPI strip: Active, Review, Draft, Retired lifecycle counts
- Top KPI: Active Policies, Policies In Review, Quarantined Events (pending), Replayed Events (24h)
- Policy Activity Timeline (lifecycle events)
- Policy Catalog Summary (top 10)
- Risk Overview — top policies by 24h impact
- Quarantine Summary — 24h / 7d / 30d counts
- Replay Summary — 24h / 7d / 30d counts
- Frontend dashboard redesign — remove engine cards
- Empty state when no named policies
- Connector Operator read-only banner unchanged (M17.4)

### Out of scope

- Runtime enforcement wiring
- Approval workflow
- Policy Engine / Quarantine Engine / Replay Engine changes
- New runtime data generation

## API

`GET /api/v1/governance/summary` adds:

```json
{
  "policy_dashboard": {
    "has_policies": true,
    "policy_kpi": { "active": 2, "review": 1, "draft": 1, "retired": 0 },
    "dashboard_kpi": {
      "active_policies": 2,
      "policies_in_review": 1,
      "quarantined_events": 4,
      "replayed_events": 12
    },
    "policy_activity_timeline": [],
    "policy_catalog": [],
    "top_policies_by_impact": [],
    "quarantine_summary": { "h24": 0, "d7": 0, "d30": 0 },
    "replay_summary": { "h24": 0, "d7": 0, "d30": 0 }
  }
}
```

## Data sources

| Field | Source |
|-------|--------|
| Policy counts | `governance_policies.status` |
| Impact ranking | M18.2 `impact_summary_for_policy` |
| Quarantine / Replay windows | `delivery_logs` stages; fallback to engine tables |
| Pending quarantine | `build_platform_quarantine_summary` |
| Replayed 24h KPI | `recent_24h.replayed_events` |

## Empty state

When `policy_dashboard.has_policies` is false: CTA to Data Protection and Streams. API errors must not crash the dashboard.
