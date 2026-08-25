# Data Relay Documentation v2 — Draft Canonical Set

**Audit baseline:** `RickLee-kr/gdc-platform`, branch `qa-wave2-integration`, remote HEAD `922ea928f79057c331f567e68c4c8264b2081700`  
**Audit date:** 2026-08-25  
**Status:** Draft for review. This package does not change repository files.

## Why this rewrite exists

The repository contains valuable product, architecture, UX, runtime, testing, release, and implementation knowledge, but authority has accumulated through append-only addenda and point-in-time implementation documents. This has produced duplicated rules, stale implementation status, contradictory wizard descriptions, and historical evidence mixed with current design.

Documentation v2 separates:

- **What the product should be**
- **What the architecture contract is**
- **What is implemented now**
- **What is a target**
- **What is historical evidence**

## Proposed canonical reading order

1. `00-DOCUMENTATION-GOVERNANCE.md`
2. `01-PRODUCT-CHARTER.md`
3. `02-SYSTEM-ARCHITECTURE.md`
4. Domain document relevant to the change:
   - `03-RUNTIME-RELIABILITY.md`
   - `04-CONNECTORS-MARKETPLACE.md`
   - `05-GOVERNANCE-SECURITY.md`
   - `06-USER-EXPERIENCE.md`
   - `07-OPERATIONS-OBSERVABILITY.md`
5. `08-QUALITY-RELEASE.md`
6. `09-ROADMAP-CURRENT-STATE.md`
7. Detailed numbered `specs/*` only when implementation detail is required.

## Proposed repository layout

```text
docs/
├── README.md
├── canonical/
│   ├── 00-DOCUMENTATION-GOVERNANCE.md
│   ├── 01-PRODUCT-CHARTER.md
│   ├── 02-SYSTEM-ARCHITECTURE.md
│   ├── 03-RUNTIME-RELIABILITY.md
│   ├── 04-CONNECTORS-MARKETPLACE.md
│   ├── 05-GOVERNANCE-SECURITY.md
│   ├── 06-USER-EXPERIENCE.md
│   ├── 07-OPERATIONS-OBSERVABILITY.md
│   ├── 08-QUALITY-RELEASE.md
│   └── 09-ROADMAP-CURRENT-STATE.md
├── operations/
│   ├── deployment/
│   ├── administration/
│   ├── troubleshooting/
│   └── testing/
├── reference/
│   └── ...
└── history/
    ├── releases/
    ├── architecture-audits/
    ├── implementation-reports/
    ├── session-recovery/
    └── out-of-scope/
```

The existing `specs/` tree remains an engineering reference tree during the migration. It should be indexed and status-tagged rather than mass-renumbered.

## Included migration material

- `AUDIT-REPORT.md` — structural findings and contradictions found in the current repository.
- `MIGRATION-MAP.md` — what to keep, consolidate, supersede, or archive.

## Important status rule

This rewrite deliberately uses explicit status vocabulary:

- `IMPLEMENTED`
- `PARTIAL`
- `TARGET`
- `BACKLOG`
- `OUT_OF_SCOPE`
- `HISTORICAL`

A target specification must never be presented as shipped functionality.
