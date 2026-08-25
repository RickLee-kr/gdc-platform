# Documentation Migration Map

**Document Version:** 2.2  
**Last Updated:** 2026-08-25  
**Status:** CANONICAL (Phase 2B complete)  
**Companion:** [`DOCUMENTATION-INVENTORY.md`](./DOCUMENTATION-INVENTORY.md)  
**Rule:** Preserve history; reduce authority.

Disposition vocabulary:

| Disposition | Meaning |
|---|---|
| `CANONICAL` | Current authority lives in `docs/canonical/`. |
| `REFERENCE_CURRENT` | Detailed engineering/operator reference; subordinate to canonical. |
| `HISTORICAL` | Point-in-time evidence; never overrides canonical. |
| `OUT_OF_SCOPE` | Outside current Data Relay OSS product scope. |
| `DUPLICATE_TO_CONSOLIDATE` | Resolved in Phase 2B (count now 0 for moved trees). |

Move phases:

| Phase | Action |
|---|---|
| **2A** | Full inventory; SoT SUPERSEDED headers; stale Marketplace/status fixes; capability matrix alignment; **no** `git mv` |
| **2B (this commit)** | Physical relocation into `docs/history/*`, `docs/operations/{deployment,administration,troubleshooting,data-management}/`, `docs/development/`, `docs/reference/` |
| **Phase 3** | Optional archive of historical/OOS `specs/*`, prune `docs/tmp/**` / verified `_incoming/` duplicates, relative-link hardening inside history |

---

## 1. `docs/canonical/`

Unchanged. Top-level product documentation authority remains **`docs/canonical/`**.

---

## 2. Former `docs/source-of-truth/`

| Result | Location |
|---|---|
| Historical / superseded SoT | `docs/history/source-of-truth/` (+ `_incoming/`) |
| Governance / Union Schema reference detail | `docs/reference/governance/`, `docs/reference/ux/` |
| Compatibility pointer | `docs/source-of-truth/README.md` |

---

## 3. `docs/architecture/`

| Result | Location |
|---|---|
| Marketplace Charter v1.0 Draft | `docs/history/architecture/marketplace/` |
| M13 / audits / gap analyses | `docs/history/architecture/` (+ `m13/`) |
| AI Gateway specs | `docs/history/out-of-scope/ai-gateway/` |
| Remaining REFERENCE_CURRENT | `OSS-v1-ARCHITECTURE.md`, `credential-encryption-at-rest.md`, `route-processing-persist-roadmap.md`, `source-of-truth-index.md` |

---

## 4. `docs/ux/` / `docs/release/` / `docs/testing/` / performance

| Result | Location |
|---|---|
| M30.x reports | `docs/history/ux/` |
| RC/GA notes & readiness snapshots | `docs/history/releases/` |
| QA automation audit | `docs/history/testing/` |
| Performance phase reports | `docs/history/performance/` |
| Current UX / release / testing procedures | remain in `docs/ux/`, `docs/release/`, `docs/testing/` |

---

## 5. Operations consolidation (applied)

```text
docs/operations/
├── deployment/          # install, upgrade, TLS, offline, migration*, release-checklist, docker-platform
├── administration/      # maintenance-center, auth-session, admin-password-reset
├── troubleshooting/     # support-bundle, support-diagnostics
├── data-management/     # backup-restore (authority), retention, historical-materialization
└── operator-runbook.md
```

Former `docs/admin/` and `docs/deployment/` directories removed after migration.

**Backup/restore authority:** `docs/operations/data-management/backup-restore.md`  
(Compose-only duplicate archived at `docs/history/implementation-reports/deployment-backup-restore-compose.md`.)

---

## 6. Development consolidation (applied)

| Former | Current |
|---|---|
| `docs/dev/*` | `docs/development/` |
| `docs/local-docker-workflow.md` | `docs/development/local-docker-workflow.md` |

`docs/dev/` eliminated.

---

## 7. `specs/` · `.specify/`

Unchanged paths in Phase 2B. Historical and AI Gateway specs remain under `specs/` (Phase 3 optional relocation).

---

## 8. Phase sequence

### Phase 1 — complete

Canonical tree + docs hub + constitution / specs-index.

### Phase 2A — complete

Inventory + SUPERSEDED headers + Marketplace/status corrections (no moves).

### Phase 2B — complete (this commit)

- `git mv` historical trees into `docs/history/*`
- Operations + development consolidation
- Link sweep for active references
- Inventory / migration map path updates

### Phase 3 — remaining

- Optionally relocate historical/OOS `specs/*` into `docs/history/specs/` or `docs/history/out-of-scope/ai-gateway/`
- Prune or archive `docs/tmp/**` working drafts
- Optional delete of verified `_incoming/` byte-duplicates after content verify
- Continue relative-link cleanup inside already-historical documents
- Fold remaining architecture REFERENCE_CURRENT into `docs/reference/architecture/` if desired

---

## 9. Explicit Phase 2B non-actions (preserved)

- Do not alter runtime/product code logic, migrations, or tests (doc path strings in messages/scripts updated only where they referenced relocated docs)
- Do not renumber or bulk-move `specs/`
- Do not promote `docs/tmp/*` as authority
- Do not rewrite historical document body content beyond path/link fixes and minimal duplicate merges
