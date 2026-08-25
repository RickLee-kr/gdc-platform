# Documentation Migration Map

**Document Version:** 3.0  
**Last Updated:** 2026-08-25  
**Status:** CANONICAL (Phase 3 complete)  
**Companion:** [`DOCUMENTATION-INVENTORY.md`](./DOCUMENTATION-INVENTORY.md)  
**Rule:** Preserve history; reduce authority.

Disposition vocabulary:

| Disposition | Meaning |
|---|---|
| `CANONICAL` | Current authority lives in `docs/canonical/`. |
| `REFERENCE_CURRENT` | Detailed engineering/operator reference; subordinate to canonical. |
| `HISTORICAL` | Point-in-time evidence; never overrides canonical. |
| `OUT_OF_SCOPE` | Outside current Data Relay OSS product scope. |

Move phases:

| Phase | Action |
|---|---|
| **2A** | Full inventory; SoT SUPERSEDED headers; stale Marketplace/status fixes; capability matrix alignment; **no** `git mv` |
| **2B** | Physical relocation into `docs/history/*`, `docs/operations/{deployment,administration,troubleshooting,data-management}/`, `docs/development/`, `docs/reference/` |
| **3 (this commit)** | Reduce REFERENCE surface; fold architecture overview into canonical; move detailed architecture contracts under `docs/reference/architecture/`; create `docs/reference/README.md`; prune verified `docs/tmp/**` and `_incoming/` staging duplicates |

---

## 1. `docs/canonical/`

Unchanged as top-level product documentation authority.

---

## 2. Architecture surface (Phase 3)

| Result | Location |
|---|---|
| Architecture explanation authority | `docs/canonical/02-SYSTEM-ARCHITECTURE.md` (+ domain canonical docs) |
| Compatibility stub (former OSS overview) | `docs/architecture/OSS-v1-ARCHITECTURE.md` → body at `docs/history/architecture/OSS-v1-ARCHITECTURE.md` |
| Compatibility SoT index | `docs/architecture/source-of-truth-index.md` |
| Credential encryption contract | `docs/reference/architecture/credential-encryption-at-rest.md` |
| Route Processing persist roadmap | `docs/reference/architecture/route-processing-persist-roadmap.md` |
| Detailed reference index | `docs/reference/README.md` |

---

## 3. Former `docs/source-of-truth/`

| Result | Location |
|---|---|
| Historical / superseded SoT | `docs/history/source-of-truth/` |
| `_incoming/` staging txt duplicates | **Deleted in Phase 3** (corrected copies retained under history/reference); README remains |
| Governance / Union Schema reference detail | `docs/reference/governance/`, `docs/reference/ux/` |
| Compatibility pointer | `docs/source-of-truth/README.md` |

---

## 4. `docs/tmp/` (Phase 3)

| Result | Location |
|---|---|
| Canonical draft `00`–`09` duplicates | **Deleted** (canonical tree is authority) |
| Marketplace charter tmp duplicate | **Deleted** (history marketplace copy retained) |
| Audit report / migration draft / addenda / apply script | `docs/history/documentation-v2-campaign/` |
| `docs/tmp/` directory | **Removed** |

---

## 5. Operations / UX / testing / release

Unchanged from Phase 2B layout. Runbooks remain under `docs/operations/`, `docs/testing/`, `docs/development/`, `docs/release/`, `docs/getting-started/`. UX contracts remain under `docs/ux/` (+ `docs/reference/ux/`).

---

## 6. `specs/` · `.specify/`

**Unchanged paths in Phase 3.** Historical and AI Gateway specs remain under `specs/` (optional future archive). `SPECS_MOVED=NO`.

---

## 7. Phase sequence

### Phase 1 — complete

Canonical tree + docs hub + constitution / specs-index.

### Phase 2A — complete

Inventory + SUPERSEDED headers + Marketplace/status corrections (no moves).

### Phase 2B — complete

- `git mv` historical trees into `docs/history/*`
- Operations + development consolidation
- Link sweep for active references

### Phase 3 — complete (this commit)

- Fold OSS architecture overview into canonical (body → history; stub retained)
- Move detailed architecture contracts → `docs/reference/architecture/`
- Create `docs/reference/README.md`
- Archive/delete verified tmp and `_incoming` staging duplicates
- Refresh inventory + migration map

---

## 8. Explicit Phase 3 non-actions (preserved)

- Do not alter runtime/product code logic, migrations, or tests (doc path strings only where relocated)
- Do not renumber or bulk-move `specs/`
- Do not mass-merge detailed specs into canonical
- Do not delete historical evidence that is not a verified duplicate
