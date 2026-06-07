# 076 — Governance Policy Simulation (M18.3)

## Goal

Dry-run simulation for Named Policies against sample events. No runtime enforcement.

## Scope

### In scope

- `POST /api/v1/governance/policies/simulate`
- `POST /api/v1/governance/policies/{id}/simulate`
- `simulation_service.py` — condition evaluation on sample events
- Policy Editor Simulation panel (below Impact)
- Operators: `equals`, `not_equals`, `contains`
- Actions: `quarantine`, `tokenize`, `mask`, `audit_only`

### Out of scope

- Runtime enforcement wiring
- StreamRunner / Replay / Quarantine changes
- Policy Lifecycle (M18.4)

## Architecture

Reuses M18.1 `policy_json` validation. When `sample_events` is empty and stream scope exists, recent classification `payload_sample` rows (24h) are used as samples. Events are never mutated.
