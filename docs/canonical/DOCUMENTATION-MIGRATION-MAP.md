# Documentation Migration Map

**Document Version:** 2.1  
**Last Updated:** 2026-08-25  
**Status:** CANONICAL (Phase 2A survey result)  
**Companion:** [`DOCUMENTATION-INVENTORY.md`](./DOCUMENTATION-INVENTORY.md)  
**Rule:** Preserve history; reduce authority. **No physical moves in Phase 2A.**

Disposition vocabulary:

| Disposition | Meaning |
|---|---|
| `CANONICAL` | Current authority lives in `docs/canonical/`. |
| `REFERENCE_CURRENT` | Detailed engineering/operator reference; subordinate to canonical. |
| `HISTORICAL` | Point-in-time evidence; never overrides canonical. |
| `OUT_OF_SCOPE` | Outside current Data Relay OSS product scope. |
| `DUPLICATE_TO_CONSOLIDATE` | Overlaps another path; keep one procedure in Phase 2B. |

Move phases:

| Phase | Action |
|---|---|
| **2A (this commit)** | Full inventory; SoT SUPERSEDED headers; stale Marketplace/status fixes; capability matrix alignment; **no** `git mv` / deletes |
| **2B** | Physical relocation into `docs/history/*`, `docs/operations/{deployment,administration,troubleshooting,data-management}/`, `docs/development/` |
| **Later** | Optional archive prune of verified duplicates under `_incoming/` / `docs/tmp/` |

---

## 1. `docs/canonical/`

| Current role | Classification | Target location | Move phase |
|---|---|---|---|
| Top-level Documentation v2 product/domain authority | `CANONICAL` | `docs/canonical/` | remain |
| Inventory + this migration map | `CANONICAL` | `docs/canonical/` | remain |

Exactly one top-level product documentation authority remains: **`docs/canonical/`**.

---

## 2. `docs/source-of-truth/`

| Current role | Classification | Target location | Move phase |
|---|---|---|---|
| Former product/UX/governance SoT tree | Mostly `HISTORICAL`; selected detailed specs `REFERENCE_CURRENT` | `docs/history/source-of-truth/` | **2B** |
| `_incoming/*` staging copies | `DUPLICATE_TO_CONSOLIDATE` / `HISTORICAL` | `docs/history/source-of-truth/_incoming/` | **2B** |

Phase 2A: every primary + incoming file has an explicit `Status: SUPERSEDED` compatibility header pointing at canonical replacements. Content preserved; **not** top-level authority.

| Path | Phase 2A class | Canonical parent |
|---|---|---|
| `PRODUCT-CHARTER-…` | `HISTORICAL` | `01-PRODUCT-CHARTER.md` |
| `MASTER-WBS-…` | `HISTORICAL` | `09-ROADMAP-CURRENT-STATE.md` |
| UX / Stream Wizard / Governance UX charters | `HISTORICAL` | `05` / `06` |
| Governance Workspace implementation + transform policy + Union Schema | `REFERENCE_CURRENT` (detail) | `02` / `05` / `06` |
| `CHATGPT-…-GUARDRAIL` | `HISTORICAL` | `00-DOCUMENTATION-GOVERNANCE.md` |

---

## 3. `docs/architecture/`

| Current role | Classification | Target location | Move phase |
|---|---|---|---|
| Marketplace Charter v1.0 Draft | `HISTORICAL` (design baseline; M29 status banner corrected) | `docs/history/architecture/marketplace/` | **2B** |
| `OSS-v1-ARCHITECTURE.md`, credential encryption, route persist roadmap | `REFERENCE_CURRENT` | remain or `docs/reference/architecture/` | optional 2B |
| `m13-*`, gap analyses, audits, reviews, durable-queue design snapshots | `HISTORICAL` | `docs/history/architecture/` (+ `m13/`) | **2B** |
| AI Gateway foundation/implementation specs | `OUT_OF_SCOPE` | `docs/history/out-of-scope/ai-gateway/` | **2B** |
| `source-of-truth-index.md` | Compatibility pointer (`REFERENCE_CURRENT`) | remain (or fold into `docs/README.md`) | optional |

---

## 4. `docs/ux/`

| Current role | Classification | Target location | Move phase |
|---|---|---|---|
| Route Processing UX, Schema Drift runtime policy, Dashboard monitoring, Streams ops | `REFERENCE_CURRENT` | remain / `docs/reference/ux/` | optional 2B |
| M30.x implementation reports + vocabulary audit | `HISTORICAL` | `docs/history/ux/` | **2B** |

Do not create parallel UX authority against `canonical/06` or `canonical/07`.

---

## 5. `docs/runtime/`

| Current role | Classification | Target location | Move phase |
|---|---|---|---|
| `runtime-capability-matrix.md` | `REFERENCE_CURRENT` (Phase 2A corrected) | remain `docs/runtime/` | remain |
| Partitioning / enrichment references | `REFERENCE_CURRENT` | remain | remain |

Capability matrix now states `WEBHOOK_RECEIVER = IMPLEMENTED` and reliability modes without over-claim (`PERSISTENT_QUEUE` only for `WEBHOOK_POST` + `SYSLOG_TCP`; `MEMORY_BUFFER` / `EXTERNAL_BUFFER` = `TARGET`).

---

## 6. `docs/release/`

| Current role | Classification | Target location | Move phase |
|---|---|---|---|
| `KNOWN-LIMITATIONS.md`, `production-checklist.md`, `installation-validation.md` | `REFERENCE_CURRENT` | remain or `docs/operations/deployment/` | **2B** (checklist consolidate) |
| RC/GA notes, GA checklist, hardening/readiness/stability reports | `HISTORICAL` | `docs/history/releases/` | **2B** |

---

## 7. `docs/testing/`

| Current role | Classification | Target location | Move phase |
|---|---|---|---|
| Executable QA procedures, matrices, lab/e2e guides, regression policy | `REFERENCE_CURRENT` | remain `docs/testing/` | remain |
| `qa-automation-architecture-audit.md` | `HISTORICAL` (point-in-time audit + evidence) | `docs/history/testing/` | **2B** |

QA execution procedures are **not** deletion/move targets for removal—only historical audits relocate.

---

## 8. `docs/admin/` · `docs/operations/` · `docs/deployment/`

| Current role | Classification | Target location | Move phase |
|---|---|---|---|
| Operator runbooks, install/TLS/upgrade, retention, migration recovery | Mostly `REFERENCE_CURRENT` | Target tree below | **2B** |
| `admin/backup-restore.md` ↔ `deployment/backup-restore.md` | `DUPLICATE_TO_CONSOLIDATE` | `docs/operations/data-management/backup-restore.md` | **2B** |
| `admin/support-bundle.md` ↔ `operations/support-diagnostics-guide.md` | `DUPLICATE_TO_CONSOLIDATE` | `docs/operations/troubleshooting/` | **2B** |
| `operations/release-readiness-checklist.md` ↔ `deployment/release-checklist.md` (+ release production checklist) | `DUPLICATE_TO_CONSOLIDATE` | `docs/operations/deployment/release-checklist.md` | **2B** |

Phase 2B target layout (**not applied yet**):

```text
docs/operations/
├── deployment/
├── administration/
├── troubleshooting/
└── data-management/
```

---

## 9. `docs/dev/` · `docs/development/`

| Current role | Classification | Target location | Move phase |
|---|---|---|---|
| Split developer docs | `DUPLICATE_TO_CONSOLIDATE` (`docs/dev/*`) + `REFERENCE_CURRENT` (`docs/development/*`) | unify under `docs/development/` | **2B** |

---

## 10. `specs/` · `.specify/`

| Current role | Classification | Target location | Move phase |
|---|---|---|---|
| Engineering feature specs (path = identity; duplicate numeric prefixes kept) | Mostly `REFERENCE_CURRENT`; sprint/UX snapshots `HISTORICAL`; AI Gateway `OUT_OF_SCOPE` | remain `specs/`; OOS optionally `docs/history/out-of-scope/ai-gateway/` | optional later |
| `.specify/specs-index.md`, `memory/constitution.md` | `REFERENCE_CURRENT` | remain `.specify/` | remain |

Do not bulk rewrite or renumber specs in Phase 2. Full path listing is in `DOCUMENTATION-INVENTORY.md`.

---

## 11. Other `docs/` areas

| Current area | Classification | Target location | Move phase |
|---|---|---|---|
| `docs/archive/**` | `HISTORICAL` (already archived) | remain | remain |
| `docs/performance/**` | `HISTORICAL` | `docs/history/performance/` | **2B** |
| `docs/session-recovery/**` | `HISTORICAL` | `docs/history/session-recovery/` | **2B** |
| `docs/tmp/**` | `HISTORICAL` working drafts (not authority) | exclude / `docs/history/tmp/` | later |
| Getting started, docker, operator-runbook, sources/destinations/metrics | `REFERENCE_CURRENT` | remain or ops/dev trees | optional 2B |
| `master-design.md`, `source-roadmap.md`, root readiness/closure docs | `HISTORICAL` | `docs/history/` | **2B** |

---

## 12. Phase sequence (updated)

### Phase 1 — complete

- add `docs/canonical/*`
- rebuild `docs/README.md`
- reduce `source-of-truth-index.md` to a pointer
- consolidate Constitution; rebuild `.specify/specs-index.md`
- **no** deletion or `git mv` of historical docs

### Phase 2A — this commit

- full inventory (`DOCUMENTATION-INVENTORY.md`)
- SUPERSEDED headers on old SoT files
- Marketplace charter historical banner + M29 status correction
- runtime capability matrix aligned to code + canonical 03
- migration map rewritten from survey (this file)
- **no** physical moves/deletes; **no** product/runtime/test/migration code changes

### Phase 2B — next

- `git mv` historical trees into `docs/history/*`
- consolidate operations + development directories
- link sweep after moves

---

## 13. Explicit Phase 2A non-actions

- Do not `git mv` `docs/source-of-truth/*`, `docs/release/*`, `docs/architecture/*`, `docs/admin/*`, `docs/dev/*`
- Do not delete architecture audits, release notes, old specs, or SoT content
- Do not alter runtime/product code, migrations, or tests
- Do not promote `docs/tmp/*` as authority
