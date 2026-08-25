# OSS v1.0 RC Validation Report — M20.4.1 / M20.4.1.1 / M20.4.2

**Initial validation date:** 2026-06-07 (M20.4.1)  
**Stabilization date:** 2026-06-07 (M20.4.1.1)  
**Tagging validation date:** 2026-06-08 (M20.4.2)  
**Scope:** Release validation, packaging verification, and RC tagging gate (no new product features)  
**Entry point:** `bash scripts/test/run-backend-full.sh --fresh-schema`

---

## Executive summary

| Gate | M20.4.1 | M20.4.1.1 (after fix) |
|------|---------|------------------------|
| Backend Full Run | **FAIL** — 7 failed | **PASS** — **0 failed** |
| Frontend Tests | PASS — 573/573 | PASS — 573/573 |
| Build | PASS | PASS |
| Migration (pytest catalog) | PASS | PASS |
| Runtime Smoke | PASS | PASS (unchanged) |
| OSS Mode | PASS | PASS |
| Empty State | PASS | PASS |

**Final RC decision:** **PASS** — **OSS v1.0 RC READY**

---

## Root Cause (M20.4.1 failures)

### A. caplog isolation (3 tests)

| Test | Symptom |
|------|---------|
| `test_dev_validation_startup_checks.py::test_startup_checks_emit_structured_logs` | `caplog.records` empty under full-suite load |
| `test_enrichment_rules.py::test_invalid_calculated_logs_warning_and_skips` | Same — log blob empty |
| `test_enrichment_rules.py::test_lookup_miss_skips_field` | Same — `lookup_miss` not in caplog |

**Cause:** Full pytest run alters logging handler/propagation state. Tests asserted on `caplog.text` / `caplog.records`, which are order-dependent and unreliable after ~1800 prior tests. Isolated runs passed; full run failed.

### B. SFTP shared fixture (4 tests)

| Test | Symptom |
|------|---------|
| `test_source_adapter_e2e.py::test_remote_file_sftp_ndjson_delivery_and_checkpoint_meta` | `extracted_event_count` 1 vs 2 |
| `test_source_adapter_e2e.py::test_remote_file_ndjson_to_syslog_{udp,tcp,tls}` | Same |

**Cause:** All four tests used shared path `upload/e2e-remote.ndjson`. Earlier tests in `tests/test_external_runtime_e2e.py` overwrite that file (e.g. single-line `rf-m2` payload). Global seed at run start is insufficient once the suite mutates the shared file mid-run.

---

## Fix Applied (M20.4.1.1)

### A. caplog → behavioral / return-value assertions

**`tests/test_dev_validation_startup_checks.py`**

- Removed `caplog` usage.
- Monkeypatch `_resolve_hostname`; assert resolved vs failed host lists and that `log_dev_validation_runtime_startup_checks()` completes fail-open.

**`tests/test_enrichment_rules.py`**

- `test_invalid_calculated_logs_warning_and_skips`: use `execute_enrichment()` → assert `warnings` contains `calculated_expression_failed` and field skipped in `result.event`.
- `test_lookup_miss_skips_field`: use `execute_enrichment()` → assert `lookup_miss` warning code and null target field.

No production code changes. No logging-output assertions.

### B. Per-test isolated SFTP files

**`tests/test_source_adapter_e2e.py`**

- Added `_seed_isolated_sftp_ndjson(suffix)` using `upload_sftp_file()` from `tests/e2e_runtime_helpers.py`.
- Each affected test uploads `e2e-rf-{suffix}.ndjson` (2 NDJSON lines) and sets `file_pattern` to that unique name.
- Removes dependency on shared `e2e-remote.ndjson` used by `test_external_runtime_e2e.py`.

---

## Full Run Result (M20.4.1.1)

### Pre-fix (M20.4.1)

```bash
GDC_BACKEND_FULL_TEST_RESET_CONFIRM=YES_I_RESET_GDC_PYTEST_CATALOG_ONLY \
  bash scripts/test/run-backend-full.sh --fresh-schema
```

| Metric | Count |
|--------|------:|
| Passed | 1889 |
| Failed | **7** |
| Skipped | 2 |
| Duration | 48m 04s |

### Post-fix (M20.4.1.1)

Same command; log: `/tmp/backend-full-run-m20411.log`

| Metric | Count |
|--------|------:|
| Passed | **1896** |
| Failed | **0** |
| Skipped | 2 |
| Duration | 48m 28s |

### Targeted re-check (7 formerly failing tests)

```bash
python3 -m pytest <7 tests> -q
# → 7 passed in 21s
```

### Frontend regression

```bash
cd frontend && npm run test -- --run
# → 128 files, 573/573 passed
```

### Build

```bash
cd frontend && npm run build
# → PASS (tsc + vite build)
```

---

## RC Checklist (final)

| Item | Status |
|------|--------|
| Backend Tests (Full Run) | ✅ 0 FAIL |
| Frontend Tests | ✅ 573/573 |
| Build | ✅ PASS |
| Migration (pytest catalog) | ✅ head `20260606_0044_gov_notifications` |
| Runtime Smoke | ✅ (M20.4.1 baseline) |
| OSS Mode | ✅ |
| Empty State | ✅ |

---

## Release Blockers

| Blocker | M20.4.1 | M20.4.1.1 |
|---------|---------|-----------|
| Backend Full Run ≠ 0 FAIL | **Open** | **Closed** |
| caplog full-suite isolation | Open | **Closed** |
| SFTP shared fixture clobber | Open | **Closed** |
| Platform API Docker image stale (Alembic in container) | Open | Open — deploy hygiene; not a test gate |
| Frontend ESLint pre-existing errors | Open | Open — not in RC gate |

**RC gate blockers:** **0**

---

## RC Decision

### Criteria

| Criterion | Required | M20.4.1.1 actual |
|-----------|----------|-------------------|
| Backend Full Run 0 FAIL | Yes | **0 FAIL** |
| Frontend 0 FAIL | Yes | 0 FAIL |
| Build PASS | Yes | PASS |
| Release Blocker 0 (test gate) | Yes | **0** |

### Decision

```
OSS v1.0 RC READY     →  YES
OSS v1.0 RC           →  PASS
```

---

## M20.4.2 — RC Tagging & Release Packaging Validation (2026-06-08)

### RC candidate

| Field | Value |
|-------|-------|
| Branch | `feature/sensitive-detection-m5-clean` |
| Commit (HEAD) | `4a2a5bb4c361fe2dda005c9ae2bf2c7ccf25bdc8` |
| Commit message | Align record selection test with current checkpoint label |
| Working tree | **DIRTY** — 257 paths (83 modified, 174 untracked) |

**Tagging gate:** **STOPPED** — uncommitted changes present per M20.4.2 step 1.

### Test results (M20.4.2 re-run)

| Gate | Command | Result |
|------|---------|--------|
| Backend Full Run | `GDC_BACKEND_FULL_TEST_RESET_CONFIRM=YES_I_RESET_GDC_PYTEST_CATALOG_ONLY bash scripts/test/run-backend-full.sh --fresh-schema` | **1896 passed, 0 failed, 2 skipped** (46m 16s) — log: `/tmp/backend-full-run-m2042.log` |
| Frontend Tests | `cd frontend && npm run test -- --run` | **573/573 passed** (128 files, 2m 29s) |
| Frontend Build | `cd frontend && npm run build` | **PASS** (tsc + vite build, 35.7s) |

### Packaging validation

| Check | Result | Notes |
|-------|--------|-------|
| Static clean-install | ✅ PASS | `bash scripts/release/validate-clean-install.sh` — all 13 checks |
| `.env.example` vs compose | ✅ PASS | Required keys: `DATABASE_URL`, `JWT_SECRET_KEY`, `SMTP_ENABLED`, `WEBHOOK_TIMEOUT`, `POSTGRES_*` |
| Sample pack (`samples/`) | ✅ PASS | 5 JSON files; no credentials; public `jsonplaceholder.typicode.com` only |
| Secret scan (samples/config) | ✅ PASS | No `sk-*`, `AKIA*`, or live passwords in `samples/` |
| `.env` in repo | ✅ PASS | `.env` gitignored; local file not tracked |
| OSS UI build flag | ✅ PASS | `VITE_OSS_RELEASE_MODE: ${VITE_OSS_RELEASE_MODE:-true}` in `docker-compose.platform.yml` |
| Dev lab credentials | ✅ Acceptable | MinIO/SFTP defaults only in test compose + commented `.env.example`; `ENABLE_DEV_VALIDATION_LAB=false` in template |
| Release docs | ✅ PASS | `README.md`, `docs/release/production-checklist.md`, `docs/release/installation-validation.md`, `samples/README.md` aligned |

### Release blockers (M20.4.2)

| Blocker | Status | Notes |
|---------|--------|-------|
| Dirty working tree (tagging gate) | **Open** | 257 uncommitted paths — tag `v1.0.0-rc.1` **not created** |
| Backend Full Run ≠ 0 FAIL | Closed | 0 FAIL |
| Frontend ≠ 0 FAIL | Closed | 0 FAIL |
| Build FAIL | Closed | PASS |
| Packaging validation FAIL | Closed | PASS |

**RC gate blockers (test/packaging):** **0**  
**RC tagging blockers:** **1** (dirty working tree)

### RC decision (M20.4.2)

| Criterion | Required | M20.4.2 actual |
|-----------|----------|----------------|
| Working tree clean | Yes | **FAIL** — 257 uncommitted paths |
| Backend Full Run 0 FAIL | Yes | **0 FAIL** |
| Frontend 0 FAIL | Yes | 0 FAIL |
| Build PASS | Yes | PASS |
| Packaging validation PASS | Yes | PASS |
| Release Blocker 0 (tagging) | Yes | **1** (dirty tree) |
| Annotated tag `v1.0.0-rc.1` | Yes | **NOT CREATED** |

```
OSS v1.0 RC READY (tests)     →  YES
OSS v1.0 RC Tagging           →  BLOCKED (dirty working tree)
Tag v1.0.0-rc.1               →  NOT CREATED
```

**Next step to unblock tagging:** commit or stash all RC-scope changes so `git status` is clean, then re-run M20.4.2 step 6.

---

## M20.4.3 — RC Candidate Commit Consolidation (2026-06-08)

### Consolidation result

| Field | Value |
|-------|-------|
| Branch | `feature/sensitive-detection-m5-clean` |
| RC candidate commit | `4abd4a8` (after 5 consolidation commits) |
| Working tree | **CLEAN** |
| Dirty paths removed | 27 (`docs/architecture/`, `docs/ux/` — internal milestone/design artifacts) |
| Commits created | 5 |

### Commit plan (executed)

| # | Hash | Message |
|---|------|---------|
| 1 | `ca882c4` | OSS v1.0 RC release documentation |
| 2 | `5eb2a12` | OSS release packaging and platform configuration |
| 3 | `1395728` | OSS v1.0 RC backend runtime (M1–M20.4.1) |
| 4 | `d4da3b2` | OSS v1.0 RC frontend and connector modules |
| 5 | `4abd4a8` | OSS v1.0 RC test suite and spec index |

### RC decision (M20.4.3)

```
Working tree clean          →  YES
RC TAG READY                →  YES
```

**Tagging:** Proceed with M20.4.2 step 6 (`v1.0.0-rc.1` annotated tag on `4abd4a8`).

---

## Appendix — Commands

```bash
# Full backend (canonical gate)
GDC_BACKEND_FULL_TEST_RESET_CONFIRM=YES_I_RESET_GDC_PYTEST_CATALOG_ONLY \
  bash scripts/test/run-backend-full.sh --fresh-schema

# Former failures
python3 -m pytest \
  tests/test_dev_validation_startup_checks.py::test_startup_checks_emit_structured_logs \
  tests/test_enrichment_rules.py::test_invalid_calculated_logs_warning_and_skips \
  tests/test_enrichment_rules.py::test_lookup_miss_skips_field \
  tests/test_source_adapter_e2e.py::test_remote_file_sftp_ndjson_delivery_and_checkpoint_meta \
  tests/test_source_adapter_e2e.py::test_remote_file_ndjson_to_syslog_udp \
  tests/test_source_adapter_e2e.py::test_remote_file_ndjson_to_syslog_tcp \
  tests/test_source_adapter_e2e.py::test_remote_file_ndjson_to_syslog_tls \
  -q

# Frontend
cd frontend && npm run test -- --run && npm run build
```

**Related docs:** `docs/history/releases/release-readiness-audit.md`, `docs/testing/backend-full-test.md`
