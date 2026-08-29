# Agent 4 — Connector Ecosystem / Harvester Audit

> **Closure (2026-08-29):** Scheduled OSS Fit implementation is complete. W7 is COMPLETE (static dlt/Meltano harvest; no tap runtime). W14 remains `DEFERRED_PRODUCT_DECISION`. This file remains the pre-implementation audit record. See [DATA-RELAY-OSS-IMPLEMENTATION-WORKPLAN.md](./DATA-RELAY-OSS-IMPLEMENTATION-WORKPLAN.md).

## Correct-branch reconciliation

**Reconcile date:** 2026-08-29  
**Independent re-verification:** 2026-08-29 — `build_default_harvester_registry` registers singer/meltano/otel/fluent_bit/telegraf; **no dlt**; `MeltanoHarvesterAdapter` is a `SingerHarvesterAdapter` alias; Telegraf/Fluent Bit are fixture skeletons.  
**Codebase:** `/home/aella/gdc-oss-reconcile`  
**Branch:** `audit/code-to-oss-fit-reconcile` (tracks `origin/feature/post-m29-development`)  
**HEAD:** `99dd3bac886760460201f54deaaa282ec0e98bc1`  
**Architecture authority:** `docs/canonical/04-CONNECTORS-MARKETPLACE.md`  
**Old audit workspace (STALE for code):** `fix/route-processing-ux-p0-1-classification-policy` @ `1f270e8` — that tree did **not** contain `app/connectors_registry/harvester/` or marketplace lifecycle modules. This branch **does**.

OSS clone research in the original Agent 4 body below remains valid (Meltano SDK / Singer / Telegraf / OTel / Fluent Bit / dlt / Camel field maps, licenses, REJECT-as-runtime). Implementation-status claims from that pass are **stale** and must not drive the workplan.

### What this branch actually implements

Canonical M29.6 (`docs/canonical/04-CONNECTORS-MARKETPLACE.md` §5): deterministic V1 harvester under `app/connectors_registry/harvester/`. Pipeline is knowledge-only (no upstream execution), license-gated, draft Source Pack only, never auto-install / auto-enable / Verified promotion.

Entry: `HarvesterService.harvest_and_import` (`app/connectors_registry/harvester/service.py`) → adapter `harvest()` → `evaluate_license_policy` → `write_source_pack` (`harvester/package_builder.py`) → `assert_package_secrets_clean` + `validate_marketplace_package`. Flag `REMOTE_ACQUISITION_IMPLEMENTED = False` (harvester does not fetch HTTPS).

Adapter registry: `build_default_harvester_registry` (`harvester/registry.py`) registers `singer`, `meltano`, `otel`, `fluent_bit`, `telegraf`. **No `dlt` adapter. No Camel adapter.** Contract: `HarvesterSourceAdapter.harvest` MUST NOT execute upstream code, HTTP, or git clone (`harvester/sources/base.py`).

Tests: `tests/test_marketplace_connector_harvester.py`.

### 1. Singer harvester — implemented (static files, not tap execution)

**Class:** `SingerHarvesterAdapter.harvest` / `_harvest_static_tap_layout` (`app/connectors_registry/harvester/sources/singer.py`).

| Input | Function | What is extracted |
| --- | --- | --- |
| Structured fixture (`harvester.yaml` / `metadata.json`) | `harvest` → `normalize_harvested_dict` | Pre-normalized knowledge |
| `meltano.yml` / `singer.yml` | `_harvest_static_tap_layout` | extractor `name` / `version` / license |
| `config.schema.json` / `tap_config.schema.json` / `config_schema.json` | `_auth_from_config_schema` | auth type heuristic from property names (`api_key`/`token` → `api_key`; `username`+`password` → `basic`; `client_id`+`client_secret` → `oauth2_client_credentials`); required field names |
| `catalog.json` / `tap_catalog.json` / `discover.json` | `_streams_from_catalog` | `tap_stream_id`, schema properties → `SchemaFieldKnowledge`, `replication-key` → `CheckpointKnowledge.cursor_field` (fetch-watermark hint only), `path`/`http_method` **only when present** |
| `LICENSE*` | substring MIT / Apache-2.0 | license identifier |

Mapping gate: package generation only when at least one stream has **explicit** REST `path` **and** `http_method` (`MappingStatus.MAPPED` → `HTTP_API_POLLING`). Catalog streams without REST evidence stay `UNSUPPORTED` knowledge (no fabricated endpoints). Notes: `"Harvested from static Singer/Meltano files only; tap was not executed."`

**Not implemented (original P1 Meltano REST reader):** no AST walk of `RESTStream.path` / `url_base` / `records_jsonpath` / `Tap.config_jsonschema` Python class attributes. No `singer_sdk` import. No `--discover` execution. Fixture `tests/fixtures/harvester/singer/tap_snapshot/` is a static `catalog.json` that already embeds `http_method`+`path` (not a live Meltano REST class).

Golden path: `test_singer_static_snapshot_harvest` asserts `replication-key` `updated_at` and `package_generated is True`.

### 2. Telegraf harvester — fixture-backed skeleton only

**Class:** `TelegrafHarvesterAdapter.harvest` (`app/connectors_registry/harvester/sources/telegraf.py`).

- Structured `harvester.yaml` / `harvester.json` → `normalize_harvested_dict`.
- Directory snapshot **without** that fixture returns `MappingStatus.UNSUPPORTED` with reason `"Telegraf adapter is fixture-backed in M29.6 V1"` and note `"Telegraf full plugin harvest not implemented in V1."`
- **Does not** parse `sample.conf`, Go ``toml:"..."`` tags, or `PluginDescriber.SampleConfig()`.

Test: `test_fluent_bit_and_telegraf_fixture_backed` — Telegraf fixture `tests/fixtures/harvester/telegraf/harvester.yaml` is explicitly `mapping_status: UNSUPPORTED` → `package_generated is False`.

### 3. OTel harvester — implemented (static metadata.yaml / fixture)

**Class:** `OpenTelemetryHarvesterAdapter.harvest` / `_from_structured` / `_map_otel_component` (`app/connectors_registry/harvester/sources/otel.py`).

- Reads `metadata.yaml` / `harvester.yaml` (not Go runtime).
- `_map_otel_component`: exporters/processors/extensions → `UNSUPPORTED`; HTTP poll evidence (`path`+`http_method`, or `transport`/`tags` in `{http,rest,polling,scraper}`) → `HTTP_API_POLLING`; webhook hints → `WEBHOOK_RECEIVER`; otherwise knowledge-only (does **not** invent HTTP_API_POLLING).
- Streams from `endpoints`/`streams` mappings; auth from `auth` object when present.

Tests: `test_otel_supported_mapping` (`tests/fixtures/harvester/otel/supported_http_receiver.yaml`); `test_otel_unsupported_receiver_stays_knowledge`.

### 4. Fluent Bit harvester — fixture-backed skeleton only

**Class:** `FluentBitHarvesterAdapter.harvest` (`app/connectors_registry/harvester/sources/fluent_bit.py`). Same pattern as Telegraf: structured fixture → `normalize_harvested_dict`; otherwise `UNSUPPORTED` stub (`"Fluent Bit full config harvest not implemented in V1."`). **Does not** parse `flb_config_map` / `in_*.c`.

Test fixture `tests/fixtures/harvester/fluent_bit/harvester.yaml` declares `proposed_source_type: HTTP_API_POLLING` so the fixture path **can** generate a pack (`test_fluent_bit_and_telegraf_fixture_backed` asserts `fb.package_generated is True`). That is fixture content, not C-plugin harvest.

### 5. Is Meltano/dlt the only remaining harvest gap?

**No.**

| Gap | Status on this HEAD |
| --- | --- |
| Singer static catalog / config schema / meltano.yml | **Implemented** (`SingerHarvesterAdapter`) |
| Meltano as ecosystem key | **Alias only** — `MeltanoHarvesterAdapter(SingerHarvesterAdapter)` (`ecosystem = "meltano"`). Same static files, not Meltano REST class-attribute harvest |
| Meltano `RESTStream` / `Tap.config_jsonschema` Python AST | **Still a depth gap** (original W7 P1 reader) |
| dlt `RESTAPIConfig` / `Endpoint` | **Complete adapter gap** — no `dlt` in `build_default_harvester_registry`; no `dlt` symbol under `app/connectors_registry/` |
| Telegraf `sample.conf` / TOML | V1 skeleton only (P2 in original audit) |
| Fluent Bit `config_map[]` | V1 skeleton only (LATER in original audit) |
| Camel catalog JSON | **No adapter** (P2 in original audit) |
| Any OSS collector as StreamRunner | Still **REJECT** (canonical + `HarvesterSourceAdapter` contract) |

`dlt` is the only **missing P1 ecosystem adapter**. Meltano REST class-attr harvest is the remaining **P1 depth** item. Telegraf/Fluent Bit native parsers and Camel are remaining **P2/LATER** items, matching canonical V1 (“fixture-backed skeletons”).

Draft writer `write_source_pack` emits `manifest.yaml`, optional `auth.yaml`, `streams/*.yaml`, `README.md`, `harvester_evidence.yaml`. It does **not** fabricate `event_array_path`, pagination, or checkpoint unless evidenced (`package_builder.py`). Incremental `replication_key` maps to `checkpoint_defaults.cursor_field_path` only — not ACK-after-extract.

### W7 classification

| Item | Classification |
| --- | --- |
| **W7 — Meltano REST + dlt Harvester** | **PARTIAL** |

Not `ALREADY_IMPLEMENTED` (dlt absent; Meltano REST AST absent). Not `STILL_REQUIRED` (Singer/Meltano static + OTel + draft writer + license/secret/validator gates exist). Not `DELETE_FROM_WORKPLAN` (dlt `RESTAPIConfig` reader and Meltano REST class-attr reader remain unique remaining work). Remaining W7 slice: add a **static** dlt `RESTAPIConfig` YAML/JSON reader (no `dlt run`) and optionally a Meltano REST Python-attribute reader; keep AUTO_PORT empty.

### Stale claims in the original Agent 4 body (do not treat as current)

| Original claim | Correction |
| --- | --- |
| “There is **no Connector Harvester** today.” | False on this HEAD. `app/connectors_registry/harvester/` + `HarvesterService`. |
| “Marketplace / Stream Extension Pack **Not implemented.**” | Marketplace local lifecycle + Stream Extension `package_kind` exist (see audit 05 reconciliation). |
| Q1 “Harvester: not implemented.” | Implemented as M29.6 V1 static harvest. |
| Q7 “Code adaptation? Yes, for a **future** Harvester tool only” | Tool exists in-process under `app/connectors_registry/harvester/` (still not StreamRunner). |
| P1 “Design Harvester readers…” as unimplemented | Framework + Singer static done; Meltano REST AST + dlt still open. |
| “No Connector Harvester code exists to test.” | `tests/test_marketplace_connector_harvester.py`. |
| Builtin completeness via `app/connectors_registry/completeness.py` | **File absent** on this HEAD. Builtin load uses `validator.py` + `migration.validate_migration_completeness`. |

**Unchanged (still correct):** no OSS connector **runtime** in Data Relay; AUTO_PORT empty; Singer/dlt checkpoint-after-extract must not replace ACK; do not vendor `singer_sdk` / `dlt` / collectors into StreamRunner; OSS field maps and clone evidence below.

---

**Original audit (implementation status STALE; OSS research retained)**  
**Repo (original):** `/home/aella/gdc-platform`  
**Branch (original):** `feature/post-m29-development`  
**Date:** 2026-08-28  
**Scope:** Extract **metadata** from OSS connector ecosystems for a future **Connector Harvester** that emits Data Relay **Source Pack** / connector-module drafts.  
**Not in scope:** Implementing a harvester. Adopting Meltano, Singer, Telegraf, OpenTelemetry Collector, Fluent Bit, dlt, or Apache Camel as a Data Relay **runtime**.

## Verdict (one paragraph)

No OSS connector **runtime** belongs in Data Relay. Data Relay already has Connector / Source / Stream / Mapping / Enrichment / Checkpoint / Route entities, a filesystem connector registry (`connectors/`), Phase 1 JSON templates (`templates/`), and a specified Source Pack layout (`specs/049-template-registry/spec.md`). A Harvester should **read** OSS package metadata and **write** those artifacts only. The highest-yield harvest sources are **Meltano Singer SDK REST taps** (class attributes + `config_jsonschema` + JSON Schema files) and **dlt `rest_api` declarative configs** (`RESTAPIConfig` / `Endpoint`). Telegraf `sample.conf`, OTel `metadata.yaml` + `config.go`, Fluent Bit `flb_config_map`, and Camel catalog JSON are useful as **field catalogs and destination hints**, not as poller definitions. **AUTO_PORT is empty.** Closest grades are **REVIEW_ADAPT** (Singer REST taps, dlt REST configs) and **REFERENCE_ONLY** (Telegraf HTTP-like inputs, OTel receivers/exporters, Fluent Bit inputs, Camel components). Host-metric plugins and any “run this collector inside Data Relay” path are **REJECT**.

---

## Architecture guardrail (mandatory)

Data Relay execution model:

```text
One Stream  →  Many Routes  →  Many Destinations
```

- **Connector ≠ Stream.** Connector is identity + credentials. Stream is the poll/query execution unit.
- **Source ≠ Destination.** Destinations are reached only through **Routes**.
- **Checkpoint** advances after successful destination delivery ACK (`app/checkpoints/models.py`, `specs/049` CHK-003). Singer/dlt “state/bookmark after extract” must **not** be copied as Data Relay checkpoint commit semantics.
- **No Parallel Connector Runtime.** Do not embed Singer taps, Telegraf, OTel Collector, Fluent Bit, dlt pipelines, or Camel contexts as execution engines.
- Templates and harvested packs **materialize** normal ORM rows (`app/connector_templates/materializer.py`, `app/templates/service.py`). They are not runtime objects (`specs/013-template-connector-system/spec.md`).

**Adoption method for this audit:** `HARVESTER_SOURCE` (offline metadata → Source Pack draft) or `REFERENCE_PATTERN`. Never `DIRECT_DEPENDENCY` of an OSS collector/tap runtime.

---

## Evidence: Data Relay target models (real files)

**STALE on reconcile HEAD:** Connector Harvester **exists** (`app/connectors_registry/harvester/`). Original sentence retained for history:

There is **no Connector Harvester** today. Harvest output must land in models that already exist.

### 1. Connector module (filesystem catalog)

Loaded by `app/connectors_registry/loader.py` from `connectors/<id>/`.

| Artifact | Path example | Parsed by |
| --- | --- | --- |
| Identity | `connectors/crowdstrike/manifest.yaml` | `ConnectorManifest` in `app/connectors_registry/models.py` |
| Auth field schema | `connectors/crowdstrike/auth_schema.json` | `ConnectorAuthManifest.schema_ref` |
| Stream defs | `connectors/crowdstrike/streams/detections.yaml` | `validate_stream_template` (`STR-001..003`) |
| Mapping preset | `connectors/crowdstrike/mappings/detections.default.json` | `validate_mapping_json` (`MAP-001`) |
| Enrichment preset | `connectors/crowdstrike/enrichments/detections.default.json` | `validate_enrichment_json` (`ENR-001`) |
| API Test / pagination hints | `connectors/crowdstrike/api_test.yaml` | `validate_api_test_yaml` (`API-001`) |
| Docs | `connectors/*/docs.md` | `extract_docs_metadata` |

**Manifest identity fields** (`ConnectorManifest`): `id`, `name`, `vendor`, `version`, `source_type`, `auth.type`, `streams[]` (`id`, `name`, `template`, `default_mapping`, `default_enrichment`, `sample`), `capabilities`. Extra keys allowed (`extra="allow"`): `product`, `documentation`, `tags`.

**Current modules:** `crowdstrike`, `okta`, `microsoft_graph`, `cybereason`, `sentinelone`, `wiz`, `orca`. Completeness: `app/connectors_registry/completeness.py` (`COMPLETE` / `INCOMPLETE` / `METADATA_ONLY` / `INVALID`). Usable for materialize only when `COMPLETE` (`package_is_usable`).

**Materialization:** `app/connector_templates/materializer.py` `materialize_stream_template` creates `Stream` + `Mapping` + `Enrichment` + `Checkpoint` for an **existing** Connector/Source. Does not create Routes.

### 2. Phase 1 Source Pack (legacy flat JSON)

`app/templates/schemas.py` `TemplateDefinition` + `app/templates/registry.py` loading `templates/**/*.json`.

Fields: `template_id`, `name`, `category`, `description`, `source_type`, `auth_type`, `tags`, `included_components`, `recommended_destinations`, `connector_defaults`, `source_config_overlay`, `stream_defaults` (`config_json.endpoint/method/timeout_seconds/retry_count/retry_backoff_seconds`, `rate_limit_json`), `mapping_defaults` (`event_array_path`, `field_mappings_json`), `enrichment_defaults`, `checkpoint_defaults`, `route_suggestions`, `setup_instructions`, `preview.sample_api_structure`.

Files: `templates/generic/rest-polling.json`, `templates/crowdstrike/detections.json`, `templates/okta/system-log.json`, `templates/stellar/malop-api.json`, `templates/stellar/hunting-api.json`.

### 3. Target Source Pack (spec, not fully implemented as directory layout)

`specs/049-template-registry/spec.md` §6 preferred layout:

```text
templates/<vendor>/<product>/<use_case>/
  manifest.yaml
  connector_preset.yaml
  stream_preset.yaml
  mapping.json
  enrichment.json
  formatter_preset.yaml
  route_recommendation.yaml
  sample.raw.json
  sample.expected.json
  docs.md
```

Required metadata: `template_id`, `vendor`, `product`, `use_case`, `source_type`, `api_family`, `api_version`, `auth_type`, `source_evidence`, `confidence_level`, `deprecated`, `status`, `pack_version`. Secrets forbidden. Checkpoint still ACK-gated.

### 4. Runtime / persistence models a pack materializes into

| Concern | Data Relay file | Exact shape |
| --- | --- | --- |
| Connector identity | `app/connectors/models.py` `Connector` | `name`, `product_group`, `description`, `status` |
| Connector write fields | `app/connectors/schemas.py` `ConnectorBase` | `connector_type`, `host`/`base_url`, `verify_ssl`, `http_proxy`, `common_headers`, `source_type`, `auth_type` + secret fields |
| Auth strategies | `app/connectors/auth/registry.py` `AuthStrategyRegistry` | `NO_AUTH`, `BASIC`, `BEARER`, `API_KEY`, `OAUTH2_CLIENT_CREDENTIALS`, `SESSION_LOGIN`, `JWT_REFRESH_TOKEN`, `VENDOR_JWT_EXCHANGE` |
| Source | `app/sources/models.py` | `source_type`, `config_json`, `auth_json` |
| Source types | `app/connectors/schemas.py` `SourceType` | `HTTP_API_POLLING`, `S3_OBJECT_POLLING`, `DATABASE_QUERY`, `REMOTE_FILE_POLLING`, `WEBHOOK_RECEIVER`, … |
| HTTP adapter | `app/sources/adapters/http_api.py` → `app/pollers/http_poller.py` | GET/POST, timeout, retry, 429 Retry-After |
| Request plan | `app/http/shared_request_builder.py` `build_shared_http_request` | URL, method, params, headers, body, `{{checkpoint.*}}` |
| Pagination (query keys) | `app/pollers/http_query_params.py` | `cursor`, `limit`, `page`, `offset`, `page_size`, `per_page`, `since`, `next`, `next_token`; `pagination.type` empty/`none` disables placeholders |
| Pagination (API test overlay) | `connectors/crowdstrike/api_test.yaml` | `pagination.type: offset_limit`, `offset_param`, `limit_param` |
| Stream | `app/streams/models.py` | `stream_type`, `config_json`, `polling_interval`, `rate_limit_json` |
| Mapping / extraction | `app/mappings/models.py` | `event_array_path`, `event_root_path`, `field_mappings_json` |
| Incremental cursor | `app/runtime/incremental_fetch.py` `IncrementalFetchConfig` | strategies: `cursor`, `timestamp_watermark`, `closed_window_watermark`, `custom`; keys `incremental_fetch_watermark`, `connector_cursor` |
| Stream-template incremental | `connectors/*/streams/*.yaml` `incremental` | `mode: query_param`, `param_name`, `expression` with `${checkpoint.*}` |
| Checkpoint | `app/checkpoints/models.py` | `checkpoint_type`, `checkpoint_value_json` |
| Retry | `app/pollers/http_poller.py` | `retry_count`, `retry_backoff_seconds`, 429 Retry-After |
| Rate limit | Stream `rate_limit_json` `{max_requests, per_seconds}` | Advisory on stream; route has separate `rate_limit_json` |
| Completeness / provenance | `app/connectors_registry/completeness.py`, `validator.py` | No license field today; docs metadata only |

### 5. Marketplace / Stream Extension Pack

**STALE on reconcile HEAD:** Marketplace lifecycle, Stream Extension `package_kind`, and `app/connectors_registry/marketplace_*.py` exist. Specs 013/049 non-goals described an older charter. Original sentence retained:

**Not implemented.** `specs/013` and `specs/049` non-goals: marketplace, remote sync, package installer. No `app/marketplace/`. “Stream Extension Pack” is not a Data Relay type; do not invent one. Connector modules + Source Packs are the harvest targets.

CHANGELOG mentions “template marketplace surfaces” as UI language only; `docs/v1-readiness-checklist.md` still says no remote marketplace.

---

## Harvest field map (Data Relay ← OSS)

| # | Harvest field | Data Relay landing | Best OSS source |
| --- | --- | --- | --- |
| 1 | Connector identity | `manifest.yaml` `id/name/vendor/product/version` | Meltano `Tap.name` + pyproject; Camel `component.name`; OTel `metadata.yaml` `type`/`display_name` |
| 2 | Endpoints | stream `config_json.endpoint` | Meltano `RESTStream.path` + `url_base`; dlt `Endpoint.path`; Camel `httpUri` |
| 3 | Auth requirements | `auth.type` + `auth_schema.json` | Meltano authenticators; dlt `AuthConfig`; Telegraf TOML auth keys |
| 4 | Config fields | auth_schema + connector_defaults | Meltano `config_jsonschema`; Telegraf struct tags + `sample.conf`; Camel catalog `properties` |
| 5 | Pagination | stream `pagination` / api_test overlay | Meltano paginators; dlt `PaginatorConfig` |
| 6 | Rate limit | `rate_limit_json`; retry 429 | Meltano `RetriableAPIError` 429; dlt `DEFAULT_RETRY_STATUS`; Telegraf timeout only |
| 7 | Incremental cursor | `incremental` + `checkpoint_defaults` + `incremental_fetch` | Singer `replication_key` / state bookmarks; dlt `IncrementalConfig` |
| 8 | Request params | `config_json.query_params` / body | Meltano `get_http_request`; dlt `Endpoint.params` |
| 9 | Response extraction | Mapping `event_array_path` | Meltano `records_jsonpath`; dlt `data_selector` |
| 10 | Schema | mapping field paths; optional JSON Schema sidecar (not a runtime table) | Singer catalog schema; Meltano `schema` / `schemas/*.json` |
| 11 | Sample events | `preview.sample_api_structure` / `sample.raw.json` | Tap fixtures; Telegraf testdata; OTel `testdata/` |
| 12 | Stream defs | `manifest.streams[]` + `streams/*.yaml` | Meltano `discover_streams`; Singer catalog `streams[]`; dlt `resources[]` |
| 13 | Retry hints | `retry_count`, `retry_backoff_seconds` | Meltano `backoff_*`; dlt tenacity; HttpPoller already implements 429 |
| 14 | Tests | Harvester confidence; not executed in Data Relay | Meltano `singer_sdk.testing`; tap `tests/` |
| 15 | Fixtures | `sample.raw.json` | SDK `fixtures/`; tap test payloads |
| 16 | Documentation | `docs.md` | README, OTel `documentation.md`, Telegraf README |
| 17 | License / provenance | future pack `source_evidence` + NOTICE | Root LICENSE + per-file SPDX; Camel NOTICE required |

---

## OSS clones inspected

Cloned shallow into `/tmp/oss-audit-clones/` (2026-08-28). Conclusions are from source files, not README-only.

| Ecosystem | Clone path | HEAD | License (root) | Maintenance |
| --- | --- | --- | --- | --- |
| Meltano SDK | `sdk` (`github.com/meltano/sdk`) | `69e22f0` 2026-08-27 | Apache-2.0 (`LICENSE`, `pyproject.toml` `license = "Apache-2.0"`) | Active (commits same week) |
| Singer spec | `singer-getting-started` (`singer-io/getting-started`) | `f795829` 2025-08-08 | **No LICENSE file in clone** | Spec-only, slow |
| singer-python | `singer-python` | `e90a592` 2026-02-27 | Apache-2.0 | Qlik/Stitch maintenance |
| Telegraf | `telegraf` | `ab9b4ff` 2026-08-26 | MIT (`LICENSE`, InfluxData 2015–2025) | Active; **245** inputs |
| OTel contrib | `opentelemetry-collector-contrib` | `2ea3b3c6` 2026-08-28 | Apache-2.0 + `NOTICE` (gopsutil BSD in hostmetrics) | Active; **114** receivers, **47** exporters |
| Fluent Bit | `fluent-bit` | `37c279f` 2026-08-27 | Apache-2.0 (`LICENSE`; file headers Apache-2.0) | Active; **57** `in_*` plugins |
| dlt | `dlt` (`dlt-hub/dlt`) | `c1954f9` 2026-08-28 | Apache-2.0 (`LICENSE.txt`, `pyproject.toml` 1.30.0) | Active |
| Apache Camel | `camel` | `6085f7702` 2026-08-28 | Apache-2.0 `LICENSE.txt` + `NOTICE.txt` | Active; **403** component catalog JSON files |

Cookiecutter taps ship **dual** `LICENSE-Apache-2.0` and `LICENSE-MIT` (`sdk/cookiecutter/tap-template/...`). Harvested **tap products** have their own licenses — Harvester must read the **tap repo**, not assume Meltano SDK Apache-2.0.

---

## Per-ecosystem findings

### A. Meltano Singer SDK + Singer taps → Source Pack

**Grade: REVIEW_ADAPT** (REST taps). Singer protocol itself: **REFERENCE_ONLY**. SQL/GraphQL/custom `get_records` taps: **REFERENCE_ONLY** unless a REST surface is extracted. **Never AUTO_PORT.** **REJECT** as runtime.

**Why harvestable:** REST taps declare harvestable **class attributes** and JSON Schema, not only imperative Python.

| Metadata | SDK file / symbol | Harvester action |
| --- | --- | --- |
| Plugin identity | `singer_sdk/tap_base.py` `Tap.name`; `singer_sdk/about.py` `AboutInfo`; `pyproject.toml` | → pack `vendor`/`product`/`template_id` |
| Config fields + secrets | `Tap.config_jsonschema` (cookiecutter `non-sql-tap.py`); `Property(..., secret=True)` | → `auth_schema.json` (drop secrets, keep names/types/required) |
| Capabilities | `singer_sdk/helpers/capabilities.py` `TapCapabilities` | catalog/state/discover flags → `capabilities` |
| Stream list | `Tap.discover_streams()` return; `streams.py` classes | → `manifest.streams[]` |
| Endpoint | `RESTStream.path`, `url_base` (`streams/rest.py`) | → `config_json.endpoint` + connector `base_url` |
| HTTP method / params / body | `HTTPRequest` dataclass; `get_http_request` | → method, `query_params`, body |
| Auth | `authenticators.py`: `SimpleAuthenticator`, `APIKeyAuthenticator`, `BearerTokenAuthenticator`, `BasicAuthenticator`, `OAuthAuthenticator`, `OAuthJWTAuthenticator` | map to Data Relay `auth_type` (OAuth JWT ≈ `vendor_jwt_exchange` / `jwt_refresh_token` — **review**) |
| Pagination | `pagination.py`: `JSONPathPaginator`, `HeaderLinkPaginator`, `SimpleHeaderPaginator`, `PageNumberPaginator`, `OffsetPaginator`, `BaseHATEOASPaginator`, `SinglePagePaginator`; `RESTStream.next_page_token_jsonpath`, `get_new_paginator` | → `api_test.yaml` pagination overlay + stream `pagination` |
| Extraction | `RESTStream.records_jsonpath` (default `$[*]`); `parse_response` + `extract_jsonpath` | → Mapping `event_array_path` |
| Schema | stream `schema` / `schemas/*.json` / `StreamSchema` | → mapping field candidates; **not** Singer catalog as runtime |
| Incremental | `Stream.replication_key`, `REPLICATION_INCREMENTAL` (`streams/core.py`, `singerlib/catalog.py`) | → `incremental.mode=query_param` + checkpoint candidate; **do not** copy Singer state-commit timing |
| Retry | `validate_response` 429/5xx; `backoff_wait_generator` expo factor 2; `backoff_max_tries` 5; `DEFAULT_REQUEST_TIMEOUT` 300s | → `retry_count`/`retry_backoff_seconds` **hints only**; Data Relay already retries in `HttpPoller` |
| Tests / fixtures | `singer_sdk/testing/tap_tests.py`, cookiecutter `tests/test_core.py`, `sdk/fixtures/` | confidence + samples |
| Singer messages | `singer-getting-started/docs/SPEC.md`, `CONFIG_AND_STATE.md`, `DISCOVERY_MODE.md`; `singer-python/singer/catalog.py` `CatalogEntry` | interpret catalog JSON if tap is run **offline** in a sandbox **outside** Data Relay — optional Harvester step, not product runtime |

**Harvester must read (per tap repo):**

1. `pyproject.toml` / `setup.py` — name, version, license, deps  
2. `**/tap.py` or `non-sql-tap.py` — `name`, `config_jsonschema`, `discover_streams`  
3. `**/streams.py`, `**/client.py`, `**/rest*.py` — `path`, `url_base`, `records_jsonpath`, `next_page_token_jsonpath`, `replication_key`, `primary_keys`, `http_method`  
4. `**/auth.py` — authenticator class  
5. `**/schemas/*.json`  
6. `meltano.yml` if present (settings list)  
7. `LICENSE*` (tap-specific; cookiecutter dual MIT/Apache)  
8. `tests/` and sample responses  

**Do not execute the tap inside Data Relay.** Optional: run `--discover` in an isolated Harvester worker to obtain catalog JSON (`tap_stream_id`, `schema`, `replication_key`, `key_properties`). That catalog is **input to a draft pack**, then discarded.

**Map Singer stream → Data Relay:** one tap REST stream → one Data Relay **Stream** under one **Connector**. Fan-out remains **Routes**, not extra Streams and not a Singer target.

**Duplication:** Data Relay already has JSONPath extraction (`event_array_path`), OAuth2 client credentials, bearer/api_key/basic, retry/429, incremental watermark/cursor. Harvest **fills pack content**, not new poller classes.

**License:** SDK Apache-2.0 is fine for **reading patterns**. Redistributing tap source into the repo requires the **tap’s** license review (Agent 8). Do not vendor `singer_sdk` into `app/`.

**Priority:** P1 for a Harvester that targets Meltano REST taps → `connectors/<id>/` + Source Pack drafts. P2 for catalog-from-discover. **REJECT** Meltano/Singer as StreamRunner.

---

### B. Telegraf Input → Source Pack candidate

**Grade: REFERENCE_ONLY** for the plugin catalog as a whole. **REVIEW_ADAPT** only for HTTP/SaaS-style inputs whose `sample.conf` maps to `HTTP_API_POLLING` (e.g. `plugins/inputs/http`). Host/OS/metrics plugins: **REJECT** as Source Packs.

**Why not AUTO_PORT:** 245 inputs; most are `Gather(Accumulator)` metric scrapers (`input.go`), not JSON event pollers. Telegraf `inputs.http` consumes **Telegraf data formats** (`data_format = "influx"` default), not Data Relay mapping JSONPaths.

**Harvester must read:**

| File | Why |
| --- | --- |
| `plugins/inputs/<name>/sample.conf` | Canonical config keys (TOML). Required by `PluginDescriber.SampleConfig()` in `plugin.go`. |
| `plugins/inputs/<name>/*.go` struct + ``toml:"..."`` tags | Types, secrets (`config.Secret`) |
| `plugins/inputs/http/http.go` | `URLs`, `Method`, `Body`, `Token`/`TokenFile`, Basic, `Headers`, `SuccessStatusCodes`, embedded `HTTPClientConfig` (TLS, proxy, OAuth2, cookie auth) |
| `plugins/inputs/<name>/README.md` | Operator docs |
| Plugin `Init()` validation | Required-field constraints |
| Root `LICENSE` (MIT) | NOTICE-style attribution if snippets are copied |

**Map `inputs.http` → Data Relay (review):** `urls` → `base_url`+`endpoint` (split origin vs path); `method` → `config_json.method`; bearer/basic/oauth2/cookie → existing `auth_type` (`SESSION_LOGIN` for cookie_auth_*); `timeout`/`tls_*`/`http_proxy_url` → Source `config_json`; **do not** import Telegraf parsers (`influx`, prometheus, etc.).

**Do not harvest:** `cpu`, `mem`, `disk`, `net`, `procstat`, and similar host metrics — they are not GDC Streams.

**Architecture risk:** High if anyone proposes running the Telegraf agent. **REJECT** agent. **Priority:** P2 for HTTP-like `sample.conf` → draft connector_defaults only.

---

### C. OpenTelemetry Collector Contrib — Receivers / Exporters

**Grade:**

- OTel **Receiver** (HTTP/log/webhook/file): **REFERENCE_ONLY**, Source Pack **candidate** only when the receiver is a **push or file** analog of existing Data Relay `source_type` (`WEBHOOK_RECEIVER`, `REMOTE_FILE_POLLING`), not a new OTel pipeline.
- OTel **Receiver** (hostmetrics, traces, prometheus scrape): **REJECT** as Source Pack.
- OTel **Exporter**: **REFERENCE_ONLY** as **Destination / Route recommendation** (endpoint, token, retry_on_failure) — never as a delivery engine.

**Harvester must read:**

| File | Why |
| --- | --- |
| `receiver/<name>/metadata.yaml` | `type`, `display_name`, stability, codeowners, `tests.config` |
| `receiver/<name>/config.go` + `config.schema.yaml` | Strongly typed fields (e.g. `httpcheckreceiver/config.go` `endpoint`/`endpoints`/`method`/`body`/`validations`) |
| `receiver/<name>/README.md`, `documentation.md` | Docs |
| `receiver/<name>/testdata/` | Sample payloads / expected metrics (metrics ≠ SIEM events) |
| `exporter/<name>/metadata.yaml` | Destination identity (`splunkhecexporter`: `token`, `endpoint`, `retry_on_failure`) |
| Root `LICENSE` Apache-2.0; `NOTICE` | Third-party (e.g. gopsutil BSD in hostmetrics) — **file-level**, not root-only |

**Useful analogs (reference, not port):**

- `receiver/webhookeventreceiver` → compare to `WEBHOOK_RECEIVER` (`app/sources/adapters/webhook_receiver.py`, `ConnectorBase` webhook fields). Data Relay already has this source type.
- `receiver/filelogreceiver` → compare to `REMOTE_FILE_POLLING`, not a new tail runtime.
- `exporter/splunkhecexporter` → `recommended_destinations` / formatter hints for HTTP destinations already in templates.

**Do not harvest OTel pdata / pipelines / processors into StreamRunner.** OTel “receivers” are collector components, not Data Relay Connectors.

**Priority:** P2 destination-hint harvest from exporter metadata; LATER for webhook/file field cross-check. **REJECT** Collector as runtime.

---

### D. Fluent Bit Input → Source reference

**Grade: REFERENCE_ONLY.** `in_http` is a **listen/push** server (`FLB_INPUT_NET_SERVER | FLB_INPUT_HTTP_SERVER` in `plugins/in_http/http.c`), analogous to Data Relay **webhook receiver**, not HTTP API polling. Tail/forward/syslog inputs are log collectors, not Source Packs for vendor REST APIs.

**Harvester must read:**

| File | Why |
| --- | --- |
| `plugins/in_<name>/*.c` `config_map[]` (`FLB_CONFIG_MAP_*`) | Field names, defaults, help strings — best structured metadata |
| `struct flb_input_plugin` `.name`, `.description`, `.flags` | Identity + push vs collect |
| `plugins/in_http/http.h` | Listen port default 9880, buffer sizes, OAuth2 JWT cfg |
| Docs under `documentation/` if present in clone | Operator-facing |
| `LICENSE` Apache-2.0 | Per-file headers match |

**Map `in_http` → Data Relay:** optional cross-check of webhook `successful_response_code`, TLS, `tag_key` vs Data Relay webhook auth modes. **Do not** add Fluent Bit as an input process.

**Priority:** LATER / REFERENCE_ONLY. **REJECT** Fluent Bit binary/runtime.

---

### E. dlt Source → Source Pack / reference

**Grade: REVIEW_ADAPT** for **`dlt.sources.rest_api` declarative `RESTAPIConfig`**. Imperative `@dlt.source` Python: **REFERENCE_ONLY**. **REJECT** dlt pipeline runner / destinations (BigQuery, etc.).

**This is the closest declarative analog to a Data Relay Source Pack** among the cloned repos.

| Metadata | File / type | Data Relay landing |
| --- | --- | --- |
| Client | `ClientConfig`: `base_url`, `headers`, `auth`, `paginator` (`dlt/sources/rest_api/typing.py`) | Connector + Source |
| Auth | `AuthType` `bearer` / `api_key` / `http_basic` / `oauth2_client_credentials`; classes in `helpers/rest_client/auth.py` | Direct map to Data Relay `auth_type` (same names) |
| Resources / streams | `RESTAPIConfig.resources`, `EndpointResource.name` | `manifest.streams[]` |
| Endpoint | `Endpoint.path`, `method`, `params`, `json`, `headers` | `config_json` |
| Extraction | `Endpoint.data_selector` (JSONPath) | `event_array_path` |
| Pagination | `PaginatorType` + configs: `json_link`, `header_link`, `header_cursor`, `cursor`, `offset`, `page_number`, `single_page`, `auto` (`paginators.py`) | pagination overlay |
| Incremental | `IncrementalConfig.start_param` / `end_param` | `incremental` query params; still ACK checkpoint in Data Relay |
| Retry | `helpers/requests/retry.py` `DEFAULT_RETRY_STATUS = (429, 500-599)`, tenacity exponential | hints; HttpPoller already covers this |
| Secrets | `SENSITIVE_PARAMS` / `SENSITIVE_KEYS` in `rest_api/__init__.py` | strip from packs (`specs/049` SMP-002) |

**Harvester must read:**

1. Pipeline YAML/Python dicts using `rest_api_source({...})`  
2. `dlt/sources/rest_api/typing.py` as the schema of that dict  
3. `dlt/sources/rest_api/config_setup.py` `create_auth` / `create_paginator` (enum → class)  
4. Source `__init__.py` for non-REST sources (SQL, filesystem) — map only if Data Relay already has `DATABASE_QUERY` / `REMOTE_FILE_POLLING`  
5. `LICENSE.txt` Apache-2.0  

**Duplication:** Pagination vocabulary (offset/page/cursor/header link) is richer than Data Relay’s current `api_test.yaml` overlay. Harvest **configs**, then **improve existing** stream `pagination` JSON if the product later wants more types — that is an IMPROVE EXISTING on Data Relay poller config, not adopting dlt.

**Priority:** P1 alongside Meltano REST taps. **REJECT** `dlt run` inside the platform.

---

### F. Apache Camel Component → connector metadata / reference

**Grade: REFERENCE_ONLY.** Camel is an ESB. `http` component is **producerOnly** (`catalog/.../components/http.json` `"producerOnly": true`) — outbound HTTP, closer to **Destination/Route** than Source polling.

**Highest-value harvest file:** generated catalog JSON, not Java runtime.

Path: `catalog/camel-catalog/src/generated/resources/org/apache/camel/catalog/components/<scheme>.json` (**403** files in clone).

Example `http.json` fields: `component.name/title/description/firstVersion/supportLevel/scheme/syntax`, `componentProperties` (timeouts, proxy, SSL, `secret: true` on passwords), `properties` (`httpUri` required path, `httpMethod` enum GET/POST/…), `headers`.

**Harvester must read:**

1. `components/<scheme>.json` — identity, required vs secret properties, enums, defaults  
2. `LICENSE.txt` + `NOTICE.txt` (Apache 2.0 NOTICE obligation if redistributing catalog text)  
3. Optionally `components/camel-http` Java only to confirm producer vs consumer — catalog `consumerOnly`/`producerOnly` is enough  

**Do not** harvest Camel routes, EIPs, or JVM component JARs into Data Relay.

**Priority:** P2 for destination HTTP option catalogs / auth property names. **REJECT** Camel runtime.

---

## Grade matrix

| Ecosystem | Artifact | → Data Relay | Grade | Adoption |
| --- | --- | --- | --- | --- |
| Meltano SDK REST tap | class attrs + config_jsonschema + schemas | Source Pack + connector module | **REVIEW_ADAPT** | HARVESTER_SOURCE |
| Singer spec / singer-python | catalog, state, SCHEMA messages | interpretation only | **REFERENCE_ONLY** | REFERENCE_PATTERN |
| Singer SQL / custom Python tap | `get_records` | — | **REFERENCE_ONLY** / skip | REJECT runtime |
| Telegraf `inputs.http` + HTTP-like SaaS | `sample.conf` + Go tags | Source Pack candidate | **REVIEW_ADAPT** (narrow) | HARVESTER_SOURCE |
| Telegraf host/metric inputs | `Gather` plugins | — | **REJECT** | REJECT |
| OTel webhook/file receivers | metadata.yaml + config.go | Source reference vs existing types | **REFERENCE_ONLY** | REFERENCE_PATTERN |
| OTel metrics/trace receivers | — | — | **REJECT** | REJECT |
| OTel exporters | metadata.yaml | Destination / route hints | **REFERENCE_ONLY** | HARVESTER_SOURCE (hints only) |
| Fluent Bit `in_http` | config_map | Webhook field reference | **REFERENCE_ONLY** | REFERENCE_PATTERN |
| Fluent Bit tail/forward/syslog | — | — | **REJECT** as Source Pack | REJECT |
| dlt `rest_api` config | `RESTAPIConfig` | Source Pack | **REVIEW_ADAPT** | HARVESTER_SOURCE |
| dlt SQL/filesystem sources | — | existing source_types only | **REFERENCE_ONLY** | REFERENCE_PATTERN |
| Camel component JSON | catalog JSON | connector/destination metadata | **REFERENCE_ONLY** | HARVESTER_SOURCE |
| Any of the above as in-process runtime | agent/collector/tap | StreamRunner | **REJECT** | REJECT |

**AUTO_PORT:** none. Even declarative dlt/Meltano REST metadata needs mapping, enrichment, route recommendations, ACK checkpoint, completeness validation, and secret stripping.

---

## Answers to the 15 audit questions

### 1. Where is this implemented in Data Relay?

Connector identity and packs: `connectors/*/manifest.yaml`, `app/connectors_registry/{models,loader,validator,completeness,service}.py`, `app/connector_templates/{service,materializer}.py`. Runtime HTTP: `app/pollers/http_poller.py`, `app/http/shared_request_builder.py`, `app/sources/adapters/http_api.py`. Auth: `app/connectors/auth/registry.py`. Incremental: `app/runtime/incremental_fetch.py`. Templates: `app/templates/{schemas,registry,service}.py`, `templates/**/*.json`. Spec target: `specs/049-template-registry/spec.md`, `specs/013-template-connector-system/spec.md`, `specs/005-generic-http-connector-stream-workflow/spec.md`. **Harvester: not implemented.** **STALE** — see Correct-branch reconciliation (M29.6 V1).

### 2. Structure and limits?

Connector modules require `id`, `vendor`, ≥1 stream, `auth.type` (`MAN-001..004`). Streams need `id`/`name` and endpoint (`STR-001..003`). Completeness `COMPLETE` required to materialize. Phase 1 templates are single JSON, not directory packs. Pagination in runtime is placeholder-aware query keys, not a full paginator class library. HttpPoller is GET/POST JSON only. Marketplace and Stream Extension Pack **do not exist**. **STALE** — see audit 05 reconciliation.

### 3. Which OSS files/modules/functions?

See per-ecosystem tables. Highest-signal: Meltano `RESTStream` / `pagination.py` / `authenticators.py` / `Tap.config_jsonschema`; dlt `typing.py` `RESTAPIConfig`/`Endpoint`/`PaginatorConfig`; Telegraf `sample.conf`; OTel `metadata.yaml`+`config.go`; Fluent Bit `config_map[]`; Camel `components/*.json`.

### 4. What does OSS reduce or improve?

Reduces **manual authoring** of endpoints, auth field lists, pagination type, JSONPaths, and retry hints for **REST** vendors already expressed in Meltano/dlt. Does **not** improve StreamRunner, Routes, or checkpoint ACK. dlt/Meltano pagination enums can inform a later **improvement of existing** `stream_config.pagination` (not a new runtime).

### 5. Duplication with Data Relay?

Yes, large: HTTP poller, auth strategies (overlap with Meltano/dlt authenticators), JSONPath extraction, incremental watermark/cursor, retry/429, webhook receiver, S3/DB/remote-file sources, connector completeness validation. **Do not reimplement those as harvested runtimes.** Harvest **content** into packs.

### 6. Direct dependency?

**No.** Do not add `singer-sdk`, `dlt`, Telegraf, otelcol, fluent-bit, or `camel-http` to Data Relay `app/` or Docker runtime images for harvesting at request time.

### 7. Code adaptation?

**Yes, for a future Harvester tool only:** AST/attribute readers for Meltano REST classes; JSON/YAML loader for dlt `RESTAPIConfig`; TOML/`sample.conf` parser for Telegraf; YAML+Go-struct comment scrape for OTel; regex/C parser or docs scrape for Fluent Bit `config_map`; JSON loader for Camel catalog. Output writers already exist conceptually: connector module layout + `TemplateDefinition` / spec 049 directory.

### 8. Algorithm / pattern only?

Pagination algorithms (offset, page, header Link, JSONPath next token) and backoff-on-429 are **patterns**. Data Relay already implements a subset. Use OSS as **reference** when extending **existing** `pagination` / `HttpPoller` — classify that work as IMPROVE EXISTING in a runtime audit, not this Harvester’s job to ship paginator classes from Meltano.

### 9. Connector Harvester?

**This is the Harvester brief.** Recommended harvest order:

1. **P1:** Meltano REST taps + dlt `rest_api` configs → draft `connectors/<id>/` + Source Pack (`HARVESTER_SOURCE`).  
2. **P2:** Telegraf HTTP-like `sample.conf`; Camel HTTP-related catalog JSON for destination/auth field names.  
3. **LATER:** OTel exporter metadata → `recommended_destinations`; Fluent Bit webhook config_map vs existing webhook source.  
4. **Never:** execute OSS collectors inside Data Relay.

Harvested drafts must pass existing `validator.py` + `completeness.py` (expect `INCOMPLETE` until mapping/enrichment/samples filled — operator/API Test per spec 049).

### 10. License usable?

| Project | Usable for harvest-by-reading? | Redistribute into repo? |
| --- | --- | --- |
| Meltano SDK | Yes (Apache-2.0) | Do not vendor SDK; taps have **separate** licenses |
| singer-python | Yes (Apache-2.0) | Do not vendor |
| singer-getting-started | Spec text; **no LICENSE file in clone** — treat as documentation; do not copy large excerpts | Review |
| Telegraf | MIT — include copyright if copying `sample.conf` comments | SAFE_WITH_NOTICE if copying text |
| OTel contrib | Apache-2.0 + NOTICE / mixed (gopsutil BSD in hostmetrics) | Do not copy hostmetrics code; metadata.yaml Apache |
| Fluent Bit | Apache-2.0 | NOTICE if redistributing |
| dlt | Apache-2.0 | Do not vendor library |
| Camel | Apache-2.0 + **NOTICE.txt** required if redistributing catalog | SAFE_WITH_NOTICE |

### 11. Architecture invasion?

**High** if OSS runtimes are adopted (parallel pollers, Singer targets as destinations, OTel pipelines replacing Routes). **Low** if Harvester is an offline generator writing Source Packs that materialize through existing APIs. Checkpoint-after-extract (Singer/dlt) **must not** replace ACK-after-delivery.

### 12. Integration points (exact files)?

Harvester **write** targets (future, not this task):

- `connectors/<id>/manifest.yaml` + sidecars (loaded by `app/connectors_registry/loader.py`)  
- `templates/<vendor>/...` Phase 1 JSON (`TemplateDefinition`) or spec 049 directory  
- Completeness: `app/connectors_registry/completeness.py`  
- Materialize: `app/connector_templates/materializer.py`  
- Instantiate: `app/templates/service.py`  

Harvester **must not** write to `app/pollers/`, `app/runners/`, or StreamRunner.

### 13. What NOT to apply?

- Meltano/Singer/Telegraf/OTel/Fluent Bit/dlt/Camel as Data Relay runtime or sidecar collector.  
- Singer Targets as Destinations.  
- Telegraf host metrics as Streams.  
- OTel traces/metrics pipelines.  
- Camel route DSL.  
- Marketplace / Stream Extension Pack as new product types.  
- Secrets from tap configs into git (`specs/049` §6.4).  
- AUTO_PORT of Python `get_records` / Go `Gather` / C plugins.  
- Changing checkpoint to “after fetch.”  
- Parallel Streams per destination.

### 14. Difficulty and regression risk?

Harvester (offline): **medium** difficulty; **low** runtime regression if it only adds draft files under `connectors/` or `templates/` and does not change pollers. Parsing Python AST for Meltano: medium/false-positive risk — require REVIEW_ADAPT. Running taps for `--discover`: **high** supply-chain risk — isolate, do not do it in the API process. Shipping any OSS agent: **unacceptable** regression vs constitution.

### 15. Priority?

| Priority | Item |
| --- | --- |
| **P0** | None for implementation in this audit. Guardrail: do not adopt OSS runtimes. |
| **P1** | Design Harvester readers for Meltano REST taps + dlt `RESTAPIConfig` → existing connector module + Source Pack shapes; operator review + API Test (`specs/049`). |
| **P2** | Telegraf HTTP-like `sample.conf`; Camel catalog JSON for HTTP destination/auth metadata; OTel exporter hints. |
| **LATER** | Fluent Bit webhook config_map cross-check; Singer `--discover` in isolated worker. |
| **REJECT** | All OSS connector **runtimes**; host-metric plugins; marketplace as harvest target. |

---

## P0 / P1 / P2 / REJECT (planner columns)

| Priority | OSS | Data Relay target | Adoption | Benefit | Risk | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| P1 | Meltano REST tap metadata | `connectors/` + Source Pack | HARVESTER_SOURCE | Fast REST vendor onboarding | Wrong JSONPath / auth mapping | Spec Harvester mapping table; human review |
| P1 | dlt `RESTAPIConfig` | same | HARVESTER_SOURCE | Declarative pagination/auth | Incremental ≠ ACK checkpoint | Map incremental to fetch watermark only |
| P2 | Telegraf `inputs.http` sample.conf | connector_defaults | HARVESTER_SOURCE | Auth/TLS/proxy field lists | data_format mismatch | HTTP plugins only |
| P2 | Camel `http.json` catalog | destination/route hints | HARVESTER_SOURCE | Timeout/proxy/secret flags | ESB confusion | Read JSON only |
| P2 | OTel exporter metadata | `recommended_destinations` | REFERENCE_PATTERN | Destination option names | Collector creep | Hints only |
| LATER | Fluent Bit `in_http` config_map | webhook source docs | REFERENCE_PATTERN | Field parity check | Push vs poll confusion | Do not add listener |
| REJECT | All listed runtimes | StreamRunner | REJECT | None | Architecture break | Do not implement |

**Existing Data Relay capability that must not be “introduced” via OSS:** HTTP poller, auth registry, JSONPath mapping, incremental fetch framework, connector completeness, template instantiate/materialize, webhook/S3/DB/file sources.

---

## Never-migrate / never-adopt list

1. Singer tap/target processes in StreamRunner  
2. Meltano `singer_sdk` as a production dependency of `app/`  
3. Telegraf agent or `plugins/inputs` Go code  
4. `otelcol-contrib` receivers/exporters as pipelines  
5. Fluent Bit `in_*` / `out_*` processes  
6. dlt `pipeline.run` / warehouse destinations  
7. Apache Camel context / `camel-http` producer as delivery  
8. Host/OS/metrics plugins as GDC Streams  
9. Marketplace package format copied from Meltano Hub  
10. Singer state file as Data Relay checkpoint  

---

## Unverified / limits of this audit

- Individual **third-party tap** repositories (tap-okta, tap-github, …) were not cloned; harvest quality depends on whether those taps use Meltano REST attributes vs custom `get_records`.  
- `singer-io/getting-started` has **no LICENSE file** in the clone; spec reuse needs a separate legal pass.  
- Camel clone used generated catalog JSON; not every of 403 components was read — `http.json` was inspected in full structure.  
- Telegraf: 245 inputs; only `http` plugin source + `sample.conf` convention + `input.go` / `plugin.go` were read in depth.  
- OTel: `metadata.yaml` samples (`githubreceiver`, `webhookeventreceiver`, `filelogreceiver`, `splunkhecexporter`) + `httpcheckreceiver/config.go`; not all 114 receivers.  
- Fluent Bit: `in_http` config_map; other inputs classified by plugin naming/`flags` pattern.  
- Data Relay directory Source Packs (`templates/<vendor>/<product>/<use_case>/manifest.yaml`) are **specified** in 049, not the current on-disk Phase 1 JSON layout.  
- No Connector Harvester code exists to test. **STALE** — `tests/test_marketplace_connector_harvester.py` exists on reconcile HEAD.

---

## Document control

- **Only this markdown was added.** No Data Relay source, tests, configs, Full Matrix, or QA Lab changes.  
- Clone evidence: `/tmp/oss-audit-clones/{sdk,singer-getting-started,singer-python,telegraf,opentelemetry-collector-contrib,fluent-bit,dlt,camel}`.  
- Agent 8 should own cross-project license/maintenance scoring; this audit records root licenses and NOTICE/SPDX caveats for harvest/redistribution only.
