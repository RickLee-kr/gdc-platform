# Session Recovery Snapshot — 2026-05-21 15:01 UTC

Pre-reboot recovery snapshot for host memory expansion / shutdown. Captures repository state, runtime topology, validation results, and resume commands.

## Git identity

| Item | Value |
|------|-------|
| **Branch** | `feature/next-work` |
| **HEAD** | `50e6a7f` — Add audit logs MVP |
| **Remote tracking** | Up to date with `origin/feature/next-work` |
| **Unpushed commits** | None (`origin/feature/next-work` == `HEAD`) |

## Git status — short

```
(clean working tree — no modified or staged files at snapshot time)
```

## Diff statistics

**Unstaged (`git diff --stat`):** empty

**Staged (`git diff --cached --stat`):** empty

Patch backups: `working-tree.patch` and `staged.patch` are **0 bytes** (no uncommitted diffs).

## Recent commits (last 15)

See `recent-commits.txt`. Highlights:

- `50e6a7f` Add audit logs MVP *(latest, pushed)*
- `632c530` Fix runtime topology TypeScript build
- `8ba2886` / `5a81b55` Add runtime topology view MVP
- `20312d4` Add runtime pipeline debugger MVP
- `3d23966` Add replay observability backup and runtime UX improvements

## Pushed vs local

All commits on `feature/next-work` through `50e6a7f` are pushed to `origin/feature/next-work`.

## Uncommitted work

**None.** Audit logs MVP was committed and pushed in the prior terminal session (`git commit` + `git push origin feature/next-work`).

## Untracked files

At snapshot time, only this recovery directory (created by this snapshot):

- `docs/session-recovery/` (patches, inventories, this document)

No application source files are untracked.

## Implementation status (feature areas)

### Runtime topology view (spec 046)

- **Code:** Committed (`8ba2886`, `632c530` TS build fix).
- **Backend:** `GET /api/v1/runtime/topology` in `app/runtime/router.py`.
- **Frontend:** `/runtime/topology`, `runtime-topology-page.test.tsx`.
- **Running API container:** Returns **404** for `/api/v1/runtime/topology` — container image predates topology commit (not rebuilt after push).
- **Frontend tests:** `runtime-topology` vitest — **passed** (this snapshot).

### Pipeline debugger (spec 047)

- **Code:** Committed (`20312d4`).
- **Backend:** `POST /api/v1/runtime/streams/{stream_id}/pipeline-debug`.
- **Frontend:** `pipeline-debugger-panel.test.tsx`.
- **Running API:** Not verified against live container in this snapshot; in-repo tests pass.
- **Frontend tests:** `pipeline-debugger` vitest — **1 passed**.

### Audit logs MVP (new — not yet in specs-index)

- **Code:** Committed and pushed (`50e6a7f`).
- **Migration:** `alembic/versions/20260521_0023_audit_logs.py` → revision `20260521_0023_audit`.
- **Backend:** `app/audit/*`, router at `/api/v1/audit-logs/` (trailing slash on list route).
- **Frontend:** `/settings/audit-logs`, `gdcAudit.ts`, `audit-logs-page.tsx`.
- **Journal integration:** Routers record events via `journal.record_audit_event` on connector/stream/route/destination mutations and auth events.
- **Running API container:** Still on pre-audit image; exposes legacy `/api/v1/admin/audit-log` only. **404** on `/api/v1/audit-logs`.
- **Production DB (`gdc`):** `alembic_version` = `20260518_0022_net_cfg`; **`audit_logs` table does not exist**.
- **Pytest:** `tests/test_audit_logs.py` — **4 passed, 1 failed** (`test_audit_logs_list_endpoint_filters` → HTTP 404 on `GET /api/v1/audit-logs`). Likely trailing-slash route registration vs test path; verify after reboot.

## Current runtime topology (Docker Compose)

All services **Up** and healthy where healthchecks apply (snapshot 2026-05-21 15:01):

| Service | Status | Notes |
|---------|--------|-------|
| `api` | Up 3d (healthy) | Port 8000; **stale image** — alembic at `20260518_0022_net_cfg` inside container |
| `frontend` | Up 3d (healthy) | nginx; may not include latest audit/topology UI until rebuild |
| `postgres` | Up 3d (healthy) | `127.0.0.1:55432` |
| `reverse-proxy` | Up 3d (healthy) | `18443`→80, `18080`→443 |
| `gdc-wiremock-test` | Up 3d (healthy) | |
| `gdc-syslog-test` | Up 3d | |
| `gdc-webhook-receiver-test` | Up 4d | |

Host memory at last check: **9.7 GiB total**, ~6.5 GiB used, **2.6 GiB swap used** (motivation for reboot).

## Alembic migration status

| Environment | Current revision | Head in repo | `audit_logs` table |
|-------------|------------------|--------------|-------------------|
| Repo (`alembic heads`) | — | `20260521_0023_audit` | N/A |
| Docker `api` container | `20260518_0022_net_cfg` | behind | No |
| Docker `postgres` / `gdc` DB | `20260518_0022_net_cfg` | behind | No |
| Pytest catalog (`gdc_ontology_test` @ :55440) | Migrated to head during test run | at head after pytest | Yes (after migrate) |

**Conclusion:** Migration `20260521_0023_audit` is **in git but NOT applied** to the running Compose stack. Pytest applies migrations to the test catalog automatically.

## PostgreSQL test DB health

- **Default pytest catalog:** `postgresql://gdc_ontology:gdc_ontology_pw@127.0.0.1:55440/gdc_ontology_test`
- **Health check:** `SELECT 1` — **OK**
- **Policy:** `validate_host_pytest_catalog` passed

## Build results

| Target | Result | Notes |
|--------|--------|-------|
| `frontend` `npm run build` | **PASS** | tsc + vite; ~19.6s; chunk size warning only |
| Docker images | Not rebuilt this session | api/frontend containers 3 days old |

## Tests executed (this snapshot)

| Suite | Command | Result |
|-------|---------|--------|
| Audit logs API | `python3 -m pytest tests/test_audit_logs.py -q` | **4 passed, 1 failed** |
| Pipeline debugger UI | `npm test -- --run pipeline-debugger` | **1 passed** |
| Runtime topology + audit UI | `npm test -- --run runtime-topology audit-logs` | **4 passed** (2 files) |

## Known failures / issues

1. **Stale Docker API/frontend** — Code at `50e6a7f` not deployed; live API missing topology and audit-logs routes; DB missing `audit_logs`.
2. **Pytest** `test_audit_logs_list_endpoint_filters` — 404 on `GET /api/v1/audit-logs` (investigate trailing slash vs `audit_router` `@router.get("/")`).
3. **Memory pressure** — High swap use before planned reboot.

## Deferred work (post-reboot)

1. Rebuild and restart Compose stack so API/frontend match `feature/next-work` HEAD.
2. Run `alembic upgrade head` on production Compose DB (creates `audit_logs`).
3. Fix or confirm audit-logs list route path (trailing slash) and re-run `tests/test_audit_logs.py`.
4. Add spec entry for audit logs MVP under `specs/` and `.specify/specs-index.md` if continuing that track.
5. Smoke-test `/runtime/topology`, pipeline debugger panel, and `/settings/audit-logs` via reverse proxy after deploy.

## Architectural notes

- Audit logs use a **new** `audit_logs` table and `GET /api/v1/audit-logs` read API; legacy `platform_audit_events` / `GET /api/v1/admin/audit-log` remain for platform admin journal.
- Topology and pipeline-debug are read-only observability; no checkpoint or delivery_log writes.
- Constitution: Connector ≠ Stream, mapping before enrichment, checkpoint after successful delivery — unchanged.

## Recovery artifacts

| File | Purpose |
|------|---------|
| `working-tree.patch` | Unstaged diff (empty) |
| `staged.patch` | Staged diff (empty) |
| `untracked-files.txt` | `git ls-files --others --exclude-standard` |
| `recent-commits.txt` | `git log --oneline -15` |
| `recovery-commands.sh` | Post-reboot command script |

## Exact commands to continue after reboot

```bash
cd /home/aella/gdc-platform
git checkout feature/next-work
git pull origin feature/next-work
git status

# Rebuild runtime with latest code + migrations
docker compose build api frontend
docker compose up -d api frontend
docker compose exec api alembic upgrade head

# Verify migration + routes
docker compose exec postgres psql -U gdc -d gdc -c "SELECT version_num FROM alembic_version;"
docker compose exec postgres psql -U gdc -d gdc -c "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'audit_logs');"

# Backend tests
python3 -m pytest tests/test_audit_logs.py -q

# Frontend
cd frontend && npm run build && npm test -- --run runtime-topology audit-logs pipeline-debugger
```

See `recovery-commands.sh` for the full scripted sequence.

## Recoverability assessment

| Scenario | Recoverable? |
|----------|----------------|
| Git source state | **Yes** — clean tree, all work committed and pushed |
| Uncommitted patches | **N/A** — empty patches; nothing to apply |
| Untracked source | **Yes** — none besides this recovery folder |
| Runtime / DB state | **Requires action** — rebuild containers + `alembic upgrade head` |
| Test catalog | **Yes** — healthy; pytest auto-migrates |

**Overall:** Git working tree is **fully recoverable** from remote. **Runtime stack is not** aligned with HEAD until rebuild + migration.
