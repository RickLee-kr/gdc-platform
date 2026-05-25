# Functional regression matrix (DataRelay / GDC)

Automated validation that core product behavior works end-to-end without manual UI clicking. Visual UI/UX review remains manual.

**Entry point:** `./scripts/testing/run-functional-regression.sh`

**Requirements:** dedicated PostgreSQL test catalog (`TEST_DATABASE_URL`) and WireMock for runtime E2E cases (`./scripts/testing/start-test-stack.sh`).

---

## Validation layers

| Layer | Scope | Primary artifacts | Marker / command |
| --- | --- | --- | --- |
| **Unit — path normalization** | Persisted vs preview vs runtime extraction paths; checkpoint path from click | `app/parsers/extraction_paths.py`, `frontend/src/utils/eventExtractionPaths.ts`, `tests/test_extraction_path_contract.py`, `frontend/src/utils/eventExtractionPaths.test.ts` | `functional_regression` |
| **Unit — event extraction** | `extract_events` with `event_array_path` + `event_root_path` | `app/parsers/event_extractor.py`, `tests/test_event_extraction_event_root.py` | `functional_regression` |
| **Service — preview / mapping contract** | Mapping draft preview uses extracted event shape; paths relative to extracted event | `app/runtime/preview_service.py`, `tests/test_functional_regression_extraction_e2e.py` (unit cases), `tests/test_runtime_mapping_draft_preview_endpoint.py` | `functional_regression` (focused subset in regression script) |
| **Runtime E2E — StreamRunner → receiver** | Full pipeline via `POST /runtime/streams/{id}/run-once` | `tests/test_functional_regression_extraction_e2e.py`, `tests/functional_regression_helpers.py` | `functional_regression`, `wiremock_integration` |
| **API E2E — entities + logs + checkpoints** | CRUD stack creation, mapping/enrichment save, delivery_logs stages, checkpoint advance rules | Same as runtime E2E; helpers query `delivery_logs` / `checkpoints` | `functional_regression` |
| **Optional Playwright** | Login / basic navigation only | Not in this suite (manual UX review) | — |

---

## Playwright Smoke Coverage

Minimal browser smoke for the Record Selection → Mapping wizard path (not a pixel/layout regression suite).

| Item | Command | Spec |
| --- | --- | --- |
| Preflight env validation | `cd frontend && npm run validate:playwright-smoke` | `frontend/scripts/validate-playwright-smoke-env.mjs` |
| Login + wizard record selection + mapping envelope-path validation + Run control reachability | `cd frontend && npm run test:playwright-smoke` | `frontend/e2e/record-selection-smoke.spec.ts` |

**Covered (automated smoke):**

- Session login through the login UI (including automatic bootstrap password change when `must_change_password=true`)
- New Stream wizard: load operational sample, select Event Source / Event Root
- Runtime Extraction summary reflects `$.Records[*].event`
- Mapping workspace shows extracted-event tree fields
- Invalid envelope-relative mapping path surfaces `ENVELOPE_RELATIVE_MAPPING_PATH` validation
- Review step loads; Run Now / Run Once control reachable on an existing stream when present

**Intentionally manual UX review:**

- Visual spacing, typography, and theme polish
- Drag-and-drop mapping (Phase 2)
- Full stream create → run-once delivery assertions (covered by backend functional regression / WireMock E2E)

### Required services

- API at `PLAYWRIGHT_API_BASE_URL` (default `http://127.0.0.1:8000`) reachable on `GET /health`
- API enforces auth: `GET /api/v1/runtime/status` returns `401` for unauthenticated requests (`REQUIRE_AUTH=true`)
- Frontend at `PLAYWRIGHT_BASE_URL` (default `http://127.0.0.1:4173`); `playwright.config.smoke.ts` auto-starts vite when needed
- `./scripts/dev/bootstrap-dev-platform.sh` ensures the platform stack, seeds, and prints the exact env vars to export

### Required environment variables

| Var | Default | Purpose |
| --- | --- | --- |
| `PLAYWRIGHT_E2E_USERNAME` | `admin` | Operator login |
| `PLAYWRIGHT_E2E_PASSWORD` | _(unset)_ | Steady operator password. **Required** once the bootstrap password has been changed. The spec also uses this as the target when changing the bootstrap `admin/admin` password. |
| `PLAYWRIGHT_E2E_BOOTSTRAP_PASSWORD` | `admin` | Password to try in bootstrap mode (first-install). |
| `PLAYWRIGHT_E2E_ALLOW_BOOTSTRAP_FALLBACK` | `true` | When `false`, the helper will not attempt the bootstrap `admin/admin` login. |
| `PLAYWRIGHT_API_BASE_URL` | `http://127.0.0.1:8000` | API base URL probed by both the preflight and the smoke spec. |
| `PLAYWRIGHT_BASE_URL` | `http://127.0.0.1:4173` | Frontend base URL used for vite/preview and Playwright `baseURL`. |

### Expected PASS output (preflight)

```
[INFO] Playwright smoke preflight
[INFO] username = "admin" (source: default(admin))
[INFO] password source = PLAYWRIGHT_E2E_PASSWORD
[INFO] api      = http://127.0.0.1:8000
[INFO] frontend = http://127.0.0.1:4173
[PASS] frontend reachable at http://127.0.0.1:4173
       HTTP 200
[PASS] API /health reachable at http://127.0.0.1:8000/health
       HTTP 200
[PASS] API requires auth (GET /runtime/status → 401)
[PASS] login OK for "admin"
       password source: PLAYWRIGHT_E2E_PASSWORD

Preflight result: PASS
```

### Expected SKIP output (smoke)

When a precondition is missing, the smoke spec skips with the exact condition. Examples:

```
Test ignored
 - Playwright smoke skipped: API unreachable (TypeError: fetch failed).
   Start the dev platform (./scripts/dev/bootstrap-dev-platform.sh) before retrying.

Test ignored
 - Playwright smoke skipped: API rejected login for username "admin"
   (password source: PLAYWRIGHT_E2E_PASSWORD; HTTP 400).
   Set PLAYWRIGHT_E2E_USERNAME / PLAYWRIGHT_E2E_PASSWORD to operator credentials,
   or run scripts/admin/reset-admin-password.sh to align the admin password.

Test ignored
 - Playwright smoke skipped: bootstrap login succeeded but must_change_password=true
   and PLAYWRIGHT_E2E_PASSWORD is not set.
   Export PLAYWRIGHT_E2E_PASSWORD=<steady password> and rerun; the spec will perform
   the password change automatically.
```

### Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `API unreachable` in preflight | API container is not running | `./scripts/dev/bootstrap-dev-platform.sh` |
| `API does not require auth (… → 200)` | API started with `REQUIRE_AUTH=false` | Restart with `REQUIRE_AUTH=true` |
| `login OK … but must_change_password=true` | Fresh install, bootstrap password not yet changed | Export `PLAYWRIGHT_E2E_PASSWORD=<steady>`; smoke spec will perform the change |
| `API rejected login for username "admin" (HTTP 400)` | Admin password was changed and `PLAYWRIGHT_E2E_PASSWORD` does not match | `./scripts/admin/reset-admin-password.sh --username admin --password '<current>'` or export the correct password |
| `no usable credentials` | `PLAYWRIGHT_E2E_PASSWORD` unset and `PLAYWRIGHT_E2E_ALLOW_BOOTSTRAP_FALLBACK=false` | Export `PLAYWRIGHT_E2E_PASSWORD`, or set the fallback to `true` |
| Browser hangs at login screen | Frontend at `PLAYWRIGHT_BASE_URL` is on a different port than the smoke config (4173) | Either align the env or restart smoke; `playwright.config.smoke.ts` auto-starts vite on 4173 |

### Running

```
cd frontend
npm run validate:playwright-smoke   # diagnostics only (no browser)
npm run test:playwright-smoke       # preflight + smoke spec
```

`pretest:playwright-smoke` runs the preflight automatically but never blocks the suite; the spec itself is the authoritative skip gate so every skip line names the condition.

Extended Record Selection workspace validation (copy actions, checkpoint evidence JSON):

`cd frontend && npx playwright test e2e/record-selection-workspace-validation.spec.ts --config=playwright.config.validation.ts`

---

## Record Selection → runtime delivery contract

| Case | Event Source | Event Root | Runtime extraction | Delivered shape |
| --- | --- | --- | --- | --- |
| **1 — nested envelope** | `$.Records` | `$.event` | `$.Records[*].event` | Only nested `event` object (no wrapper `Records`, `ResponseMetadata`, envelope fields) |
| **2 — root array** | `$` | none | `$[*]` | Full array element objects |

**Mapping rule:** field paths must be relative to the extracted event (e.g. `$.eventTime`, not `$.Records[0].event.eventTime`).

**Checkpoint rule:** click/sample `$[0].creationTime` → persisted `$.creationTime` → runtime applies-to `$[*].creationTime` (validated in path contract unit tests).

---

## Scenario matrix

| Scenario | Status | Test coverage |
| --- | --- | --- |
| HTTP API polling → Webhook destination (Records + event root) | **Automated** | `test_e2e_records_event_root_delivers_nested_event_only` |
| HTTP API polling → Webhook (root array, no event root) | **Automated** | `test_e2e_root_array_without_event_root_delivers_full_records` |
| HTTP API polling → Syslog destination | **Existing** (separate suite) | `tests/test_e2e_syslog_delivery.py` — run via `./scripts/testing/run-full-regression.sh` |
| Multi-route delivery (same mapped/enriched event) | **Automated** | `test_e2e_multi_route_fanout_same_mapped_enriched_event` |
| Destination failure → no checkpoint advance | **Automated** | `test_e2e_destination_failure_does_not_advance_checkpoint` |
| Partial success / per-event checkpoint (mixed route outcomes) | **Existing** | `tests/test_e2e_regression_matrix.py::test_e2e_route_fanout_one_log_continue_fail_one_success_checkpoint_advances` |
| Webhook Receiver source | **Existing** | `tests/test_webhook_receiver_ingest.py`, `tests/test_external_runtime_e2e.py` |
| Database Query source | **Existing (opt-in)** | `tests/test_source_adapter_e2e.py` — marker `source_e2e` |
| S3 object polling source | **Existing (opt-in)** | `tests/test_source_adapter_e2e.py`, `tests/test_s3_stream_runner_checkpoint.py` |
| Remote file polling source | **Existing (opt-in)** | `tests/test_source_adapter_e2e.py` |
| Syslog UDP/TCP capture in functional regression script | **Reuse** | Local receivers in `tests/e2e_syslog_helpers.py`; not duplicated here (see full regression) |

---

## Destination capture helpers

| Helper | Location | Purpose |
| --- | --- | --- |
| WireMock webhook journal | `tests/e2e_wiremock_helpers.py` — `wiremock_received_json_bodies` | Capture delivered JSON payloads |
| Functional regression stack builder | `tests/functional_regression_helpers.py` | HTTP polling CRUD, mapping/enrichment save, route attach, run-once |
| Syslog UDP/TCP receivers | `tests/e2e_syslog_helpers.py`, `tests/syslog_receiver.py` | In-process syslog capture (full regression / syslog script) |
| Delivery log / checkpoint queries | `tests/functional_regression_helpers.py`, `tests/e2e_runtime_helpers.py` | Post-run assertions |

WireMock fixtures for this suite:

- `tests/wiremock/mappings/template-functional-regression-records.json`
- `tests/wiremock/mappings/template-functional-regression-root-array.json`

---

## Safety

- Uses **isolated** `TEST_DATABASE_URL` only (`tests/conftest.py` truncates per test).
- Does **not** drop/truncate production or developer platform catalogs.
- Does **not** run `docker compose down -v` or destroy named volumes.
- StreamRunner remains the runtime transaction owner; tests call existing control APIs only.

---

## Remaining gaps (TODO)

| Gap | Notes |
| --- | --- |
| Record Selection E2E with Syslog destination in **this** script | Covered by `test_e2e_syslog_delivery.py`; combine via `run-full-regression.sh` if needed |
| DATABASE_QUERY / S3 / Remote File with Record Selection paths | Source adapters validated separately; cross-suite matrix entry documents opt-in runners |
| Partial per-event checkpoint on multi-event batch with one route failure | Policy-dependent; nearest test is mixed fan-out case in `test_e2e_regression_matrix.py` |
| Full wizard create → run-once delivery in Playwright | Backend functional regression / WireMock E2E; smoke only checks UI reachability |

---

## Related documentation

- `docs/testing/e2e-regression.md` — WireMock full regression bucket
- `docs/testing/external-runtime-e2e.md` — MinIO / SFTP / fixture PostgreSQL
- `docs/testing/source-adapter-e2e.md` — non-HTTP sources
- `docs/testing/regression-policy.md` — when to run which suite
