# Documentation Migration Map

**Document Version:** 2.0  
**Last Updated:** 2026-08-25  
**Status:** CANONICAL (Phase 1 plan)  
**Rule:** Preserve history; reduce authority. Do not physically move files in Phase 1.

Disposition vocabulary for future Phase 2 work:

| Disposition | Meaning |
|---|---|
| `CANONICAL` | Current authority lives in `docs/canonical/` (or is this map). |
| `REFERENCE` | Detailed engineering/operator reference; subordinate to canonical. |
| `HISTORICAL` | Point-in-time evidence; never overrides canonical. |
| `OUT_OF_SCOPE` | Outside current Data Relay OSS product scope. |
| `DUPLICATE_TO_CONSOLIDATE` | Overlaps another path; keep one procedure in Phase 2. |

## 1. Existing Source-of-Truth documents

| Current path | New authority | Disposition |
|---|---|---|
| `docs/source-of-truth/PRODUCT-CHARTER-Version-1.2.1-FINAL.txt` | `canonical/01-PRODUCT-CHARTER.md` | `HISTORICAL` (superseded; preserve) |
| `docs/source-of-truth/MASTER-WBS-Version-1.2.1-FINAL.txt` | `canonical/09-ROADMAP-CURRENT-STATE.md` | `HISTORICAL` / split later |
| `docs/source-of-truth/DATA-RELAY-UX-CHARTER-v1.2.1-FINAL.txt` | `canonical/06-USER-EXPERIENCE.md` | `HISTORICAL` |
| `docs/source-of-truth/DATA-RELAY-STREAM-WIZARD-UX-CHARTER-v5.2-FINAL.txt` | `canonical/06-USER-EXPERIENCE.md` | `HISTORICAL` |
| `docs/source-of-truth/GOVERNANCE-UX-CHARTER-v1.1-FINAL.txt` | `canonical/05` + `06` | `HISTORICAL` |
| `docs/source-of-truth/DATA-RELAY-GOVERNANCE-WORKSPACE-UX-CHARTER-v1.1-FINAL.txt` | `05` + `06` | `REFERENCE` / `HISTORICAL` |
| `docs/source-of-truth/DATA-RELAY-GOVERNANCE-WORKSPACE-v1.1-FINAL.txt` | detailed spec/reference | `REFERENCE` |
| `docs/source-of-truth/DATA-RELAY-GOVERNANCE-AND-TRANSFORM-POLICY-DRAFT-v1.1-FINAL.txt` | `05` + route specs | `REFERENCE` |
| `docs/source-of-truth/DATA-RELAY-UNION-SCHEMA-UX-SPEC-v1.1-FINAL.txt` | `02`, `05`, `06` | `REFERENCE` |
| `docs/source-of-truth/CHATGPT-DATA-RELAY-GUARDRAIL.txt` | `00` + Product/Architecture | `HISTORICAL` |

## 2. Architecture

| Current area | Disposition |
|---|---|
| `docs/architecture/source-of-truth-index.md` | Compatibility pointer → `docs/README.md` + `docs/canonical/` (`CANONICAL` entry path) |
| `docs/architecture/OSS-v1-ARCHITECTURE.md` | `REFERENCE` / durable rules folded into `02`/`03` |
| Marketplace Charter v1.0 Draft | `HISTORICAL`; replaced by `04-CONNECTORS-MARKETPLACE.md` |
| Marketplace addenda under `docs/tmp/` | Working inputs; **do not commit** as authority |
| Credential encryption architecture | `REFERENCE`; summary in `05` |
| Durable queue design/audits | `HISTORICAL` / `REFERENCE`; current state in `03` |
| `m13-*` audits/reviews | `HISTORICAL` |
| Route-processing persist roadmap | `REFERENCE` until gaps close |
| AI Gateway architecture docs | `OUT_OF_SCOPE` |

## 3. UX

| Current area | Disposition |
|---|---|
| Route Processing UX spec | `REFERENCE`; canonical workflow in `06` |
| Schema Drift Policy Runtime spec | `REFERENCE`; summary in `05` |
| Dashboard operational monitoring | `REFERENCE`; summary in `07` |
| Streams operations docs | `REFERENCE` |
| M30.x implementation review/report docs | `HISTORICAL` |

## 4. Runtime

| Current area | Disposition |
|---|---|
| `docs/runtime/runtime-capability-matrix.md` | `REFERENCE` (update stale webhook claim in Phase 2) |
| Runtime implementation/audit reports | `HISTORICAL` unless still-current detailed contract |

## 5. `specs/`

Do not bulk rewrite or renumber in Phase 1.

| Spec area | Disposition |
|---|---|
| `001`–`004`, `048`, `091`–`097` | `REFERENCE` (CURRENT engineering) under canonical parents |
| `035-rbac-lite`, `049-template-registry` | `REFERENCE` |
| AI Gateway specs (`070`, `081`, `082`, `090`) | `OUT_OF_SCOPE` |
| Sprint snapshots `083`–`087` | `HISTORICAL` |

See `.specify/specs-index.md` for status-aware classification of every path.

## 6. Release

| Current area | Disposition |
|---|---|
| `docs/release/KNOWN-LIMITATIONS.md` | `REFERENCE` (current contract) |
| Production/release readiness checklist | `REFERENCE` |
| Changelog | `REFERENCE` |
| OSS v1 RC/GA release notes and checklists | `HISTORICAL` |
| Campaign closure / point-in-time readiness audits | `HISTORICAL` |

## 7. Operations / Admin / Deployment

| Current area | Disposition |
|---|---|
| Operator runbooks, install, TLS, backup | `REFERENCE` |
| `docs/admin/backup-restore.md` vs `docs/deployment/backup-restore.md` | `DUPLICATE_TO_CONSOLIDATE` |
| `docs/admin` vs `docs/operations` overlap | `DUPLICATE_TO_CONSOLIDATE` |

Phase 2 target layout (not applied yet):

```text
docs/operations/
├ deployment/
├ administration/
├ troubleshooting/
└ data-management/
```

## 8. Development / Testing

| Current area | Disposition |
|---|---|
| `docs/dev` vs `docs/development` | `DUPLICATE_TO_CONSOLIDATE` |
| Current executable testing procedures | `REFERENCE` under `docs/testing/` |
| Point-in-time QA audits/closures | `HISTORICAL` |

## 9. Root-level scattered docs

| Current area | Disposition |
|---|---|
| Local Docker workflows / getting started | `REFERENCE` |
| Deployment readiness | `REFERENCE` or `HISTORICAL` by freshness |
| `docs/master-design.md` | `HISTORICAL` |
| E2E campaign closures | `HISTORICAL` |

## 10. Phase sequence

### Phase 1 (this commit) — Add canonical v2 authority

- add `docs/canonical/*`
- rebuild `docs/README.md`
- reduce `source-of-truth-index.md` to a pointer
- consolidate Constitution to engineering invariants
- rebuild status-aware `.specify/specs-index.md`
- add this migration map
- **no** deletion or `git mv` of historical docs

### Phase 2 — Classify and relocate

- mark superseded headers on old SoT files
- `git mv` history/evidence into `docs/history/*`
- unify operations/development directories
- fix stale capability-matrix claims
- link validation across the tree

## 11. Explicit Phase 1 non-actions

- Do not delete `docs/source-of-truth/*`
- Do not delete architecture audits
- Do not delete release notes
- Do not delete old specs
- Do not alter runtime/product code, migrations, or tests
- Do not commit `docs/tmp/*` draft/working packages
