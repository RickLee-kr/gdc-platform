# 074 — Governance Policy Builder MVP (M18.1)

## Goal

Named Policy CRUD, stream assignment, and evaluation preview for Governance Operators.

## Scope

### In scope

- `governance_policies` and `stream_policy_assignments` tables
- `GET/POST/PUT/DELETE /api/v1/governance/policies`
- Assignment and preview endpoints
- Policy Catalog UI at `/governance/data-protection`
- Guided Policy Editor (Advanced mode placeholder)

### Out of scope

- Impact Analysis (M18.2)
- Simulation (M18.3)
- Lifecycle review flow (M18.4)
- Governance Dashboard redesign (M18.5)
- Runtime policy enforcement wiring (preview-only in M18.1)

## Policy JSON (MVP)

```json
{
  "conditions": [{ "field": "classification", "operator": "equals", "value": "RESTRICTED" }],
  "actions": [{ "type": "quarantine" }]
}
```

Operators: `equals`, `not_equals`, `contains`  
Actions: `quarantine`, `tokenize`, `mask`, `audit_only`

## Architecture

Named policies are a **catalog layer** reusable by M18.2 Impact Analysis. Stream assignments link policies to execution units without changing StreamRunner behavior in M18.1.

### Relationship to M8 `stream_policy_rules`

| Layer | Table | Enforced at runtime |
|-------|-------|---------------------|
| Named Policy (M18.1) | `governance_policies`, `stream_policy_assignments` | No |
| Policy Engine (M8) | `stream_policy_rules` | Yes (StreamRunner) |

No FK or sync between layers in M18.1. UI must state **Preview only** and **Runtime enforcement not enabled**.

### Persona

- Governance Operator: CRUD + assignment
- Connector Operator: read-only view (no New/Delete/Save)
