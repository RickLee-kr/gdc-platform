# Data Relay Documentation Governance

**Document Version:** 2.0  
**Last Updated:** 2026-08-25  
**Status:** CANONICAL

## 1. Authority model

Data Relay documentation has different kinds of truth. They must not be collapsed into one rule.

### Product intent authority

`01-PRODUCT-CHARTER.md` defines:

- product identity
- product scope
- product non-goals
- top-level product principles

If another document proposes a product outside that scope, the Product Charter wins until the Charter is explicitly changed.

### Architecture contract authority

`02-SYSTEM-ARCHITECTURE.md` and the applicable canonical domain document define the approved architecture.

Architecture documents define **how the product is intended to work**. They do not by themselves prove implementation completion.

### Implementation truth

Runtime code, database migrations, API behavior, and executable tests define **what is implemented now**.

When implementation differs from the approved architecture:

1. record the difference;
2. classify it as a defect, incomplete implementation, compatibility behavior, or approved exception;
3. never silently rewrite architecture history to make the mismatch disappear.

### Detailed engineering reference

Numbered `specs/*` documents remain detailed contracts and design records. A spec may be current, partial, superseded, historical, or out of scope. Its numeric prefix alone does not establish authority. Full path is the identity.

### Historical evidence

Release notes, audit reports, completion reports, recovery notes, screenshots, session handoffs, and old architecture reviews are evidence only. They must never override current product or architecture contracts.

Historical evidence lives under `docs/history/` (and remaining `docs/archive/`). Older source-of-truth, architecture audits, and release snapshots must not override `docs/canonical/`.

## 2. Canonical document hierarchy

```text
Product Charter
    ↓
System Architecture
    ↓
Canonical Domain Documents
    ├ Runtime & Reliability
    ├ Connectors & Marketplace
    ├ Governance & Security
    ├ User Experience
    └ Operations & Observability
    ↓
Detailed Engineering Specs
    ↓
Code / Migrations / Tests
    ↓
Evidence / History
```

`Code / Migrations / Tests` determine implementation status, but do not expand product scope on their own.

## 3. Required status vocabulary

Every canonical or detailed design document must declare one of these statuses for material features.

| Status | Meaning |
|---|---|
| `IMPLEMENTED` | Behavior exists in code and has focused verification evidence. |
| `PARTIAL` | A meaningful subset is implemented; remaining limits are explicitly stated. |
| `TARGET` | Approved product/architecture direction, not yet implemented. |
| `BACKLOG` | Candidate work not approved as current implementation scope. |
| `OUT_OF_SCOPE` | Explicitly excluded from the current product. |
| `HISTORICAL` | Point-in-time evidence; not implementation authority. |

Avoid ambiguous status phrases such as `Implementation Ready`, `Future`, or `Proposed` without one of the above classifications.

## 4. Current vs target sections

Every canonical domain document must separate:

```text
Current implementation
Target architecture
Known gaps
Non-goals
```

Do not describe target behavior using present tense when it is not implemented.

## 5. Versioning rule

Canonical docs use one version field inside the document and one filename without duplicated embedded version history.

Recommended:

```text
docs/canonical/04-CONNECTORS-MARKETPLACE.md

Document Version: 2.0
Last Updated: 2026-08-25
```

Do not use a filename such as `v5.2-FINAL` while the internal document says `Version 3.0`.

Git history is the authoritative change history; repeated `FINAL`, `FINAL2`, and append-only addenda are prohibited for new canonical documentation.

## 6. Addendum rule

New architecture must be integrated into the relevant canonical document.

Do not append the same Marketplace, Route Processing, or Governance addendum to dozens of unrelated files.

A detailed spec may link to the canonical rule instead.

## 7. Language policy

Official project documentation, committed product text, APIs, code comments, tests, schemas, and examples are English-only.

Korean may be used in:

- external discussion
- temporary development prompts
- non-committed working notes

Existing Korean source-of-truth documents are migration inputs, not a reason to continue mixed-language canonical documentation.

## 8. Spec governance

The current `specs/` tree contains duplicate numeric prefixes. Therefore:

- do not use the number alone as a unique identifier;
- use the full directory slug;
- add status/domain metadata to the spec index;
- do not mass-renumber existing specs because links and history would break.

Spec-index columns:

```text
Path | Domain | Status | Canonical Parent | Notes
```

Status values for specs:

```text
CURRENT | PARTIAL | TARGET | HISTORICAL | OUT_OF_SCOPE
```

## 9. Documentation change checklist

A product or architecture change is complete only when:

- applicable canonical doc is updated;
- implementation status is accurate;
- detailed spec is linked if needed;
- old conflicting docs are marked or scheduled for Phase 2 classification;
- no new duplicate authority is created;
- links are validated.

## 10. AI/Cursor reading rule

For development work:

1. Read this document.
2. Read Product Charter.
3. Read System Architecture.
4. Read the applicable canonical domain document.
5. Read only the detailed specs necessary for the task.
6. Verify current behavior in code and tests.
7. Do not use archived audits, old release notes, session recovery, or superseded source-of-truth files as current design authority.
