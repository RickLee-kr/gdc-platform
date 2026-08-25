# Data Relay Documentation

**Product:** Data Relay — Enterprise Data Control Gateway  
**Hub role:** Documentation entry point and reading-order authority.

---

## Authority

| Layer | Role |
|-------|------|
| [`docs/canonical/`](./canonical/) | **Current authority** for product, architecture, and domain contracts |
| [`specs/`](../specs/) | Detailed engineering reference (status-classified in [`.specify/specs-index.md`](../.specify/specs-index.md)) |
| Code / migrations / tests | Implementation truth for what is shipped |
| Older source-of-truth, architecture, audit, and release docs | Migration inputs until Phase 2 classification completes |

Historical and migration-input documents must **not** override canonical documents.

Engineering invariants: [`.specify/memory/constitution.md`](../.specify/memory/constitution.md).

Migration plan: [`canonical/DOCUMENTATION-MIGRATION-MAP.md`](./canonical/DOCUMENTATION-MIGRATION-MAP.md).

---

## Reading order

1. [`canonical/00-DOCUMENTATION-GOVERNANCE.md`](./canonical/00-DOCUMENTATION-GOVERNANCE.md)
2. [`canonical/01-PRODUCT-CHARTER.md`](./canonical/01-PRODUCT-CHARTER.md)
3. [`canonical/02-SYSTEM-ARCHITECTURE.md`](./canonical/02-SYSTEM-ARCHITECTURE.md)
4. Applicable domain canonical document:
   - [`03-RUNTIME-RELIABILITY.md`](./canonical/03-RUNTIME-RELIABILITY.md)
   - [`04-CONNECTORS-MARKETPLACE.md`](./canonical/04-CONNECTORS-MARKETPLACE.md)
   - [`05-GOVERNANCE-SECURITY.md`](./canonical/05-GOVERNANCE-SECURITY.md)
   - [`06-USER-EXPERIENCE.md`](./canonical/06-USER-EXPERIENCE.md)
   - [`07-OPERATIONS-OBSERVABILITY.md`](./canonical/07-OPERATIONS-OBSERVABILITY.md)
   - [`08-QUALITY-RELEASE.md`](./canonical/08-QUALITY-RELEASE.md)
   - [`09-ROADMAP-CURRENT-STATE.md`](./canonical/09-ROADMAP-CURRENT-STATE.md)
5. Applicable detailed `specs/*` document
6. Runtime code and tests when implementation status matters

---

## Canonical documents

| Document | Topic |
|----------|--------|
| [00 Documentation Governance](./canonical/00-DOCUMENTATION-GOVERNANCE.md) | Authority, status vocabulary, change rules |
| [01 Product Charter](./canonical/01-PRODUCT-CHARTER.md) | Product identity, scope, non-goals |
| [02 System Architecture](./canonical/02-SYSTEM-ARCHITECTURE.md) | Topology, entities, invariants |
| [03 Runtime & Reliability](./canonical/03-RUNTIME-RELIABILITY.md) | Sources, destinations, durability, checkpoint |
| [04 Connectors & Marketplace](./canonical/04-CONNECTORS-MARKETPLACE.md) | Packs, registry, lifecycle, trust |
| [05 Governance & Security](./canonical/05-GOVERNANCE-SECURITY.md) | Data control, credentials, package security |
| [06 User Experience](./canonical/06-USER-EXPERIENCE.md) | Wizard, navigation, operator UX |
| [07 Operations & Observability](./canonical/07-OPERATIONS-OBSERVABILITY.md) | Day-2 operations and evidence |
| [08 Quality & Release](./canonical/08-QUALITY-RELEASE.md) | Test and release gates |
| [09 Roadmap & Current State](./canonical/09-ROADMAP-CURRENT-STATE.md) | Implementation status and priorities |

---

## Quick operator links

| Document | Description |
|----------|-------------|
| [Getting Started](./getting-started/GETTING-STARTED.md) | First connector → stream → deploy walkthrough |
| [Known Limitations](./release/KNOWN-LIMITATIONS.md) | Current release contract gaps |
| [Runtime Capability Matrix](./runtime/runtime-capability-matrix.md) | Detailed capability reference (verify against code) |
| [Operator Runbook](./operator-runbook.md) | Day-2 procedures |
| [Root README](../README.md) | Install and project overview |

---

## Migration inputs (not current authority)

Until Phase 2:

- `docs/source-of-truth/*` — superseded product/UX charters (preserve; do not treat as override)
- `docs/architecture/*` — architecture reviews, Marketplace charter draft, persist roadmaps
- `docs/release/` historical GA/RC snapshots — historical evidence
- `docs/archive/`, session recovery, campaign closures — historical evidence

Compatibility pointer formerly used as the large authority index:

- [`architecture/source-of-truth-index.md`](./architecture/source-of-truth-index.md) → redirects here and to `docs/canonical/`

---

## Status vocabulary

Use only: `IMPLEMENTED` · `PARTIAL` · `TARGET` · `BACKLOG` · `OUT_OF_SCOPE` · `HISTORICAL`

Do not claim target behavior as shipped.
