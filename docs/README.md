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
| [`docs/history/`](./history/) | Non-authoritative historical evidence (never overrides canonical) |

Historical documents must **not** override canonical documents.

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

## Current reference trees

| Tree | Role |
|------|------|
| [`docs/operations/`](./operations/) | Operator procedures (`deployment/`, `administration/`, `troubleshooting/`, `data-management/`) |
| [`docs/testing/`](./testing/) | Current QA / test execution procedures |
| [`docs/development/`](./development/) | Developer procedures and local platform contract |
| [`docs/runtime/`](./runtime/) | Runtime capability and enrichment references |
| [`docs/ux/`](./ux/) | Current UX contracts (Route Processing, Schema Drift, dashboard/streams) |
| [`docs/release/`](./release/) | Current known limitations, production checklist, install validation |
| [`docs/reference/`](./reference/) | Detailed reference index + architecture/governance/UX contracts ([`reference/README.md`](./reference/README.md)) |
| [`docs/architecture/`](./architecture/) | Compatibility pointers only (architecture authority is `docs/canonical/`) |
| [`specs/`](../specs/) | Detailed engineering reference (paths unchanged) |

---

## Quick operator links

| Document | Description |
|----------|-------------|
| [Getting Started](./getting-started/GETTING-STARTED.md) | First connector → stream → deploy walkthrough |
| [Known Limitations](./release/KNOWN-LIMITATIONS.md) | Current release contract gaps |
| [Runtime Capability Matrix](./runtime/runtime-capability-matrix.md) | Detailed capability reference (verify against code) |
| [Operator Runbook](./operations/operator-runbook.md) | Day-2 procedures |
| [Install guide](./operations/deployment/install-guide.md) | Platform install |
| [Backup & restore](./operations/data-management/backup-restore.md) | PostgreSQL backup/restore authority |
| [Root README](../README.md) | Install and project overview |

---

## History (not current authority)

| Location | Contents |
|----------|----------|
| [`docs/history/source-of-truth/`](./history/source-of-truth/) | Superseded product/UX/WBS charters |
| [`docs/history/architecture/`](./history/architecture/) | Audits, M13 reviews, Marketplace v1 draft, folded OSS overview, master-design |
| [`docs/history/documentation-v2-campaign/`](./history/documentation-v2-campaign/) | Phase 1 docs-v2 audit/migration campaign materials |
| [`docs/history/releases/`](./history/releases/) | RC/GA notes and readiness snapshots |
| [`docs/history/ux/`](./history/ux/) | M30.x implementation reports |
| [`docs/history/testing/`](./history/testing/) | Point-in-time QA audits / campaign closures |
| [`docs/history/performance/`](./history/performance/) | Performance phase reports |
| [`docs/history/out-of-scope/ai-gateway/`](./history/out-of-scope/ai-gateway/) | AI Gateway specs (outside current product scope) |
| [`docs/archive/`](./archive/) | Earlier archive copies |

Compatibility pointers:

- [`architecture/source-of-truth-index.md`](./architecture/source-of-truth-index.md) → redirects here and to `docs/canonical/`
- [`source-of-truth/README.md`](./source-of-truth/README.md) → former SoT tree relocated

---

## Status vocabulary

Use only: `IMPLEMENTED` · `PARTIAL` · `TARGET` · `BACKLOG` · `OUT_OF_SCOPE` · `HISTORICAL`

Do not claim target behavior as shipped.
