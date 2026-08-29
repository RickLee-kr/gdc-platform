# 09 — Correct Branch Delta / Documentation Authority Audit

> **Closure (2026-08-29):** Scheduled OSS Fit implementation is complete on a descendant of `99dd3bac886760460201f54deaaa282ec0e98bc1`. This file remains the pre-implementation authority/delta record. See [DATA-RELAY-OSS-IMPLEMENTATION-WORKPLAN.md](./DATA-RELAY-OSS-IMPLEMENTATION-WORKPLAN.md).

**Agent:** G — Branch Delta / Documentation Authority  
**Product:** Data Relay (`gdc-platform`)  
**Mode:** Read-only. No product code, tests, configs, or Full Matrix were modified. This file is the only created artifact.

Authority order used here (`docs/canonical/00-DOCUMENTATION-GOVERNANCE.md`):

```text
Product Charter
  → System Architecture + canonical domain docs
    → Detailed specs
      → Code / migrations / tests  (implementation truth)
        → Historical audits (evidence only; never override canonical)
```

Canonical documents beat old audit history. Code/migrations/tests beat canonical **status tables** when those tables lag HEAD.

---

## 1. Exact branch identity

Recorded from `/home/aella/gdc-oss-reconcile` at audit time (independent re-check 2026-08-29):

```text
$ git rev-parse --abbrev-ref HEAD
audit/code-to-oss-fit-reconcile
$ git rev-parse HEAD
99dd3bac886760460201f54deaaa282ec0e98bc1
HEAD_SHORT=99dd3ba
```

| Record | SHA | Label |
| --- | --- | --- |
| Worktree HEAD (correct) | `99dd3bac886760460201f54deaaa282ec0e98bc1` | `origin/feature/post-m29-development` tip checked out as `audit/code-to-oss-fit-reconcile` |
| Merge base | `6f280262dff393a967ebe7deca4712580d97e68b` | start of this 41-commit delta |
| Old audit workspace HEAD | `1f270e8460de73c60b761d3879f66038b6df1fe7` | `fix/route-processing-ux-p0-1-classification-policy` (Agents 1–8 residual risk #7) |

Commands:

```bash
git -C /home/aella/gdc-oss-reconcile log --oneline 6f280262dff393a967ebe7deca4712580d97e68b..HEAD
git -C /home/aella/gdc-oss-reconcile diff --stat 6f280262dff393a967ebe7deca4712580d97e68b..HEAD
```

Range size: **41 commits**, **507 files**, **+55162 / −10006**.

The old OSS-fit program (`docs/audits/oss/01`–`08` and `DATA-RELAY-CODE-TO-OSS-FIT-AUDIT.md`) requested `feature/post-m29-development` but several agents recorded workspace HEAD as `1f270e8`. That branch does **not** contain this delta. Every “current implementation” claim in those audits that depends on “what exists today” must be re-judged against `99dd3ba`.

---

## 2. Architecture verdict (canonical + code)

These statements remain **true** on `99dd3ba`. Canonical docs and StreamRunner agree.

| Statement | Canonical | Code evidence |
| --- | --- | --- |
| One Stream → Many Routes → Many Destinations | `01-PRODUCT-CHARTER.md` §3; `02-SYSTEM-ARCHITECTURE.md` §1–3 | `app/runners/stream_runner.py` `StreamRunner._fan_out` iterates `stream.routes` and sends per destination. No second Stream is created for destination-specific processing. |
| Route Processing order: Transform → Protection → Classification → Policy → Delivery | `01` §4; `02` §4; `05` §3; `06` §4 | Unchanged in this delta. No mapper / protection / classification / policy modules appear in the 41-commit `diff --stat`. |
| Stream is the execution unit; Route is the Stream-to-Destination relationship | `02` §2–3 | `StreamRunner.run` / `_send_route_events` remain the data-plane owner. |
| No parallel connector / auth / delivery / retry / checkpoint / governance **engines** | `01` §8 “No parallel engines”; `02` §9 | Marketplace, harvester, builder, durable queue, circuit breaker, AIMD, credentials, and P0 ops surfaces are control-plane or layers **inside** StreamRunner / existing adapters. No OTel Collector, Fluent Bit, Vector, Connect, Camel, Meltano, or dlt runtime is imported. |
| Marketplace is distribution/lifecycle control plane, not a connector runtime | `01` §9; `02` §6–7; `04` §1, §11 | `marketplace_router.py` module docstring: thin adapters; packages resolve through lifecycle install into existing registry roots. `HarvesterService` harvests knowledge only (`REMOTE_ACQUISITION_IMPLEMENTED = False` for V1 harvest fetch). Builder `AUTO_INSTALL = NO`. |
| Checkpoint does not advance because a package was installed or upgraded | `03` §9; `04` §11 | Lifecycle (`install_package` / `upgrade_package`) writes `marketplace_package_installs` and registry generation. It does not call `CheckpointService`. |
| Union Schema remains Stream-scoped; no new Transform DSL | `05` §4; old Agent 3 guardrail | Zero files under `app/mappers/`, `app/schema_observation/`, `unionSchema.ts`, or transform wizard in this delta. |
| AI Gateway remains out of scope | `01` §7; `05` §10; `09` §6 | No AI Gateway product work in the 41 commits. Builder is pack-authoring only. |

**What is no longer true** (old audit, not canonical):

> “Data Relay has **no marketplace**.” — Agent 5 executive summary; Conflict C9 Final; master matrix “Marketplace does not exist”.

Canonical `04-CONNECTORS-MARKETPLACE.md` already treats Marketplace as in-scope architecture. This HEAD has `marketplace_*` tables, APIs, and UI. See §5 and §7.

---

## 3. Classification legend

Each commit is tagged with one or more impact domains based on **impacting files**, not commit-message prefixes.

| Tag | Meaning |
| --- | --- |
| **Marketplace** | Package distribution, lifecycle, trust, registry, catalog, harvester, builder |
| **Connector** | Connector/source adapters, connector health, auth strategies used at fetch time |
| **Runtime Reliability** | StreamRunner, HTTP resilience, rate limit, durable queue, circuit, AIMD, checkpoint-hold tests, troubleshooter evidence |
| **Security** | Credentials, encryption, OAuth, pack signatures, secret scan, acquisition/SSRF policy, RBAC capabilities |
| **UI** | Frontend pages/panels/API clients |
| **Schema/Transform** | Union Schema, mapping, enrichment, JSONata, protection/classification/policy engines |
| **Governance** | Replay, quarantine-adjacent operator flows, safe change, environment promotion, test-before-apply (operator control of running config) |
| **Documentation/SoT** | Canonical docs, history moves, specs index, README/changelog, architecture notes |
| **No impact** | Rename/reference-only with no product behavior change |

A commit may carry multiple tags. **Schema/Transform does not appear** on any of the 41 commits.

---

## 4. The 41 commits (oldest → newest)

Chronological order. File lists are representative; full trees are in `git log --name-only`.

| # | SHA | Subject | Primary tags | Impacting files (evidence) |
| --- | --- | --- | --- | --- |
| 1 | `1752844` | feat: unify Source/Destination HTTP retry via shared resilience layer | Runtime Reliability | `app/http/resilience/retry_policy.py` `RetryPolicy`; `classifier.py`; `app/pollers/http_poller.py`; `app/delivery/webhook_sender.py`; `tests/test_http_resilience.py` |
| 2 | `a233da1` | test: automate HTTP 403/timeout/malformed source fault checkpoint hold | Runtime Reliability | `tests/test_wiremock_http_source_fault_gaps_e2e.py`; WireMock mappings `template-api-v1-events-{403,timeout,malformed}.json` |
| 3 | `13a65bf` | test: automate S3/DB/SFTP source fault checkpoint hold | Runtime Reliability, Connector | `app/runners/stream_runner.py`; `app/sources/adapters/s3_object_polling.py`; `remote_file_polling.py`; `tests/test_non_http_source_fault_gaps_e2e.py` |
| 4 | `bbb4bd4` | fix: make OpenAPI export deterministic and Schemathesis-ready | Documentation/SoT, Security (minor) | `scripts/openapi/export_openapi.py`; `app/main.py`; `app/auth/router.py`; `docs/testing/openapi-contract-schemathesis.md` |
| 5 | `d1d1b12` | feat: implement SourceRateLimiter token bucket for stream polling | Runtime Reliability | `app/rate_limit/source_limiter.py` `SourceRateLimiter.allow`; wired from `stream_loader.py` / `stream_runner.py` |
| 6 | `c2dafc9` | feat: strengthen runtime failure evidence on DeliveryLog correlation path | Runtime Reliability, UI | `app/observability/runtime_evidence.py`; `app/runners/stream_runner.py`; `frontend/src/components/logs/delivery-log-stages.ts` |
| 7 | `6038d35` | feat: add Connected Credential foundation with legacy auth_json fallback | Security, Connector | `app/credentials/{models,service,router,resolution}.py`; `alembic/versions/20260823_0064_credentials_foundation.py`; `app/runners/stream_loader.py`; `app/sources/models.py` |
| 8 | `ed77bb9` | docs: audit Durable Delivery Queue architecture and minimal design | Documentation/SoT | `docs/architecture/durable-delivery-queue-audit-design.md` (later moved under `docs/history/architecture/`) |
| 9 | `8d8791a` | feat: add Durable Delivery Queue Phase 1 DB foundation | Runtime Reliability | `app/delivery_queue/models.py` `StreamDeliveryQueueItem`; `alembic/versions/20260823_0065_stream_delivery_queue_items.py` |
| 10 | `c95e976` | feat: wire Webhook Destination to Durable Delivery Queue (Phase 2) | Runtime Reliability | `app/delivery/webhook_sender.py`; `app/delivery_queue/{outcome,reliability,repository}.py`; `stream_runner.py` `_send_route_events_durable_webhook` |
| 11 | `ce2dd7e` | feat: recover durable webhook queue after runtime restart (Phase 3) | Runtime Reliability | `app/delivery_queue/recovery.py`; `app/scheduler/scheduler.py`; `stream_runner.py` |
| 12 | `ea90b3f` | feat: extend Durable Delivery Queue to SYSLOG_TCP (Phase 4) | Runtime Reliability | `app/delivery_queue/reliability.py`; `stream_runner.py`; `tests/test_delivery_queue_syslog_tcp_phase4.py` |
| 13 | `a870c1b` | feat: add Durable Delivery Queue backpressure protection (Phase 5) | Runtime Reliability | `app/delivery_queue/backpressure.py`; `stream_runner.py`; `tests/test_delivery_queue_backpressure_phase5.py` |
| 14 | `d0f6918` | feat: add Destination Circuit Breaker for prolonged outage suppression | Runtime Reliability | `app/delivery/circuit_breaker.py` `DestinationCircuitBreaker`; `process_circuit_breaker.py`; `stream_runner.py` |
| 15 | `a13c14d` | feat: add Adaptive Destination Concurrency (AIMD) per destination | Runtime Reliability | `app/delivery/adaptive_concurrency.py` `DestinationAdaptiveConcurrency`; `stream_runner.py` |
| 16 | `dcabfe3` | feat: add OAuth2 Authorization Code and refresh token lifecycle | Security, Connector | `app/credentials/oauth2_auth_code.py`; `oauth2_token_http.py`; `alembic/versions/20260824_0066_credential_oauth_states.py`; `app/connectors/auth/runtime_extra_strategies.py` |
| 17 | `f6ad76a` | feat: encrypt credential auth secrets at rest with AES-GCM | Security | `app/security/encryption.py`; `app/security/auth_json_crypto.py`; credential resolution path |
| 18 | `3e95cb1` | fix: close wave2 integration regressions | Connector, Security, Runtime Reliability | `app/connectors/auth/{api_key,basic,bearer}.py`; `stream_loader.py`; `app/runtime/preview_service.py` |
| 19 | `362a57d` | fix: decrypt webhook credentials at runtime | Security, Runtime Reliability | `app/runners/webhook_receiver.py`; `tests/test_webhook_receiver_ingest.py` |
| 20 | `84e0614` | docs: define connector marketplace architecture | Documentation/SoT, Marketplace | `.specify/memory/constitution.md`; specs 001–004, 013, 049, 091–097; marketplace charter draft |
| 21 | `7eef1f3` | feat: add connector manifest v2 compatibility | Marketplace, Connector | `app/connectors_registry/{models,normalize,schemas,service,validator}.py`; `tests/test_marketplace_manifest_v2.py` |
| 22 | `89d057e` | feat: add unified connector registry roots | Marketplace, Connector | `app/connectors_registry/roots.py` `default_registry_roots`; `loader.py`; `app/config.py` `GDC_PLUGINS_DIR` |
| 23 | `1231a58` | feat: add marketplace package lifecycle | Marketplace | `app/connectors_registry/lifecycle_service.py` `install_package` / `upgrade_package` / `rollback_package` / `uninstall_package`; `lifecycle_models.py`; alembic `20260825_0067_marketplace_package_installs.py` |
| 24 | `922ea92` | feat: add marketplace registry invalidation | Marketplace | `app/connectors_registry/registry_generation.py`; `registry_version_models.py`; alembic `20260825_0068_connector_registry_version.py` |
| 25 | `1aa1e12` | feat: secure marketplace package trust | Marketplace, Security | `package_digest.py`; `package_secret_scan.py` `scan_package_secrets`; `package_signature.py` Ed25519; `trusted_signing_keys_*`; alembic `20260825_0069_marketplace_package_trust.py`; `route_access.py` marketplace capabilities |
| 26 | `e48a91e` | docs: establish canonical documentation v2 | Documentation/SoT | `docs/canonical/00`–`09` created |
| 27 | `8bbb0a1` | docs: classify legacy documentation authority | Documentation/SoT | inventory + migration map; source-of-truth files marked historical |
| 28 | `63095ed` | docs: reorganize canonical and historical documentation | Documentation/SoT | large `docs/` move into `docs/history/`, `docs/operations/`, `docs/reference/` |
| 29 | `a6a3a4b` | docs: reduce current reference surface | Documentation/SoT | further history/reference thinning; `docs/source-of-truth/README.md` |
| 30 | `67604f1` | feat: add marketplace acquisition security policy | Marketplace, Security, Documentation/SoT | `acquisition_url_policy.py`; `license_policy.py` `evaluate_license_policy`; canonical 02/04/05/09 updates |
| 31 | `69edd24` | feat: add connector harvester pipeline | Marketplace, Connector, Documentation/SoT | `app/connectors_registry/harvester/service.py` `HarvesterService.harvest_and_import`; sources `singer.py` / `otel.py` / `fluent_bit.py` / `telegraf.py`; canonical 04/09 |
| 32 | `e3939f5` | feat: add ai connector builder foundation | Marketplace, Connector, Documentation/SoT | `app/connectors_registry/builder/service.py` `BuilderService` / `build_connector_draft`; `providers/fixture.py`; canonical 04/06/09 |
| 33 | `2daf63f` | feat(marketplace): implement M29.8 marketplace UI | Marketplace, UI | `marketplace_router.py` `get_marketplace_catalog`; `marketplace_catalog.py` `build_catalog`; `frontend/.../marketplace-panel.tsx` `MarketplacePanel`; `connectors-overview-page.tsx` view `installed` \| `marketplace` |
| 34 | `743ba0b` | feat(marketplace): implement M29.9 remote and private registry | Marketplace, UI, Security | `registry_models.py` `MarketplaceRegistry` `__tablename__ = "marketplace_registries"`; `registry_service.py` `acquire_and_install_from_registry`; `git_acquisition.py` `install_package_from_git_url`; `offline_bundle.py`; `marketplace-registries-page.tsx`; alembic `20260826_0070_marketplace_registries.py` |
| 35 | `97b2d77` | feat(runtime): add Data Flow Troubleshooter from structured evidence | Runtime Reliability, UI | `app/runtime/troubleshoot_service.py` `build_stream_data_flow_troubleshoot`; `data-flow-troubleshooter-panel.tsx`; `stream-runtime-detail-page.tsx` |
| 36 | `d928342` | feat(operations): implement P0 safe change management | Governance, UI | `app/safe_change/service.py` `preview_safe_change` / `apply_safe_change`; `safe-change-impact-panel.tsx`; stream/route/destination routers |
| 37 | `feb656f` | feat(operations): implement P0 connector API health | Connector, UI | `app/connectors/api_health_service.py`; `connector-api-health-panel.tsx`; `connector-detail-page.tsx` |
| 38 | `d515db9` | feat(operations): expand P0 replay center | Governance, UI | `app/governance_replay/{router,service,schemas}.py`; `replay-center-page.tsx` |
| 39 | `963a990` | chore: update repository references to datarelay-labs | Documentation/SoT, No impact | `README.md`; `CHANGELOG.md`; install-guide / installation-validation (org rename only) |
| 40 | `f3078d9` | feat(operations): implement P0 environment promotion | Governance, UI | `app/environment_promotion/{router,service,schemas}.py`; `environment-promotion-panel.tsx`; `operations-backup-page.tsx` |
| 41 | `99dd3ba` | feat(operations): implement P0 test before apply impact preview | Marketplace, Governance, UI | `app/test_before_apply/service.py` `preview_test_before_apply` / `apply_test_before_apply`; `upgrade_impact_service.py`; `marketplace-upgrade-impact-panel.tsx`; `step-deploy.tsx` |

### 4.1 Domain rollup

| Domain | Commits (count) | Notes |
| --- | --- | --- |
| Marketplace | 21–25, 30–34, 41 (11+) | Entire M29.1–M29.9 stack plus Test Before Apply / upgrade impact |
| Connector | 3, 7, 16, 18, 21–22, 31–32, 37 | Adapters, auth, registry roots, harvester/builder, API health |
| Runtime Reliability | 1–3, 5–6, 9–15, 19, 35 | Resilience layers + durable queue + troubleshooter |
| Security | 4, 7, 16–19, 25, 30, 34 | Credentials, crypto, pack trust, acquisition policy, registries |
| UI | 6, 33–38, 40–41 | Marketplace, ops, replay, troubleshooter |
| Schema/Transform | **0** | No impacting files |
| Governance | 36, 38, 40–41 | Safe change, replay, promotion, test-before-apply |
| Documentation/SoT | 4, 8, 20, 26–32, 39 | Canonical v2 + marketplace charter + history move |
| No impact | 39 (primary) | `datarelay-labs` string updates |

---

## 5. `marketplace_*` exists on this branch

Old C9 (“no marketplace”) is **false** at `99dd3ba`.

### 5.1 Tables (migrations)

| Table | Model | Migration |
| --- | --- | --- |
| `marketplace_package_installs` | `MarketplacePackageInstall` in `app/connectors_registry/lifecycle_models.py` | `alembic/versions/20260825_0067_marketplace_package_installs.py` |
| `marketplace_trusted_signing_keys` | `MarketplaceTrustedSigningKey` in `trusted_signing_keys_models.py` | `20260825_0069_marketplace_package_trust.py` |
| `marketplace_registries` | `MarketplaceRegistry` in `registry_models.py` | `20260826_0070_marketplace_registries.py` |

Origins on install rows (`lifecycle_models.py`): `upload`, `offline_bundle`, `private_registry`, `remote_registry`, `git`.

### 5.2 Control-plane functions (not a second runtime)

| Capability | File | Function |
| --- | --- | --- |
| Multi-root scan | `app/connectors_registry/roots.py` | `builtin_connectors_root`, `installed_plugins_root`, `default_registry_roots` |
| Manifest v2 | `app/connectors_registry/normalize.py` + `validator.py` | consumed by `service.py` |
| Install/upgrade/rollback/uninstall | `lifecycle_service.py` | `install_package`, `upgrade_package`, `rollback_package`, `uninstall_package`, `validate_package_upload` |
| Secret scan | `package_secret_scan.py` | `scan_package_secrets`, `assert_package_secrets_clean` |
| Digest | `package_digest.py` | canonical SHA-256 excluding signature metadata |
| Signatures | `package_signature.py` | Ed25519 verify against `marketplace_trusted_signing_keys` |
| License gate | `license_policy.py` | `evaluate_license_policy` → `ALLOW` / `REVIEW` / `REFERENCE_ONLY` / `DENY` |
| Acquisition SSRF policy | `acquisition_url_policy.py` | URL/DNS/private-range policy used by fetchers |
| Catalog UI API | `marketplace_router.py` | `get_marketplace_catalog`, `get_marketplace_package_detail`; prefix `/marketplace` |
| Catalog projection | `marketplace_catalog.py` | `build_catalog`, `filter_catalog`, `get_package_card`, `derive_trust_tier` |
| Remote/private registry | `registry_service.py` | `create_registry`, `browse_registry_packages`, `acquire_and_install_from_registry` |
| Git HTTPS archive | `git_acquisition.py` | `install_package_from_git_url` (HTTPS `.tar.gz` only; not arbitrary git clone) |
| Harvester | `harvester/service.py` | `HarvesterService.harvest_and_import` |
| AI Builder | `builder/service.py` | `BuilderService`, `build_connector_draft` |
| RBAC | `app/auth/route_access.py` | capabilities `marketplace_package_lifecycle`, `marketplace_trusted_key_manage`, `marketplace_unsigned_install` |
| Router mount | `app/connectors_registry/router.py` | `include_router` for lifecycle, trusted keys, marketplace UI, registries **before** `/{connector_id}` |

### 5.3 UI evidence

- `frontend/src/components/connectors/connectors-overview-page.tsx` — `ConnectorsView = 'installed' | 'marketplace'`; renders `MarketplacePanel`.
- `frontend/src/components/connectors/marketplace/marketplace-panel.tsx` — catalog, upload, git install, offline bundle, AI builder, registry browse.
- `frontend/src/config/nav-paths.ts` — `marketplaceRegistries: '/admin/marketplace-registries'`.
- `frontend/src/components/administration/marketplace-registries-page.tsx` — M29.9 admin surface.

This matches canonical `06-USER-EXPERIENCE.md` §2: Marketplace under **Data Sources → Connectors**, not a new engine nav item.

---

## 6. Runtime reliability: IMPROVE EXISTING, not a parallel engine

Canonical `03-RUNTIME-RELIABILITY.md` §7 lists separate layers. This delta **implements** them inside Data Relay; it does **not** vendor collector queues.

| Layer (canonical §7) | Status on `99dd3ba` | Evidence |
| --- | --- | --- |
| Source Rate Limiter | `IMPLEMENTED` | `SourceRateLimiter.allow` — **not** a stub |
| HTTP Resilience | `IMPLEMENTED` | `app/http/resilience/retry_policy.py` `RetryPolicy` (Retry-After, exponential backoff, optional jitter) |
| Destination Circuit Breaker | `IMPLEMENTED` (process-local) | `DestinationCircuitBreaker` |
| Adaptive Concurrency | `IMPLEMENTED` (opt-in) | `DestinationAdaptiveConcurrency` |
| Backpressure | `IMPLEMENTED` for durable-queue paths | `app/delivery_queue/backpressure.py` |
| Durable Queue | `IMPLEMENTED` for `WEBHOOK_POST` and `SYSLOG_TCP` when enabled | `StreamDeliveryQueueItem`; `StreamRunner._send_route_events_durable_webhook` |
| Checkpoint | `IMPLEMENTED` (unchanged invariant) | source-fault tests hold checkpoint; package install does not advance it |

Owner remains `StreamRunner` (`class StreamRunner` at `stream_runner.py:125`; `run`, `_fan_out`, `_send_route_events`). Durable queue is a **delivery mode** (`PERSISTENT_QUEUE` in canonical §6), not a second pipeline framework.

Old Agent 7 matrix row “Exporter queues / disk WAL / e2e acks / Camel CB → **REJECT** / parallel delivery engine” is **stale as a gap description**. The **architecture** hold is still correct: do not adopt OTel/Fluent/Vector/Connect/Camel as the runtime. Implementing a platform-managed PostgreSQL delivery queue **inside** StreamRunner is the approved canonical path (`03` §6: older “PERSISTENT_QUEUE is future-only” wording is itself marked stale).

---

## 7. Old audit conclusions — still true vs stale

### 7.1 Still true (keep)

These survive both canonical v2 and `99dd3ba` code:

1. **One Stream → Many Routes → Many Destinations.** Do not duplicate Streams for destination-specific processing.
2. **Route Processing order** Transform → Protection → Classification → Policy → Delivery.
3. **Do not adopt** OTel Collector, Fluent Bit, Vector, Redpanda Connect, Camel, Telegraf, Meltano, or dlt **as execution engines**.
4. **Do not add** jq / JMESPath / VRL / Bloblang / Camel DSL as Transform languages.
5. **REJECT** Presidio `AnalyzerEngine` / spaCy on the hot path (Agent 6). No governance-engine files in this delta.
6. **REJECT** Kumo / Tailwind 4 / Radix as the product UI stack (C4). This delta does not add those packages.
7. **REJECT** GenSON-as-Union-Schema, Monaco-as-default-editor, rc-tree widget (C8). Schema/Transform files untouched.
8. **License exclusions:** Airbyte ELv2 `DO_NOT_USE`; official `singer-io/tap-*` AGPL `DO_NOT_USE`; Redpanda Connect mixed license `DO_NOT_USE`. Harvester license policy (`evaluate_license_policy`) encodes ELv2 → `REFERENCE_ONLY` and explicit `DENY` only via admin config — consistent with C5/C6 intent.
9. **AI Gateway** remains a non-goal.
10. **Operational Snapshot** remains metrics SoT; topology canvas (P2) was not in this delta.
11. **Checkpoint after required delivery success** remains the durability model. Durable queue does not replace checkpoint.
12. **Marketplace must not** store live credentials in packs, auto-enable streams, or silently mutate running Stream config on upgrade (`04` §11). Builder flags `AUTO_INSTALL` / `AUTO_STREAM_ENABLE` / `AUTO_CREDENTIAL_CREATE` remain off.

### 7.2 Stale (discard or rewrite)

These old-audit claims are **false** on the correct HEAD. Canonical docs already contradicted several of them before code caught up; code now contradicts the rest.

| Old claim | Where | Why stale | Correct reading |
| --- | --- | --- | --- |
| Data Relay **has no marketplace** | Agent 5 exec summary; C9 Final; master matrix “Marketplace does not exist” | `marketplace_*` tables + `/marketplace` API + Connectors Marketplace UI | Marketplace is a **shipped control plane**. Completeness-only filesystem catalog is not the whole install story. |
| Harvester **does not exist today** | Agent 4 § “Evidence: Data Relay target models”; “no Harvester today” | `HarvesterService.harvest_and_import` + Singer/OTel/Fluent Bit/Telegraf adapters | Harvester V1 is **IMPLEMENTED** (local/snapshot/fixture). Still not a collector runtime. |
| Zip / Git marketplace **REJECT now** (spec non-goal) | Agent 5 Stage 1; master matrix “Archive/Git marketplace”; implementation order item 1 | `install_package` from `.tar.gz`; `install_package_from_git_url`; offline bundle; `LIFECYCLE_ORIGIN_GIT` | Upload/Git-archive/offline bundle are **in product**. Arbitrary git clone of a repo is still not the V1 contract (`git_acquisition.py` docstring: HTTPS `.tar.gz` only). |
| Pack signing **REJECT until product yes** / **LATER** | Agent 5; master matrix; implementation order item 12 | `package_signature.py` Ed25519 + trusted keys + unsigned install admin-only | Pack signing is **IMPLEMENTED** (M29.5A). `cryptography` is used for pack verify, not only JWT/TLS. |
| SMP-002 / secret scan = improve `validator.py` + existing `secrets.py` only | C7 Final | `package_secret_scan.py` `scan_package_secrets` on install path | Dedicated pack scanner exists; still not `detect-secrets` as a P0 dependency (C7 “do not add detect-secrets” remains reasonable). |
| `SourceRateLimiter` **is a stub** despite saved config | Agent 7 verdict; residual risk #5 as unimplemented | `SourceRateLimiter` token bucket + stream_runner/loader wiring | **IMPLEMENTED**. EPS 5–20 guardrail remains a **test/ops** constraint, not a “missing code” claim. |
| Webhook retry unclassified; jitter / dest Retry-After **missing** | Agent 7 P0/P1 | Shared `RetryPolicy` with Retry-After and optional `jitter_ratio` | Gap is **narrower**. Confirm live 4xx behavior before further classification changes (residual risk #1 can remain as a **behavior** question, not “layer missing”). |
| Route retry persist not on `routes` table | Agent 7 P1 | Not delivered in these 41 commits | **Still a gap** (not stale). Do not confuse with durable queue retry state. |
| “Do not start: marketplace zip/git” | Integration planner implementation order §1 | M29.3–M29.9 shipped | Do not start **parallel runtimes**. Marketplace ingest **has started**. |
| P1 Harvester is a future **offline design** only | Planner item 9 | M29.6 code + tests `test_marketplace_connector_harvester.py` | Design-only recommendation is stale; **implementation exists**. AUTO_PORT empty / REVIEW_ADAPT / no collector embed remain valid. |
| Filesystem Connector Registry is the **only** package authority | Agent 5 existing map; planner “Keep using filesystem Connector Registry” | Multi-root `connectors/` + `data/plugins` + DB lifecycle + `marketplace_registries` | Filesystem roots remain **content** storage. Platform-derived install/trust/registry state lives in PostgreSQL. Canonical `02` §7 ownership model. |
| `completeness.py` `classify_package_completeness` is the install gate | Agent 5; master matrix | **File absent** on `99dd3ba` (0 hits). Completeness language in this HEAD is MIG-* in `migration.py` and Builder `INCOMPLETE`, not a standalone completeness module. | Old audit likely mixed a **dirty workspace** (untracked `completeness.py` exists on some local trees) with `feature/post-m29-development`. Do not treat `completeness.py` as HEAD evidence. |
| Workspace HEAD may be `1f270e8` | Planner residual risk #7 | This worktree is `99dd3ba` | Treat Agents 1–8 “current implementation” tables as **wrong-branch** unless re-verified. |
| `cryptography` is JWT/TLS only — **not pack Ed25519** | Planner “What Data Relay already has” | `package_signature.py` uses `Ed25519PublicKey` | Transitive dep is now a pack-trust verifier. |
| Specs 013/049 **forbid** remote catalog / upload / Git | Agent 5 Stage 1 | Canonical `04` in-scope: Connector Marketplace, remote/private registries, offline install. Specs were amended in `84e0614` / later doc commits. | Historical spec non-goals do not override canonical v2. |
| AI pack generation is **not a product surface** | Agent 5 Stage 1 | `build_connector_draft` + `MarketplaceAiBuilder` UI | Builder **is** a product surface. Auto-publish / auto-install / Verified promotion remain **forbidden** (still true). |
| M29.8 Marketplace UI / M29.9 remote registry / P0 Troubleshooter / Safe Change / API Health / Replay / Promotion / Test Before Apply are only `TARGET` | Canonical `02` §8 last row; `04` §5 “TARGET — M29.8+”; `06` §7–14; `09` §3–4 | Commits `2daf63f`, `743ba0b`, `97b2d77`, `d928342`, `feb656f`, `d515db9`, `f3078d9`, `99dd3ba` | Canonical **architecture** still wins over old audits. Canonical **status tags** lag HEAD. Per `00` §1, code is implementation truth: treat those rows as **stale status**, not as a prohibition. Production AI network provider remains `TARGET` (`PRODUCTION_AI_PROVIDER_IMPLEMENTED` in builder). `REMOTE_PUBLIC_DEFAULT_ENABLED = False`. |

### 7.3 Canonical vs HEAD status lag (not old-audit, but authority-relevant)

`docs/canonical/` last-updated **2026-08-25** with implementation baseline around M29.5–M29.7 (`1aa1e12` / M29.7). Commits **after** that baseline on this branch:

- M29.6 harvester and M29.7 builder **are** reflected in `04` / `09` as `IMPLEMENTED`.
- M29.8 UI, M29.9 registries, and the P0 operator surfaces are still labeled `TARGET` in `02` §8, `04` §5 / §8–11, `06` §7–14, `07` §6–8, `09` §3–4.

That is a **documentation defect** (status lag), not an architecture change. Do not revive C9 from those `TARGET` labels.

`02` §8 also still groups “Marketplace UI / remote registry / **harvester / AI builder**” as a single `TARGET` row, which contradicts `04`/`09` (harvester + builder IMPLEMENTED). Prefer `04` + `09` + code over that collapsed row.

---

## 8. What this delta did **not** change

Use this to avoid false “the whole product moved” conclusions:

- **No Schema/Transform engine changes** (Union Schema, JSONata, five transform modes).
- **No** new Stream type, parallel StreamRunner, or destination-specific Stream duplication.
- **No** Presidio / new governance engine.
- **No** Kumo / Base UI / TanStack Virtual adoption (those P0/P1 UI-foundation items from Agents 1–3 are **still open recommendations**, not shipped in this delta).
- **No** AI Gateway product.
- Route-processing UX/classification work on `1f270e8` is **not** this branch’s distinguishing delta; do not merge those conclusions into post-m29 Marketplace/reliability status.

---

## 9. Downstream implication for OSS-fit planning

When reconciling Agents 1–8 + the Integration Planner against **this** HEAD:

1. Drop C9 and every “no marketplace / don’t build zip-git / signing is LATER” work item.
2. Keep C4, C5, C6, C8, and the parallel-runtime **REJECT** list.
3. Reclassify Agent 7 queue/WAL **REJECT** as “do not vendor collector engines”; Data Relay already has `PERSISTENT_QUEUE` for selected paths.
4. Treat Harvester as **existing code to constrain** (license gate, no AUTO_PORT, no collector embed), not a greenfield design.
5. Treat Marketplace UI/registry/P0 ops as **implemented-enough to audit for fit**, not as forbidden future work.
6. Re-run any “current file/function map” that was taken at `1f270e8`.
7. Refresh canonical status tables (separate docs task) so `02`/`04`/`06`/`09` stop advertising M29.8+/P0 as `TARGET`.

---

## 10. Evidence index (quick)

```text
BRANCH=audit/code-to-oss-fit-reconcile
HEAD=99dd3bac886760460201f54deaaa282ec0e98bc1
MERGE_BASE=6f280262dff393a967ebe7deca4712580d97e68b
OLD_AUDIT_HEAD=1f270e8460de73c60b761d3879f66038b6df1fe7
COMMITS=41
DIFFSTAT=507 files, +55162 −10006
```

Canonical files read: `00-DOCUMENTATION-GOVERNANCE.md`, `01-PRODUCT-CHARTER.md` … `07-OPERATIONS-OBSERVABILITY.md`, `04-CONNECTORS-MARKETPLACE.md`, `09-ROADMAP-CURRENT-STATE.md`.

Old audits compared: `01`–`08`, `DATA-RELAY-CODE-TO-OSS-FIT-AUDIT.md` (especially Guardrails, C9, master matrix, implementation order, residual risk #7).
