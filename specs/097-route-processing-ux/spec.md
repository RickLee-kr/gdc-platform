# M13.7 Route Processing UX

**Milestone:** M13.7 (Route Processing UX — cross-surface design authority)  
**Status:** Draft v1.0  
**UX authority (full):** [`docs/ux/DATA-RELAY-ROUTE-PROCESSING-UX-SPEC.md`](../../docs/ux/DATA-RELAY-ROUTE-PROCESSING-UX-SPEC.md)  
**Depends on:** M13.1–M13.6 (`specs/091`–`specs/096`)

## Purpose

Normative UX contract for **Route Processing** across Wizard, Stream Edit, Route Edit, and Governance Workspace. Implements the Charter model:

```text
Route = Destination Specific Processing Unit
```

Runtime and persistence behavior remain in M13.1–M13.6; this spec defines **layout, inheritance UX, mental model, and Definition of Done** for all Route Processing surfaces.

## Scope

| In scope | Out of scope |
|----------|--------------|
| Global Processing + Route List + Route Detail layout | New runtime pipeline stages |
| Inherit Global / Override per concern (Transform, Protection, Classification, Policy) | Delivery Worker / queue redesign |
| Delivery as route-only (no inherit) | Backend API field names (see 091–096) |
| Unknown Field / Drop / Block UX semantics | AI-assisted processing |

## Surfaces

- **Wizard** — Step 4 Route Processing
- **Stream Edit** — Global Processing + route overview
- **Route Edit** — per-route detail panel
- **Governance Workspace** — effective preview aligned with inherit/override

## Definition Of Done

See §18 in [`docs/ux/DATA-RELAY-ROUTE-PROCESSING-UX-SPEC.md`](../../docs/ux/DATA-RELAY-ROUTE-PROCESSING-UX-SPEC.md).

## Related specs

| Spec | Topic |
|------|--------|
| `specs/091-route-processing-architecture/spec.md` | Foundation lifecycle |
| `specs/092-per-route-transform/spec.md` | Transform override |
| `specs/093-per-route-protection/spec.md` | Protection override |
| `specs/094-per-route-classification/spec.md` | Classification override |
| `specs/095-per-route-policy/spec.md` | Policy override |
| `specs/096-route-runtime-delivery/spec.md` | Delivery execution |
