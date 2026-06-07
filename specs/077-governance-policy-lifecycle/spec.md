# 077 — Governance Policy Lifecycle (M18.4)

## Goal

Named Policy lifecycle management: DRAFT → REVIEW → ACTIVE → RETIRED with forward-only transitions.

## Scope

### In scope

- `governance_policies.status` enum: DRAFT, REVIEW, ACTIVE, RETIRED
- `activated_at`, `retired_at` columns
- Lifecycle APIs: submit-review, activate, retire
- Delete only when RETIRED
- Policy Catalog status badges and lifecycle actions in Policy Editor
- Impact / Simulation unchanged (status-agnostic)

### Out of scope

- Runtime enforcement wiring
- Approval workflow (multi-operator review)
- Replay / Quarantine changes
- Governance Dashboard redesign (M18.5)

## Transitions

| From | To | Endpoint |
|------|-----|----------|
| DRAFT | REVIEW | POST `.../submit-review` |
| REVIEW | ACTIVE | POST `.../activate` |
| ACTIVE | RETIRED | POST `.../retire` |

Reverse transitions are rejected with `GOVERNANCE_POLICY_LIFECYCLE` (409).

## Validation

- PUT cannot change `status` — use lifecycle endpoints
- ACTIVE / RETIRED policies cannot change `policy_json`
- RETIRED policies are view-only
- Only RETIRED policies can be deleted
