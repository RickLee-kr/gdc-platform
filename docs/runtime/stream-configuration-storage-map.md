# Stream Configuration Storage Map

This document maps where stream configuration is persisted, which APIs read/write it, and how the wizard and Configuration tab interact with each layer.

**Primary backend service:** `app/runtime/stream_configuration_service.py`  
**Primary runtime router:** `app/runtime/router.py` (approx. L1058–1264)  
**Primary frontend client:** `frontend/src/api/gdcStreamConfiguration.ts`

---

## Storage overview

| Layer | Table / location | Typical keys / columns |
|-------|------------------|------------------------|
| Stream identity & schedule | `streams` | `name`, `stream_type`, `enabled`, `status`, `polling_interval`, `connector_id`, `source_id`, `rate_limit_json` |
| HTTP request & wizard advanced | `streams.config_json` | `method`, `endpoint`, `headers`, `params`, `body`, `pagination`, `checkpoint`, `incremental_fetch`, `deduplication`, `wizard_sample_data`, `union_schema`, `incremental_test` |
| Source / auth | `sources` | `config_json`, `auth_json` |
| Mapping / transform mode | `mappings` | `field_mappings_json`, `event_array_path`, `event_root_path` |
| Enrichment rules | `enrichments` | `enrichment_json` (`__rules.{target}` with `type`, fields) |
| Runtime checkpoint | `checkpoints` | `checkpoint_type`, `checkpoint_value_json` |
| Replay jobs | `backfill_jobs` | ephemeral job rows (not stream config) |
| Wizard draft (create only) | `localStorage` | `gdc-stream-wizard-draft-v2` |

---

## 1. Stream 기본 설정

| | |
|---|---|
| **저장 위치** | `streams` table: `name`, `stream_type`, `enabled`, `status`, `polling_interval`, `connector_id`, `source_id`, `rate_limit_json` |
| **저장 API** | `PUT /api/v1/streams/{stream_id}` → `update_stream()` (`app/streams/router.py`) |
| **조회 API** | `GET /api/v1/streams/{stream_id}` → `get_stream()` |
| **Frontend 저장** | `updateStream()` (`frontend/src/api/gdcStreams.ts`) |
| **Frontend 조회** | `fetchStreamById()` |
| **Wizard Create** | `buildStreamCreatePayload()` → `createStream()` (`new-stream-wizard-page.tsx`, `wizard-state.ts`) |
| **Wizard Edit** | `persistWizardStreamEdits()` → `updateStream()` (`wizard-stream-persist.ts`) |
| **Configuration 탭** | Section **Stream**, **Schedule**, **Rate Limit & Timeout** via `get_stream_configuration()` |

---

## 2. Connector / Auth / Request 설정

### Connector (identity)

| | |
|---|---|
| **저장 위치** | `connectors`: `name`, `product_group`, `description`, `status` |
| **저장 API** | `PUT /api/v1/connectors/{connector_id}` |
| **조회 API** | `GET /api/v1/connectors/{connector_id}` |
| **Frontend** | `updateConnector()` / `fetchConnectorById()` (`gdcConnectors.ts`) |
| **Wizard** | Select only — connector is not created by stream wizard |
| **Configuration 탭** | Section **Connector** |

### Source auth & base URL

| | |
|---|---|
| **저장 위치** | `sources.config_json`, `sources.auth_json` |
| **저장 API** | `PUT /api/v1/connectors/{connector_id}` (updates linked `Source`) |
| **Configuration 탭** | Section **Authentication** |

### Per-stream HTTP request

| | |
|---|---|
| **저장 위치** | `streams.config_json`: `method`/`http_method`, `endpoint`/`url`, `headers`, `params`, `body`/`request_body`, `timeout_seconds`, `pagination`, `checkpoint`, `schema`, `runtime_ui` |
| **저장 API** | `PUT /api/v1/streams/{stream_id}` (wizard); `POST /api/v1/runtime/streams/{id}/rate-limit/save` (rate limit only) |
| **Frontend 저장** | `buildStreamConfigPayload()` + `buildAdvancedStreamConfigJsonPatch()` → `mergeStreamConfigJson()` (`wizard-stream-config-sync.ts`) |
| **Frontend 조회** | `streamConfigPatchFromRead()` + `readAdvancedStreamConfigFromPersisted()` (`wizard-stream-hydrate.ts`) |
| **Wizard Create/Edit** | Merged into `config_json` on `createStream` / `persistWizardStreamEdits` |
| **Configuration 탭** | Sections **Request**, **Pagination**, **Incremental Query** |

---

## 3. Sample Data

| | |
|---|---|
| **저장 위치** | `streams.config_json.wizard_sample_data` (`sample_events`, `sample_count`, `last_test_response`, `event_root_path`, `record_path`, `saved_at`); paths also on `mappings.event_root_path`, `mappings.event_array_path` |
| **저장 API** | `PUT /api/v1/runtime/streams/{stream_id}/sample-data` → `save_stream_sample_data()` |
| **조회 API** | `GET /api/v1/runtime/streams/{stream_id}/sample-data` → `get_stream_sample_data()` |
| **Frontend 저장** | `saveStreamSampleData()`; wizard: `persistWizardSampleData()` / `buildWizardSamplePersistPayload()` (`wizard-sample-persist.ts`) |
| **Frontend 조회** | `fetchStreamSampleData()`; wizard hydrate: `apiTestPatchFromPersistedSample()` |
| **Wizard Create** | `persistWizardStreamArtifacts()` after `createStream()` (`wizard-stream-artifacts-persist.ts`) |
| **Wizard Edit** | `persistWizardStreamEdits()` → `persistWizardStreamArtifacts()` |
| **Configuration 탭** | `StreamConfigurationTab` Sample Data block (`stream-configuration-tab.tsx`) |

---

## 4. Union Schema

| | |
|---|---|
| **저장 위치** | `streams.config_json.union_schema` (`total_events`, `fields`, `snapshot_at`) |
| **저장 API** | `PUT /api/v1/runtime/streams/{stream_id}/sample-data` (union included in sample payload); wizard also `updateStream({ config_json.union_schema })` via `persistWizardUnionSchema()` |
| **조회 API** | `GET /api/v1/runtime/streams/{stream_id}/sample-data` |
| **Frontend** | `saveStreamSampleData()` / `fetchStreamSampleData()`; `wizard-union-schema-persist.ts` |
| **Configuration 탭** | Sample Data section shows union field count |

---

## 5. Incremental Fetch

| | |
|---|---|
| **저장 위치** | `streams.config_json.incremental_fetch`: `strategy`, `watermark_field`, `cursor_field`, `tie_breaker_field`, `stability_lag_seconds`, `initial_lookback_seconds` |
| **Runtime state** | `checkpoints.checkpoint_value_json`: `incremental_fetch_watermark`, `connector_cursor`, `delivery_checkpoint`, `last_fetch_at`, `last_delivery_at`, `fetch_window` |
| **저장 API** | `PUT /api/v1/runtime/streams/{stream_id}/incremental-fetch` → `save_stream_incremental_fetch()` |
| **조회 API** | `GET /api/v1/runtime/streams/{stream_id}/incremental-fetch` → `get_stream_incremental_fetch()` |
| **Frontend 저장** | `saveStreamIncrementalFetch()`; panel `StreamIncrementalFetchPanel.onSave()` |
| **Frontend 조회** | `fetchStreamIncrementalFetch()`; wizard: `readAdvancedStreamConfigFromPersisted()` |
| **Wizard Create/Edit** | Also merged via `buildAdvancedStreamConfigJsonPatch()` into `config_json.incremental_fetch` |
| **Configuration 탭** | Section **Incremental Fetch** + editable `StreamIncrementalFetchPanel` |

Logic: `app/runtime/incremental_fetch.py`; runner integration: `app/runners/stream_runner.py`.

---

## 6. Incremental Test 결과

| | |
|---|---|
| **저장 위치** | `streams.config_json.incremental_test` (`result`, `checkpoint_test_result`, `tested_at`); mirrored in sample-data API fields |
| **저장 API** | `POST /api/v1/runtime/streams/{stream_id}/incremental-test` → `run_stream_incremental_test()`; manual via `PUT .../sample-data` |
| **조회 API** | `GET /api/v1/runtime/streams/{stream_id}/sample-data` (`incremental_test_result`, `checkpoint_test_result`) |
| **Frontend** | `runStreamIncrementalTest()`; wizard test: `IncrementalRequestTestSection` (pre-save preview only) |
| **Wizard persist** | `buildWizardSamplePersistPayload()` includes test summary |
| **Configuration 탭** | `StreamIncrementalTestPanel` |

---

## 7. Deduplication

| | |
|---|---|
| **저장 위치** | `streams.config_json.deduplication`: `enabled`, `key_field`, `custom_jsonpath`, `duplicate_handling`, `scope`, `window_hours` |
| **Runtime stats** | `delivery_logs` stages `dedup_queue_insert`, `run_complete`, `dedup_registry` |
| **저장 API** | `PUT /api/v1/runtime/streams/{stream_id}/deduplication` → `save_stream_deduplication()` |
| **조회 API** | `GET /api/v1/runtime/streams/{stream_id}/deduplication` → `StreamDedupRuntimeStatus` |
| **Frontend** | `saveStreamDeduplication()` / `fetchStreamDeduplication()`; `StreamDedupPanel` |
| **Wizard** | Not persisted by wizard today — configure on Configuration tab or post-create |
| **Configuration 탭** | Section **Deduplication** + `StreamDedupPanel` (settings + recent runtime counters) |

Runtime: `app/runners/stream_dedup.py` via `StreamRunner`.

### Runtime summary fields (`GET .../deduplication`)

| Field | Meaning |
|---|---|
| `last_runtime_duplicate_count` | Duplicate events from the latest summary |
| `last_runtime_dedup_summary` | Latest counters: `total_events`, `inserted`, `duplicate_events`, `duplicate_handling`, `dedup_scope`, `recorded_at` |
| `last_runtime_stats_degraded` | `true` when the stats query timed out / failed open (panel remains editable) |

Stats are read from recent `delivery_logs` (24h lookback). When the query times out, the API returns config with `last_runtime_stats_degraded=true` and an empty summary instead of failing the Configuration page.

### Registry seed lookback limit

`load_dedup_seed_keys()` reads prior `dedup_registry` rows with **`ORDER BY id DESC LIMIT 500`**.

This is an operational bound so scoped dedup (`checkpoint_window` / `last_n_hours`) does not scan unbounded registry history on every run. Keys beyond the newest 500 registry log rows in the active scope window are not seeded into the current-run queue. Operators should treat 500 as a soft capacity for recent delivered keys, not a full historical registry.
---

## 8. Timestamp Conversion

| | |
|---|---|
| **저장 위치** | `enrichments.enrichment_json.__rules.{targetField}` with `type: "timestamp_conversion"`, `source_field`, `input_format`, `output_format`, `timezone`, `on_failure`, `expression_override`, `enabled` |
| **저장 API** | `POST /api/v1/runtime/streams/{stream_id}/mapping-ui/save` → `save_stream_mapping_ui_config()` (`control_service`) |
| **조회 API** | `GET /api/v1/runtime/streams/{stream_id}/mapping-ui/config` |
| **Frontend 저장** | `saveStreamMappingUiConfigStrict()`; wizard: `enrichmentDictFromRules()` → stream create/edit persist |
| **Frontend 조회** | `fetchStreamMappingUiConfig()`; wizard: `normalizeWizardEnrichmentRules()` (`wizard-stream-hydrate.ts`) |
| **Configuration 탭** | Section **Timestamp Conversion** via `_timestamp_conversion_sections()` |

Runtime: `app/enrichers/timestamp_conversion.py` → `rule_executor._apply_timestamp_conversion()`.

---

## 9. Type Conversion

| | |
|---|---|
| **저장 위치** | `enrichments.enrichment_json.__rules.{targetField}` with `type: "type_conversion"`, `source_field`, `target_type`, `on_failure`, `enabled` |
| **저장 API** | Same as Timestamp Conversion — `POST .../mapping-ui/save` |
| **조회 API** | `GET .../mapping-ui/config` |
| **Frontend** | Transform Add menu → **Type Conversion**; `enrichment-rules-model.ts` serializes to `__rules` |
| **Configuration 탭** | Section **Type Conversion** via `_type_conversion_sections()` |

Runtime: `app/enrichers/type_conversion.py` → `rule_executor._apply_type_conversion()`.

Supported `target_type`: `string`, `integer`, `long`, `float`, `double`, `boolean`, `datetime`, `array`, `object`, `json`.

---

## 10. Checkpoint (Fetch / Delivery / Legacy)

| | |
|---|---|
| **저장 위치** | `checkpoints`: `stream_id`, `checkpoint_type`, `checkpoint_value_json`, `updated_at` |
| **Framework keys** | `incremental_fetch_watermark`, `connector_cursor`, `delivery_checkpoint`, `last_fetch_at`, `last_delivery_at`, `fetch_window` |
| **Config metadata** | `streams.config_json.checkpoint` (mode, cursor_path), wizard paths on mapping |
| **저장 API** | `PUT /api/v1/runtime/streams/{stream_id}/checkpoint`; reset: `POST .../checkpoint/reset` |
| **조회 API** | `GET /api/v1/runtime/streams/{stream_id}/checkpoint` (splits fetch/delivery via `split_checkpoint_for_display()`) |
| **Runtime updates** | `CheckpointService` / `StreamRunner` after successful delivery |
| **Frontend** | `updateStreamCheckpointManage()` / `fetchStreamCheckpointManage()`; `StreamCheckpointPanel` |
| **Wizard** | Checkpoint **paths** in `config_json.checkpoint`; values are runtime-only |
| **Configuration 탭** | Section **Checkpoint** + `StreamCheckpointPanel` |

---

## 11. Replay

| | |
|---|---|
| **저장 위치** | No persistent replay settings on stream. Results: `backfill_jobs` rows; ephemeral API response |
| **실행 API** | `POST /api/v1/runtime/streams/{stream_id}/replay` → `run_stream_operational_replay()` |
| **조회 API** | `GET .../replay/summary`, `GET .../replay-events` (replay center) |
| **Frontend** | `runStreamOperationalReplay()`; `StreamReplayPanel` (state only) |
| **Configuration 탭** | `StreamReplayPanel` (interactive, no persisted settings) |

Backfill: `app/backfill/service.py`.

---

## 12. Wizard Resume

| | |
|---|---|
| **저장 위치** | **Browser only:** `localStorage` key `gdc-stream-wizard-draft-v2` (create wizard `/streams/new`) |
| **저장/조회** | `saveWizardDraft()` / `loadWizardDraft()` (`wizard-draft-migration.ts`) |
| **Wizard Create** | Auto-restore on mount; auto-save on step change; `clearWizardDraft()` on deploy |
| **Wizard Edit** | `hydrateWizardStateFromStream(streamId)` — **no localStorage** (`stream-edit-wizard-page.tsx`) |
| **Configuration 탭** | Link **Edit Stream (Resume Wizard)** → `streamEditPath()` |

Artifact orchestration on deploy/edit:

- `wizard-stream-persist.ts` — stream + mapping + enrichment
- `wizard-stream-artifacts-persist.ts` — sample, union, incremental test artifacts
- `wizard-sample-persist.ts` — sample-data API payload
- `wizard-stream-config-sync.ts` — `config_json` advanced patch (incremental fetch, checkpoint paths, request)

---

## API quick reference

| Concern | PUT/POST (save) | GET (load) |
|---------|-----------------|------------|
| Stream catalog | `PUT /api/v1/streams/{id}` | `GET /api/v1/streams/{id}` |
| Full configuration view | — | `GET /api/v1/runtime/streams/{id}/configuration` |
| Sample + union + test artifacts | `PUT .../sample-data` | `GET .../sample-data` |
| Incremental fetch | `PUT .../incremental-fetch` | `GET .../incremental-fetch` |
| Incremental test | `POST .../incremental-test` | (via sample-data) |
| Dedup | `PUT .../deduplication` | `GET .../deduplication` |
| Checkpoint | `PUT .../checkpoint` | `GET .../checkpoint` |
| Enrichment / transform rules | `POST .../mapping-ui/save` | `GET .../mapping-ui/config` |
| Replay | `POST .../replay` | `GET .../replay/summary` |

---

## Configuration tab wiring note

`StreamConfigurationTab` (`stream-configuration-tab.tsx`) consumes `fetchStreamConfiguration()`, `fetchStreamSampleData()`, and sub-panels for incremental fetch, dedup, checkpoint, replay, and incremental test.

Ensure the runtime detail page renders `activeTab === 'configuration'` with `StreamConfigurationTab` when enabling the tab in `stream-runtime-detail-page.tsx`.
