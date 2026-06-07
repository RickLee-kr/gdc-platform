# 075 — Governance Policy Impact Analysis (M18.2)

## Goal

Preview-only impact analysis for Named Policies using existing runtime telemetry (delivery_logs, sensitive_findings). No runtime enforcement wiring.

## Scope

### In scope

- `GET /api/v1/governance/policies/{id}/impact`
- `POST /api/v1/governance/policies/impact-preview`
- 24h window aggregates: total events, matched events, action breakdown, stream breakdown, delta vs saved policy
- Policy Editor Impact Panel and catalog impact summary
- Fallback when runtime data is insufficient (non-error)

### Out of scope

- Runtime enforcement
- Policy Simulation (M18.3)
- Lifecycle (M18.4)
- Dashboard redesign (M18.5)

## Data sources

- `delivery_logs` — `classification_complete`, `protection_complete`, `quarantine_event_created`, `policy_evaluation_complete`
- `stream_sensitive_findings` — sensitivity / field conditions
- `stream_policy_assignments` — scope

## Architecture

Reuses M18.1 `governance_policies.policy_json` validation and assignment scope. Analysis is read-only aggregation; events are never mutated.
