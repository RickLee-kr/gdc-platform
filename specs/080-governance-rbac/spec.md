# Spec 080 — Governance RBAC (M20)

## Summary

Replace temporary `X-Governance-Persona` header-based Governance access with JWT platform role RBAC.

## Roles

| Role | Scope |
|------|--------|
| ADMINISTRATOR | Full platform + Governance |
| OPERATOR / CONNECTOR_OPERATOR | Connector runtime; Governance read-only |
| GOVERNANCE_OPERATOR | Governance operations write (policy draft, submit, quarantine, replay) |
| GOVERNANCE_REVIEWER | Approval queue review, approve/reject |
| GOVERNANCE_APPROVER | Final approve, activate, retire |
| GOVERNANCE_AUDITOR | Governance audit/operations read-only |
| VIEWER | Monitoring/logs read-only; no Governance |

## Backend

- `app/auth/governance_rbac.py` — permission helpers and FastAPI `Depends`
- `app/auth/route_access.py` — coarse HTTP rules for `/governance/*`
- All Governance routers enforce role checks

## Frontend

- `frontend/src/lib/governance-rbac.ts` — capability helpers mirroring server
- Governance UI menu/buttons driven by session role + server capabilities
- Persona header removed from API clients

## Compatibility

- Legacy `OPERATOR` maps to `CONNECTOR_OPERATOR` for Governance checks
- `ADMINISTRATOR` retains all permissions

## Out of scope

Runtime Engine, Policy Engine, Approval state model, Audit correlation structure unchanged.
