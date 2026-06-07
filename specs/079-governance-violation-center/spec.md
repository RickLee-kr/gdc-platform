# 079 — Governance Violation Center (M19.1)

## Goal

Policy-centric violation feed for Governance Operators from existing runtime data.

## Scope

### In scope

- `app/governance_violations/` — read-only violation view service
- `GET /api/v1/governance/violations` — list with filters
- `GET /api/v1/governance/violations/{id}` — detail
- Violation Center UI at `/governance/violations`

### Out of scope

- Runtime enforcement wiring
- Approval workflow
- Quarantine / Replay engine changes
- New violation DB table

## Data sources

- `stream_quarantine_events` — primary violation rows
- `governance_policies` + `stream_policy_assignments` — policy name resolution
- `stream_replay_events` + `delivery_logs` replay stages — REPLAYED status
- `delivery_logs` — supplemental replay detection

## Violation status

| Status | Derivation |
|--------|------------|
| QUARANTINED | quarantine row pending |
| RELEASED | quarantine released, no replay |
| REPLAYED | replay after violation on stream |
| OPEN | discarded or unresolved |
