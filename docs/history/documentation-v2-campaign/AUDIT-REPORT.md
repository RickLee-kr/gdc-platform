# Data Relay Documentation Audit Report

**Repository:** `RickLee-kr/gdc-platform`  
**Branch:** `qa-wave2-integration`  
**Remote HEAD:** `922ea928f79057c331f567e68c4c8264b2081700`  
**Audit date:** 2026-08-25  
**Purpose:** Redefine current documentation before adding more product/Marketplace requirements.

## Executive finding

The primary problem is no longer missing documentation. It is **documentation authority debt**.

The repository has accumulated product rules, architecture, UX direction, implementation plans, point-in-time audits, Marketplace addenda, release evidence, and current-state notes across overlapping locations.

The correct fix is not another addendum.

The correct fix is a clean canonical documentation layer plus explicit history/reference classification.

## Major findings

### 1. Authority is duplicated

The same architectural rule is repeated in:

- Product Charter
- UX Charter
- Stream Wizard Charter
- Governance charters
- Constitution
- numbered specs
- Marketplace addenda

This increases drift risk.

### 2. Marketplace status is stale

The Marketplace Charter and many appendices still describe Marketplace as `Implementation Not Started` / `Implementation Pending`.

The audited branch already includes M29.1–M29.4 implementation through commit `922ea928...`.

Therefore current documentation materially understates shipped control-plane implementation.

### 3. Filename and internal version numbers conflict

Examples found:

- `DATA-RELAY-UX-CHARTER-v1.2.1-FINAL.txt` internally begins with Version 1.1.
- `DATA-RELAY-STREAM-WIZARD-UX-CHARTER-v5.2-FINAL.txt` internally begins with Version 3.0.
- Governance/Union Schema v1.1 filenames contain Version 1.0 internally.

Versioning is not trustworthy.

### 4. Single documents contain contradictory historical and current workflows

Governance documents contain old flows such as:

```text
Connect → Mapping → Destination → Review
```

or an older six-step flow, then later append current:

```text
Connect → Sample & Record Selection → Destinations → Route Processing → Deploy
```

A developer can read the wrong section and implement a superseded UX.

### 5. Historical implementation evidence is mixed with current architecture

`docs/architecture/` contains:

- current architecture
- audits
- M13 point-in-time reviews
- AI Gateway documents now out of product scope
- design reports
- Marketplace charter

These should not share equal visual authority.

### 6. Release history is mixed with current release contract

`docs/release/` contains current limitations beside RC/GA snapshots and old readiness audits.

Current and historical release truth should be separated.

### 7. Older reliability specs are stale relative to implementation

Core/reliability specs still describe durable queue behavior as future-only.

Subsequent runtime work implemented selected durable delivery/recovery behavior.

The policy remains useful, but implementation status must be corrected.

### 8. Source Pack / Template Registry / Connector Registry need one ownership model

Current documentation contains:

- Phase-1 flat Template Registry
- target Source Pack Registry from spec 049
- current Connector Registry used operationally
- Marketplace package registry extension

Creating another registry would worsen the problem.

Recommended ownership:

```text
Source Pack = canonical integration content contract
Connector Registry = operational package discovery/catalog authority
Marketplace = distribution/lifecycle/trust layer
Legacy Template Registry = migration/reference path, not a third future authority
```

### 9. Constitution has accumulated unrelated policy

The constitution mixes:

- runtime invariants
- reliability
- admin bootstrap credential
- mapping UI
- dashboard style
- navigation
- adapter policy
- language policy
- Marketplace addendum

It should become a short engineering-invariants document, while product/UX rules move to canonical domain docs.

### 10. Mapping UI rules are duplicated inside the Constitution

A repeated section is direct evidence of append-only documentation accumulation.

### 11. Official language policy conflicts with current canonical docs

The Constitution states official project documentation is English-only, while many Source-of-Truth documents are Korean.

The v2 canonical set should be English.

### 12. Spec numbering is not unique

The repository has multiple directories using the same numeric prefixes, e.g. several `005-*` and `006-*` specs.

Do not renumber them immediately.

Use full slugs and an indexed status model.

### 13. Directory responsibilities overlap

Examples:

- `docs/admin` vs `docs/operations`
- `docs/dev` vs `docs/development`
- backup/restore under more than one path
- current vs historical material under `docs/release`
- root-level operational documents outside logical folders

The directory taxonomy should be normalized.

## Recommended canonical documents

1. Documentation Governance
2. Product Charter
3. System Architecture
4. Runtime & Reliability
5. Connectors & Marketplace
6. Governance & Security
7. User Experience
8. Operations & Observability
9. Quality & Release
10. Current State & Roadmap

This is intentionally small.

Detailed implementation knowledge remains in `specs/` and operator runbooks.

## Key sources audited

High-authority/current sources reviewed include:

- `docs/history/source-of-truth/PRODUCT-CHARTER-Version-1.2.1-FINAL.txt`
- `docs/history/source-of-truth/MASTER-WBS-Version-1.2.1-FINAL.txt`
- `docs/architecture/source-of-truth-index.md`
- `docs/history/source-of-truth/DATA-RELAY-UX-CHARTER-v1.2.1-FINAL.txt`
- `docs/history/source-of-truth/DATA-RELAY-STREAM-WIZARD-UX-CHARTER-v5.2-FINAL.txt`
- `docs/history/source-of-truth/GOVERNANCE-UX-CHARTER-v1.1-FINAL.txt`
- `docs/reference/governance/DATA-RELAY-GOVERNANCE-WORKSPACE-v1.1-FINAL.txt`
- `docs/reference/ux/DATA-RELAY-UNION-SCHEMA-UX-SPEC-v1.1-FINAL.txt`
- `docs/ux/DATA-RELAY-SCHEMA-DRIFT-POLICY-RUNTIME-SPEC.md`
- `docs/history/architecture/marketplace/DATA-RELAY-CONNECTOR-MARKETPLACE-ARCHITECTURE-CHARTER-v1.0-DRAFT.md`
- `specs/001-core-architecture/spec.md`
- `specs/048-runtime-reliability/spec.md`
- `specs/049-template-registry/spec.md`
- `specs/091-route-processing-architecture/spec.md`
- `.specify/memory/constitution.md`
- `.specify/specs-index.md`
- `docs/runtime/runtime-capability-matrix.md`
- `docs/ux/dashboard-operational-monitoring.md`
- `docs/release/KNOWN-LIMITATIONS.md`
- `docs/operations/operator-runbook.md`
- documentation directory indexes for `docs/testing`, `docs/operations`, `docs/deployment`, `docs/release`, `docs/admin`, `docs/dev`, and `docs/development`

## Migration principle

Do not delete historical material in the same commit that introduces the new canonical docs.

Recommended two-step migration:

### Phase 1

- add `docs/canonical/*`;
- replace `docs/README.md` with the new reading order;
- add status-aware spec index;
- mark old SoT documents as superseded pointers;
- do not rewrite runtime/product code.

### Phase 2

- move historical docs into `docs/history/*`;
- unify operations/deployment/admin paths;
- update links;
- run link/reference validation;
- remove obsolete duplicate stubs only after all references are fixed.

This minimizes risk while ending append-only authority growth.
