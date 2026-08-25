# Documentation Migration Map

**Status:** Draft migration plan  
**Rule:** Preserve history; reduce authority.

## 1. Existing Source-of-Truth documents

| Current path | New authority | Disposition |
|---|---|---|
| `docs/history/source-of-truth/PRODUCT-CHARTER-Version-1.2.1-FINAL.txt` | `canonical/01-PRODUCT-CHARTER.md` | Supersede after review; preserve historical original. |
| `docs/history/source-of-truth/MASTER-WBS-Version-1.2.1-FINAL.txt` | `canonical/09-ROADMAP-CURRENT-STATE.md` | Split historical WBS from current roadmap. |
| `docs/history/source-of-truth/DATA-RELAY-UX-CHARTER-v1.2.1-FINAL.txt` | `canonical/06-USER-EXPERIENCE.md` | Consolidate current UX rules. |
| `docs/history/source-of-truth/DATA-RELAY-STREAM-WIZARD-UX-CHARTER-v5.2-FINAL.txt` | `canonical/06-USER-EXPERIENCE.md` | Merge final 5-step wizard only. |
| `docs/history/source-of-truth/GOVERNANCE-UX-CHARTER-v1.1-FINAL.txt` | `canonical/05-GOVERNANCE-SECURITY.md` + `06` | Remove old wizard flow from current authority. |
| `docs/history/source-of-truth/DATA-RELAY-GOVERNANCE-WORKSPACE-UX-CHARTER-v1.1-FINAL.txt` | `05` + `06` | Supporting UX details may remain reference. |
| `docs/reference/governance/DATA-RELAY-GOVERNANCE-WORKSPACE-v1.1-FINAL.txt` | detailed spec/reference | Historical/current mixed; no longer canonical top-level. |
| `docs/reference/governance/DATA-RELAY-GOVERNANCE-AND-TRANSFORM-POLICY-DRAFT-v1.1-FINAL.txt` | `05` + route specs | Fold current rules; draft history becomes reference. |
| `docs/reference/ux/DATA-RELAY-UNION-SCHEMA-UX-SPEC-v1.1-FINAL.txt` | `02`, `05`, `06` | Canonical summary; keep detailed spec as reference. |
| `docs/history/source-of-truth/CHATGPT-DATA-RELAY-GUARDRAIL.txt` | `00` + Product/Architecture | Replace with AI/Cursor reading rules; archive goal snapshots. |

## 2. Architecture

| Current area | Disposition |
|---|---|
| `docs/architecture/source-of-truth-index.md` | Replace with `docs/README.md` + canonical governance. |
| `docs/architecture/OSS-v1-ARCHITECTURE.md` | Fold durable current rules into `02`/`03`; retain as OSS v1 historical reference. |
| Marketplace Charter v1.0 Draft | Replace with `04-CONNECTORS-MARKETPLACE.md`; preserve old charter as design history. |
| credential encryption architecture | Keep as detailed security reference; canonical summary in `05`. |
| durable queue design/audits | Move design/audit reports to history/reference; canonical current state in `03`. |
| `m13-*` audits/reviews | `history/architecture-audits/`. |
| route-processing persist roadmap | Keep as detailed implementation gap reference until gaps close. |
| AI Gateway architecture docs | `history/out-of-scope/ai-gateway/`. |

## 3. UX

| Current area | Disposition |
|---|---|
| Route Processing UX spec | Keep detailed reference; canonical workflow in `06`. |
| Schema Drift Policy Runtime spec | Keep detailed engineering authority; summary in `05`. |
| Dashboard operational monitoring | Keep detailed implemented UX reference; summary in `07`. |
| Streams operations docs | Keep supporting UX/operations reference. |
| M30.x implementation review/report docs | Move point-in-time reports/screenshots to `history/implementation-reports/`. |

## 4. Runtime

| Current area | Disposition |
|---|---|
| runtime capability matrix | Keep current supporting reference; summary in `03`. |
| runtime implementation/audit reports | History/evidence unless they define a still-current detailed contract. |

## 5. `specs/`

Do not bulk rewrite or renumber in the first migration.

### Keep as detailed current reference when applicable

Examples:

- `001-core-architecture`
- `002-runtime-pipeline`
- `003-db-model`
- `004-delivery-routing`
- `035-rbac-lite`
- `048-runtime-reliability`
- `049-template-registry`
- `091`–`097` Route Processing

### Required action

Rewrite `.specify/specs-index.md` into a status-aware index.

Every spec gets one classification:

```text
CURRENT
PARTIAL
TARGET
HISTORICAL
OUT_OF_SCOPE
```

AI Gateway specs must be explicitly `OUT_OF_SCOPE` for current Data Relay OSS rather than merely remaining in the flat catalog.

Duplicate numeric prefixes remain untouched; full path is the identifier.

## 6. Release

### Keep current

- current known limitations
- current production/release readiness checklist
- current installation validation where still applicable
- changelog

### Move to history

- OSS v1 RC release notes
- OSS v1 GA release snapshot
- old GA checklist
- point-in-time readiness/hardening audits
- campaign closure reports

Recommended:

```text
docs/history/releases/
```

## 7. Operations / Admin / Deployment

Unify under:

```text
docs/operations/
├ deployment/
├ administration/
├ troubleshooting/
└ data-management/
```

Examples:

- `docs/operations/data-management/backup-restore.md` and `docs/operations/data-management/backup-restore.md` → choose one canonical operator procedure, link other context to it.
- install/upgrade/TLS/offline installation → `operations/deployment/`
- support bundle/maintenance/password reset/auth sessions → `operations/administration/`
- migration integrity/recovery → `operations/data-management/`

## 8. Development / Testing

Merge `docs/dev` and `docs/development` into:

```text
docs/development/
```

Keep test procedures under:

```text
docs/testing/
```

Testing audit/closure documents that are point-in-time evidence move to:

```text
docs/history/quality/
```

Current executable testing procedures remain in `docs/testing/`.

## 9. Root-level scattered docs

Root-level documents such as local Docker workflows, deployment readiness, old master design, and E2E closure should be moved according to role:

- current operator procedure → operations/development
- current canonical contract → canonical
- point-in-time audit/closure → history
- superseded design → history/architecture

`docs/history/architecture/master-design.md` is already superseded and should become historical only.

## 10. Recommended migration commit sequence

### Commit A — Add canonical v2 docs

No deletion or movement.

### Commit B — Replace indexes

- `docs/README.md`
- source-of-truth pointer
- status-aware `.specify/specs-index.md`

### Commit C — Mark old canonical docs superseded

Small header/pointer only; preserve bytes/history where practical.

### Commit D — Move history/evidence

Use `git mv`; update links.

### Commit E — Normalize operations/development directories

Deduplicate backup/restore and folder naming.

### Commit F — Link and consistency validation

Check:

- internal links
- stale `Implementation Pending`
- stale wizard workflows
- stale AI Gateway current-scope references
- duplicate authority
- official English language rule
