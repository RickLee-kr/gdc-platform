# Agent 5 — Marketplace Validation / Security Audit

> **Closure (2026-08-29):** Scheduled OSS Fit implementation is complete. W6 is COMPLETE (`scan_package_secrets` → builtin `SMP-002`). `detect-secrets` was not added. This file remains the pre-implementation audit record. See [DATA-RELAY-OSS-IMPLEMENTATION-WORKPLAN.md](./DATA-RELAY-OSS-IMPLEMENTATION-WORKPLAN.md).

## Correct-branch reconciliation

**Reconcile date:** 2026-08-29  
**Independent re-verification:** 2026-08-29 — `package_signature.py` uses `Ed25519PublicKey.verify`; `git_acquisition.install_package_from_git_url` HTTPS `.tar.gz` only; `validator.py` has no SMP-002 / `scan_package_secrets`; `detect-secrets` not in `requirements.txt`.  
**Codebase:** `/home/aella/gdc-oss-reconcile`  
**Branch:** `audit/code-to-oss-fit-reconcile` (tracks `origin/feature/post-m29-development`)  
**HEAD:** `99dd3bac886760460201f54deaaa282ec0e98bc1`  
**Architecture authority:** `docs/canonical/04-CONNECTORS-MARKETPLACE.md`  
**Old audit workspace (STALE for code):** `fix/route-processing-ux-p0-1-classification-policy` @ `1f270e8` — no harvester/marketplace modules. This branch has M29.1–M29.7 (+ UI/acquisition APIs under `marketplace_*`, `git_acquisition`, `secure_fetch`).

OSS clone research below (`openapi-spec-validator`, `jsonschema`, `detect-secrets`, `cryptography` Ed25519 APIs) remains valid. Implementation-status claims that Data Relay “does not have a marketplace,” “no pack signatures,” “no Git install,” and “SMP-002 is not coded” are **stale**.

### Existing vs this HEAD (do not duplicate)

Filesystem connector registry + Phase 1 templates **still exist** and must not be replaced. On this HEAD they sit **under** marketplace lifecycle:

```text
.tar.gz upload / git HTTPS archive / offline bundle
  → lifecycle_archive.extract_tar_gz_to_staging
  → package_validator.validate_extracted_marketplace_package
  → package_secret_scan.assert_package_secrets_clean
  → package_digest.compute_canonical_package_digest
  → package_signature.verify_package_signature  (Ed25519)
  → license_policy.evaluate_manifest_license_policy
  → atomic install (lifecycle_service.install_package)
```

Built-in `connectors/` load path uses `validator.py` (`validate_manifest_dict`, stream/mapping/enrichment/api-test/docs) plus `migration.validate_migration_completeness` (MIG-001..004 in `service.py`). **`completeness.py` / `classify_package_completeness` is absent on this HEAD** (`git ls-files app/connectors_registry/completeness.py` is empty). That module existed only as dirty-workspace untracked files on the wrong-audit tree. No `package_secret_scan` on builtin startup load.

### 6. Does `package_secret_scan` fulfill SMP-002? Is detect-secrets still needed?

**Spec 049 SMP-002** (`specs/049-template-registry/spec.md` §5.4): blocking if sample payload has secret-like **keys** (`password`, `token`, `api_key`, `secret`, …).

**Implemented (marketplace packages, not `validator.py`):**

- `scan_package_secrets` / `assert_package_secrets_clean` (`app/connectors_registry/package_secret_scan.py`)
- `_SECRET_KEY_PATTERN` matches `password|secret|api[_-]?key|access[_-]?token|…` (own regex; **does not** call `app/security/secrets.py` `is_sensitive_field_name`)
- Literal values blocked (`_looks_like_literal_secret`, `_PEM_PRIVATE_KEY`, `_LITERAL_TOKENISH`, bearer); **placeholders allowed** (`${ENV}`, `<required>`, `credential_ref`)
- Findings redacted (file + rule only) — `test_literal_api_key_reject`
- Wired: `lifecycle_archive.resolve_and_validate_staged_package` (line ~179); `HarvesterService._validate_package`; `builder/service.py` draft validation

**Does not strictly equal SMP-002:**

| SMP-002 (spec) | `package_secret_scan` |
| --- | --- |
| Secret-like **key names** in `sample.raw.json` are blocking | Secret-named keys with **placeholder values pass** |
| Registry `validator.py` during module load | **Not present** — `validator.py` has MAN/STR/MAP/ENR/API/docs only; no `SMP-002` rule_id |
| Built-in `connectors/` samples | Not scanned at `load_connector_modules` |

**detect-secrets:** still **not** a product dependency (`requirements.txt` has no `detect-secrets`; no import). Marketplace keyword + PEM coverage is in-process. Optional CI `scan_file` remains LATER with an allowlist (high-entropy FPs on samples). **Do not add detect-secrets as a runtime scanner.**

### 7. Does `package_signature` actually use Ed25519 (`cryptography`) for sign/verify?

**Verify: yes. Sign (platform): no.**

- Import: `from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey` (`package_signature.py`)
- `verify_package_signature`: loads trusted key from `marketplace_trusted_signing_keys`, `Ed25519PublicKey.from_public_bytes(pub_raw).verify(sig_raw, digest.encode("ascii"))` — signs the **canonical SHA-256 digest bytes as ASCII hex**, not the archive blob
- Algorithm gate: `algorithm != "ed25519"` → `SIGNATURE_UNSUPPORTED_ALGORITHM`
- Private keys are never stored. Comment on `build_signature_metadata_dict`: “not used by the server to sign packages”
- Tests sign with `Ed25519PrivateKey.generate()` / `private.sign(digest.encode("ascii"))` (`tests/test_marketplace_package_trust.py` `_ed25519_keypair`, `_sign_digest`, `test_signed_package_valid`)
- Lifecycle: `lifecycle_service._verify_staged_signature` → `assert_signature_install_allowed` (unsigned install = administrator only)

This is real `cryptography` Ed25519 verify, not JWT/HMAC reused as pack signatures.

### 8. How much JSON Schema / OpenAPI does `package_validator` do?

**Almost none.** `validate_extracted_marketplace_package` / `validate_marketplace_package` (`package_validator.py`) orchestrate:

- Manifest parse + spoofed platform field strip (`license_decision`, `trust_tier`, `signature_status`, …)
- `validate_manifest_dict` (MAN-001..012) + Pydantic `ConnectorManifest`
- `validate_package_identity` (`package_id` / `pack_version` / `package_kind`)
- `validate_platform_compatibility_metadata` (object shape only)
- `collect_declared_external_urls` + `validate_declared_external_url_policy` (**no fetch**)
- `evaluate_manifest_license_policy`

No `jsonschema` import. No `openapi-spec-validator`. No OpenAPI document lint of packs.

OpenAPI/JSON Schema elsewhere (not `package_validator`):

| Surface | Function | Depth |
| --- | --- | --- |
| Builder OpenAPI evidence | `extract_openapi_summary` (`builder/evidence.py`) | Heuristic: `paths` + HTTP methods, `servers`/`host`, `securitySchemes` / Swagger `securityDefinitions`. **Not** spec-validating. |
| Authoring contract file | `builder/schemas/structured_translation_result.v1.json` (Draft 2020-12) | File exists; `test_external_agent_authoring_contract_exists` only checks the file parses. Runtime uses **hand-written** `parse_structured_translation` (`builder/result_validator.py`), not `jsonschema.validate` |
| Auth schema load | `loader._load_auth_schema` | AUT-001: root must be an object |
| Singer harvest | `_schema_properties_to_fields` | Reads JSON Schema `properties`/`required` as field catalogs; no draft-07 instance validation |

Canonical M29.4 still `TARGET` for “deep auth/pagination/cursor/checkpoint content checks” and fixture/mapping suites — that gap remains.

### 9. Does `git_acquisition` violate marketplace architecture guardrails?

**No.** Read against canonical 04:

| Guardrail (canonical 04) | Code |
| --- | --- |
| Marketplace is distribution/lifecycle, not a connector runtime | `install_package_from_git_url` downloads bytes then calls existing `install_package` (`lifecycle_service`) |
| V1 packages declarative (YAML/JSON/fixtures/docs; no arbitrary Python/JS/plugins) | Accepts **HTTPS `.tar.gz` / `.tgz` only** (`GIT_URL_UNSUPPORTED` otherwise). Does **not** `git clone`, does not run hooks/submodules |
| M29.5B policy modules must not download | Policy stays in `acquisition_url_policy`; **consumer** is `secure_http_get` (`secure_fetch.py`): DNS validate → GET with `follow_redirects=False` → revalidate Location from scratch → size cap 100 MiB |
| Harvester V1: no remote HTTPS | Unchanged: `REMOTE_ACQUISITION_IMPLEMENTED = False` in harvester |
| Non-goals: no credentials in packs, no second Stream runtime, no auto-enable, no trust-from-claim | `auto_credential_create=False` on capabilities; secret scan + signature + license still run; `require_valid_signature=False` but unsigned still admin-gated; `enforce_license_deny=True` |

Route: `POST /marketplace/git/install` → `marketplace_router.post_git_install` → `install_package_from_git_url`. Capabilities string: `"Git acquisition accepts HTTPS URLs to .tar.gz / .tgz package archives with SSRF controls."`

**Doc lag (not a guardrail break):** canonical 04 M29.3 still says “Remote URL/Git acquisition remains `TARGET`.” This HEAD already exposes git HTTPS archive install + `git_acquisition=True` capabilities (`test_marketplace_ui_api.py`). That sentence in canonical 04 is stale vs code; the implementation stays inside the allowed envelope (archive → same validate/install path, SSRF policy, no clone, no runtime).

`app/credentials/` is **not** a marketplace validator. It is ORM credential CRUD (`create_credential`, `serialize_credential_read`) with `mask_secrets` / encrypted `auth_json`. Marketplace must not auto-create credentials (capabilities flag).

### W6 classification

| Item | Classification |
| --- | --- |
| **W6 — SMP-002 in existing validator** | **PARTIAL** |

Not `ALREADY_IMPLEMENTED`: W6 named `validator.py` + `is_sensitive_field_name` on `sample*.json`; that wiring is absent; SMP-002 key-presence vs placeholder-value semantics differ.  
Not `STILL_REQUIRED`: marketplace ingest already blocks literal secrets/PEM via `package_secret_scan` (stronger operational gate than detect-secrets).  
Not `DELETE_FROM_WORKPLAN`: leftover unique work is optional — apply SMP-002 (or reuse `_SECRET_KEY_PATTERN`) on builtin `connectors/` samples inside `validator.py`/`loader.py` so registry load matches spec 049; do **not** add detect-secrets to do that.

### Stale claims in the original Agent 5 body

| Original claim | Correction |
| --- | --- |
| “Data Relay **does not have a marketplace**.” | Local marketplace control plane exists (`marketplace_router`, lifecycle, catalog). Hosted `market.datarelay.run` / full UI remain TARGET. |
| Q1 no marketplace backend | Specs 013/049 non-goals are historical vs canonical 04 M29.x |
| Q7 no pack archive ingest | `lifecycle_archive.extract_tar_gz_to_staging` + zip-slip/symlink protections |
| Q8 no Git-based package install | HTTPS `.tar.gz` acquisition exists; not git clone |
| Q9 no pack Ed25519 | `verify_package_signature` uses `Ed25519PublicKey.verify` |
| Q13 SMP-002 not wired | Wired on **marketplace packages**; still not in `validator.py` |
| `completeness.py` / `classify_package_completeness` is the install gate | **File absent** on `99dd3ba`. Completeness language is MIG-* in `migration.py` and Builder `INCOMPLETE`. Do not treat untracked `completeness.py` from the `1f270e8` dirty workspace as HEAD evidence. |
| Q14 no SPDX/license on packs | `license_policy.evaluate_manifest_license_policy`; Manifest v2 license/provenance fields |
| Stage 1 Git clone absent | Git **clone** still absent (correct); Git **archive URL** present |
| Stage 8 “Data Relay never calls Ed25519 for packs” | **STALE** |

**Unchanged:** do not replace Pydantic MAN-* with `jsonschema`; do not run OpenAPI validators on `manifest.yaml`; do not add detect-secrets as a second runtime scanner; do not replace JWT with pack signatures.

---

**Original audit (implementation status STALE; OSS clone research retained)**  
**Product:** Data Relay (`gdc-platform`)  
**Branch:** `feature/post-m29-development`  
**Audit date:** 2026-08-28  
**Scope:** Package ingest safety for a *proposed* marketplace pipeline vs **existing** Data Relay validation.  
**Constraint:** This document is audit-only. It does not implement features, does not modify tests or configs, and does not propose duplicating existing Data Relay validation as new product surfaces.

---

## Executive summary

Data Relay **does not have a marketplace**. **STALE on reconcile HEAD** — local marketplace lifecycle/catalog/security gates exist; hosted public marketplace remains TARGET. Original sentence:

Data Relay **does not have a marketplace**. Specs, changelog, and v1 readiness explicitly forbid remote catalogs, package upload, Git install, and AI auto-publish.

What *does* exist is a **filesystem Connector Registry** plus a **Phase 1 Template Registry**:

| Surface | Role | Install gate |
| --- | --- | --- |
| `connectors/*/manifest.yaml` | Built-in connector modules | Completeness `COMPLETE` required before materialize |
| `templates/**/*.json` | Phase 1 flat templates | Pydantic `TemplateDefinition` then ORM instantiate |
| `templates/drafts/` | Operator Template Drafts | Heuristic inference; not published Source Packs |

A proposed ten-stage marketplace pipeline (Upload/Git/AI → … → Install) would mostly **reuse** these layers. New OSS libraries should be considered only where Data Relay has a documented gap **and** a future product decision opens that ingest path. Do not rebuild manifest lint, completeness, secret masking, backup-bundle validation, JWT verification, or TLS cert generation.

**OSS clones reviewed** (shallow, `/tmp/oss-audit-clones/`):

| Repo | HEAD | What it actually does |
| --- | --- | --- |
| [python-openapi/openapi-spec-validator](https://github.com/python-openapi/openapi-spec-validator) | `2121137` (v0.9.0, 2026-05-20) | Validates OpenAPI 2.0 / 3.0 / 3.1 / 3.2 documents via `jsonschema` |
| [python-jsonschema/jsonschema](https://github.com/python-jsonschema/jsonschema) | `2d7d41e` (2026-08-27) | Draft 3–2020-12 instance validation |
| [Yelp/detect-secrets](https://github.com/Yelp/detect-secrets) | `5e14193` (2026-04-02) | Repo/diff secret scanners + keyword/PEM plugins |
| [pyca/cryptography](https://github.com/pyca/cryptography) | `ac0a94c` (2026-08-28) | Ed25519 sign/verify + X.509; **already a transitive Data Relay dependency** |

---

## Existing Data Relay map (do not duplicate)

```text
connectors/{id}/manifest.yaml     ──► loader.load_connector_modules()
         streams/, mappings/,          validator.validate_manifest_dict  (MAN-001..005)
         enrichments/, auth_schema,    validator.validate_stream_template (STR-001..003)
         api_test.yaml, docs.md        validator.validate_mapping_json    (MAP-001)
                                       validator.validate_enrichment_json (ENR-001)
                                       validator.validate_api_test_yaml   (API-001)
                                       loader._load_auth_schema           (AUT-001)
                                       migration.validate_migration_completeness (MIG-001..004)
                                       completeness.classify_package_completeness
                                              │
                                              ▼
templates/*.json  ──► templates.registry.load_template_definitions()
templates/drafts/ ──► templates.draft_storage.write_draft_artifacts()
curl / Postman    ──► backup.curl_parser / backup.postman_parser  (headers masked)
workspace JSON    ──► backup.import_validator.validate_import_bundle()
                      │
                      ▼ install
connector_templates.service.materialize_templates()   # COMPLETE only
templates.service.instantiate_template()              # Phase 1 JSON
```

Frontend catalog and wizard consume the **same** completeness flags (`usable`, `completeness_status`). They do not add a second validator.

---

## Proposed pipeline vs Data Relay (stage classification)

Classification vocabulary: **existing** | **improve** | **replace** | **add dependency**.

`replace` is unused: nothing in Data Relay should be torn out for these OSS libraries.

### Stage 1 — Upload / Git / AI

**Classification: existing** (ingest that exists) **+ not a product surface** (marketplace zip / git clone / LLM pack generation).

| Ingest | Data Relay today | File / function |
| --- | --- | --- |
| curl paste | Parse + mask secrets; no persistence of raw headers | `app/backup/curl_parser.py` — `parse_curl_command`, `build_curl_import_draft` |
| Postman JSON | Collection parse → same draft shape | `app/backup/postman_parser.py` — `parse_postman_collection`, `build_postman_import_draft` |
| HTTP UI | Paste/upload Postman v2.1 or curl | `frontend/src/components/connectors/http-import-panel.tsx` |
| Template Draft | Operator-approved draft from CURL / POSTMAN / API_TEST_SAMPLE | `app/templates/draft_service.py` — `create_draft`; `ImportSource` in `app/templates/draft_schemas.py` |
| Git clone of a pack | **Absent.** Spec non-goal | `specs/013-template-connector-system/spec.md` Non-Goals; `specs/049-template-registry/spec.md` §8 |
| AI-generated connector pack | **Absent.** Heuristic inference only; AI gateway is event proxy | `app/templates/inference/engine.py` — `run_sample_inference`; `app/ai_gateway/` |

Do **not** add a second “marketplace upload API” that reimplements curl/Postman/draft ingest. Git install and LLM pack generation are product non-goals (`docs/v1-readiness-checklist.md` “No marketplace, no remote template registry”; `CHANGELOG.md` “Manual templates — no remote template registry or marketplace”).

If a future spec *opens* zip/git ingest, Git clone must be a new threat model (SSRF, `.git` hooks, submodule LFS). That is not an improvement of today’s registry.

### Stage 2 — Archive Safety

**Classification: existing** for path hygiene and JSON bundle ingest; **not applicable** to connector packages (they are directories in git, not zip/tar).

| Concern | Existing impl | File / function |
| --- | --- | --- |
| Path traversal on draft ids | `replace("/", "_").replace("..", "_")` | `app/templates/draft_storage.py` — `draft_dir`, `read_draft_artifacts`, `delete_draft_artifacts` |
| Workspace/connector/stream import | JSON object graph, not zip extract | `app/backup/import_validator.py` — `validate_import_bundle`; `app/backup/service.py` — `preview_import`, `apply_import` |
| ZIP creation (outbound only) | Support bundle write; no inbound extract | `app/admin/support_bundle.py` |
| Zip-slip / zip-bomb / tar path | **Not present** (no pack archive extract) | — |

Do **not** introduce a zip-extract validator until product accepts pack archives. The analog to reuse for “untrusted blob → entities” is `validate_import_bundle`, not a new archive library.

### Stage 3 — Manifest Validation

**Classification: existing.** Improve only if Source Pack metadata from `specs/049` is implemented (additive fields on the same loader).

| Rule | Function | File |
| --- | --- | --- |
| MAN-001 id required | `validate_manifest_dict` | `app/connectors_registry/validator.py` |
| MAN-002 vendor required + pydantic field errors | same | same |
| MAN-003 ≥1 stream | same | same |
| MAN-004 auth.type required | same | same |
| MAN-005 duplicate connector id | `detect_duplicate_ids` | same |
| Pydantic shape | `ConnectorManifest.model_validate` | `app/connectors_registry/models.py` |
| YAML/JSON parse | `_read_manifest_file`, `_discover_manifest_paths` | `app/connectors_registry/loader.py` |
| Phase 1 template JSON | `TemplateDefinition.model_validate` | `app/templates/registry.py` — `load_template_definitions`; schema in `app/templates/schemas.py` |
| Draft manifest write | `create_draft` builds `manifest` dict | `app/templates/draft_service.py` |

Tests: `tests/test_connectors_registry_m17_5_1.py` (`validate_manifest_dict`, `detect_duplicate_ids`, `load_connector_modules`).

**Do not** replace Pydantic/MAN-* with `jsonschema.validate` of the same fields.

### Stage 4 — OpenAPI Validation

**Classification: existing** for the **platform HTTP API**; **absent** for connector packs. **add dependency** only if Template Builder OpenAPI ingestion (`specs/049` §9 `POST /templates/builder/draft`, open question #2) is product-approved.

| What exists | File / function |
| --- | --- |
| FastAPI generated `/openapi.json` | `app/main.py` (docs/redoc/openapi path handling); `app/auth/role_guard.py` allowlist |
| OpenAPI as *evidence type* in Source Pack design | `specs/049-template-registry/spec.md` §2.2, §3.1 `source_evidence.type: openapi` |
| Frontend OpenAPI import | **None** (`http-import-panel` is Postman/curl only) |

OSS: `openapi_spec_validator.shortcuts.validate` / `validate_url` (`openapi_spec_validator/shortcuts.py`); `SpecValidator.validate` / `iter_errors` (`openapi_spec_validator/validation/validators.py`). `validate_url` uses `all_urls_handler` — SSRF risk if pointed at operator-supplied URLs (matches spec 049 open question #2).

Do **not** run OpenAPI validators against `connectors/*/manifest.yaml` or `auth_schema.json`. Those are not OpenAPI documents.

### Stage 5 — Secret Scan

**Classification: existing** (runtime/API/CI/event paths). **improve** pack lint by applying **already-owned** secret-name rules to sample/preset files (spec 049 `SMP-002`). **add dependency** (`detect-secrets`) only as optional **CI** for the git tree — not as a second runtime marketplace scanner.

| Layer | File / function | What it scans |
| --- | --- | --- |
| Field-name mask | `app/security/secrets.py` — `SENSITIVE_FIELD_NAMES`, `is_sensitive_field_name`, `mask_secrets`, `redact_pem_literals`, `mask_secrets_and_pem` | API payloads, support bundle, masked updates |
| curl import | `app/backup/curl_parser.py` — `mask_http_headers` on parsed headers | Operator paste |
| Production boot | `app/production_security.py` — `validate_production_security_settings`, `secret_is_insecure` | Platform secrets, not packs |
| CI | `.github/workflows/docker-validate.yml` job `lightweight-secret-scan` | `BEGIN RSA PRIVATE KEY` / `BEGIN OPENSSH PRIVATE KEY` in tracked sources |
| Event-time detection | `app/sensitive_detection/detection.py`; `path_rules.py` (reuses `SENSITIVE_FIELD_NAMES`); `pattern_rules.py` — `pem_pattern_match`, `email_pattern_match` | Enriched stream events, not pack files |
| Spec (not coded in registry validator) | `specs/049` §5.4 `SMP-002` | `sample.raw.json` secret-like keys |

OSS `detect-secrets`: `detect_secrets.core.scan.scan_file` / `scan_diff`; plugins `KeywordDetector` (`plugins/keyword.py` DENYLIST `password`, `secret`, `api_?key`, …) and `PrivateKeyDetector` (`plugins/private_key.py` PEM headers). Overlaps CI PEM grep and `redact_pem_literals`.

Do **not** add detect-secrets as a runtime step that re-implements `SENSITIVE_FIELD_NAMES` or event-time `sensitive_detection`.

### Stage 6 — Dependency Validation

**Classification: existing** as “packs have no code dependencies.” **Not applicable** as pip/npm audit of marketplace wheels.

| Fact | Evidence |
| --- | --- |
| Connector modules are YAML/JSON/Markdown | `connectors/okta/` (manifest, stream, mapping, enrichment, auth_schema, docs) |
| Python adapter upload is a Phase 1 non-goal | `specs/013-template-connector-system/spec.md` |
| Platform deps | `requirements.txt` — no `jsonschema`, `openapi-spec-validator`, or `detect-secrets`. `python-jose[cryptography]` already pulls `cryptography` |

Do **not** invent a package `requirements.txt` auditor for config packs.

### Stage 7 — License / Provenance

**Classification: existing** for **event/dataset** provenance; **absent** for SPDX license on packs. **improve** only when Source Pack `source_evidence` (`specs/049` §3.1) is implemented on the registry loader — do not add a license-scanner product.

| Kind | File / function |
| --- | --- |
| DB source event provenance keys | `specs/028-database-query-source/spec.md` (`gdc_db_*`) |
| Lab vs seed badges | `frontend/src/utils/streamOperationalBadges.ts`; `docs/runtime/runtime-capability-matrix.md` |
| Backup template metadata warning | `app/backup/import_validator.py` — `TEMPLATE_METADATA_PRESENT` |
| Pack SPDX / signature provenance | **Not in** `ConnectorManifest` (`app/connectors_registry/models.py`) |
| Pack signing as open question | `specs/049-template-registry/spec.md` Open questions #1 |

### Stage 8 — Signature Verification

**Classification: existing** for **JWT, TLS, webhook HMAC, SSH keys**. **Absent** for pack signatures. **add dependency: no** — `cryptography` is already present. Use it only if product answers spec 049 Q1 “yes”.

| Existing crypto | File / function | Algorithm |
| --- | --- | --- |
| Session JWT encode/decode | `app/auth/jwt_service.py` — `_signing_key`, `decode_token` (`jwt.decode`, require exp/sub/uid/role/tv/typ) | HMAC via `python-jose[cryptography]` |
| Production secret fail-closed | `app/production_security.py` | config policy |
| TLS cert generate | `app/platform_admin/cert_service.py` — RSA + x509 | `cryptography.hazmat.primitives.asymmetric.rsa` |
| Webhook / AI proxy HMAC | `app/runners/webhook_receiver.py`, `app/runners/ai_proxy_receiver.py` — `hmac.compare_digest` | HMAC |
| Remote-file SSH | `app/sources/remote_file_ssh.py` — `paramiko.Ed25519Key.from_private_key` | SSH client keys, **not pack signing** |
| Content hash (not signature) | `app/backup/import_validator.py` — `preview_token_for` (SHA-256 of canonical JSON) | integrity token, not Ed25519 |

OSS Ed25519: `cryptography.hazmat.primitives.asymmetric.ed25519.Ed25519PrivateKey.sign` / `Ed25519PublicKey.verify` (`src/cryptography/hazmat/primitives/asymmetric/ed25519.py`). Data Relay never calls this API for packs. **STALE** — `package_signature.verify_package_signature` calls `Ed25519PublicKey.verify`.

Do **not** replace JWT verification with Ed25519 pack signing.

### Stage 9 — Fixtures

**Classification: existing** (load + structural checks). **improve** by implementing spec 049 sample/mapping rules **inside** the current validator (MAP-002, SMP-001, ARR-001), using `app/templates/inference` / `app/parsers.event_extractor.extract_events` — not a new fixture runner.

| Fixture | Load / validate | File / function |
| --- | --- | --- |
| Stream templates | `validate_stream_template` STR-001..003 | `validator.py`, `loader._load_stream_templates` |
| Mapping/enrichment JSON | MAP-001 / ENR-001 object check | `validator.py`, `loader._load_json_directory` |
| `api_test.yaml` | API-001 root object | `validator.py` — `validate_api_test_yaml`; `loader._load_api_test` |
| `docs.md` | title/summary metadata only | `validator.py` — `extract_docs_metadata` |
| Auth schema file present | AUT-001 | `loader._load_auth_schema` |
| Draft samples | `sample.raw.json` / `sample.normalized.json` | `app/templates/draft_storage.py` — `write_draft_artifacts` |
| Live API Test vs sample | Design only | `specs/049` §5.8 |

Built-in inventory (`tests/test_connectors_registry_completeness.py` — `test_builtin_package_inventory_completeness`):

| Module | Completeness |
| --- | --- |
| crowdstrike, okta, microsoft_graph | `COMPLETE` |
| cybereason | `INCOMPLETE` |
| orca, sentinelone, wiz | `METADATA_ONLY` |

That classification **is** the fixture/completeness gate. Do not add a parallel “marketplace fixture score.”

### Stage 10 — Install

**Classification: existing.**

| Path | Gate | File / function |
| --- | --- | --- |
| Connector module → Stream/Mapping/Enrichment/Checkpoint | `entry.status == "valid"` and `package_is_usable(completeness)` | `app/connector_templates/service.py` — `materialize_templates` (TPL-001, TPL-002, TPL-005); `app/connector_templates/materializer.py` — `materialize_stream_template` (TPL-003, TPL-004) |
| HTTP | `POST /api/v1/connector-templates/materialize` | `app/connector_templates/router.py`; mounted in `app/main.py` |
| Phase 1 JSON template | `instantiate_template` creates normal ORM rows, stream `enabled=false` | `app/templates/service.py`; `POST /api/v1/templates/{id}/instantiate` |
| Completeness API | `usable`, `completeness_status`, `completeness_reasons` | `app/connectors_registry/service.py` — `_completeness_fields`, `list_connector_summaries` |
| Catalog UI | “Not installable” when `!packageIsUsable` | `frontend/src/components/administration/connector-catalog-page.tsx` |
| Wizard | Only COMPLETE selectable for materialize | `frontend/src/components/streams/wizard/builtin-package-picker.tsx`; `stream-template-picker.tsx`; `schema-driven-connection-panel.tsx` |
| Client helper | `packageIsUsable` | `frontend/src/api/gdcConnectorsRegistry.ts` |

Startup: `app/main.py` `lifespan` → `bootstrap_registry()` (fail-open log on exception).

---

## 15 questions (file / function level)

### Q1. Does Data Relay have a marketplace (remote catalog, billing, sharing)?

**No.** Authoritative non-goals:

- `specs/013-template-connector-system/spec.md` Non-Goals: marketplace, remote sync, user uploads, package installer, Python adapter uploads.
- `specs/049-template-registry/spec.md` §8 and acceptance criterion 6: marketplace backend forbidden in that spec.
- `docs/v1-readiness-checklist.md` §8: “No marketplace, no remote template registry.”
- `CHANGELOG.md` Known Limitations: “Manual templates — no remote template registry or marketplace.”

The Administration **Connector Catalog** (`connector-catalog-page.tsx`) lists **local** `connectors/` modules via `GET /api/v1/connectors-registry/`. CHANGELOG’s phrase “template marketplace surfaces” refers to that catalog UI, which OSS production builds hide — not a remote marketplace backend.

### Q2. How are connector packages discovered and registered?

`app/connectors_registry/loader.py`:

- `connectors_root()` → repo `connectors/`
- `_discover_manifest_paths` scans one directory level for `manifest.yaml` | `manifest.yml` | `manifest.json`
- `load_connector_modules` parses, validates, loads sidecars, applies MAN-005 duplicate rejection

`app/connectors_registry/service.py`:

- `bootstrap_registry` / `reload_registry` fill in-memory `_registry_cache`
- HTTP: `app/connectors_registry/router.py` — `GET /`, `POST /reload`, `GET /{id}`, `GET /{id}/resources`

There is no upload-to-registry or Git-sync job.

### Q3. How is a package manifest validated?

`app/connectors_registry/validator.py` — `validate_manifest_dict` (MAN-001..004) then `ConnectorManifest.model_validate` (`models.py`: required `id`, `name`, `vendor`, `version`, `source_type`, `auth`, `streams`). Extra keys allowed (`extra="allow"`), so spec 049 fields can appear without failing.

Phase 1 templates: `app/templates/registry.py` — `load_template_definitions` + `TemplateDefinition` (`app/templates/schemas.py`). Invalid JSON is logged and skipped, not served.

### Q4. How is package completeness / installability classified?

**Not a second validator.** `app/connectors_registry/completeness.py`:

- `classify_package_completeness` maps existing issues → `COMPLETE` | `INCOMPLETE` | `METADATA_ONLY` | `INVALID`
- `is_missing_content_issue` — MIG-001..004 and STR/MAP/ENR/AUT missing-file messages
- `is_structural_invalid_issue` — MAN/STR/MAP/ENR/AUT/API malformed
- `package_is_usable` — only `COMPLETE`

Migration completeness: `app/connectors_registry/migration.py` — `validate_migration_completeness` (MIG-001 docs/auth schema, MIG-002 stream loaded, MIG-003 mapping, MIG-004 enrichment). Explicitly independent of trust tier (`Official ≠ COMPLETE`).

Wired into API by `service._completeness_fields` / `_summary_for_entry`. Tests: `tests/test_connectors_registry_completeness.py`. UI: `frontend/src/components/connectors/package-completeness-badge.tsx`.

### Q5. How does package install work?

Two install paths, both creating **normal ORM rows** (constitution: templates are not runtime objects):

1. **Module materialize** — `materialize_templates` → `materialize_stream_template`. Blocks non-usable modules (`INVALID_MODULE` / TPL-005). Requires mapping preset (TPL-003) and stream template (TPL-004).
2. **Phase 1 instantiate** — `instantiate_template` from static JSON; credentials only at apply time (`TemplateInstantiateRequest.credentials`).

Neither path extracts archives or verifies signatures.

### Q6. Is Source Pack validation implemented (`specs/049`)?

**Partial / Phase A only.** Spec 049 is “specification and design authority.” Implemented:

- Flat JSON registry (`specs/013`) — `app/templates/`
- Directory connector modules (`connectors/`) — closer to Source Pack layout than `templates/<vendor>/<product>/<use_case>/`
- Template Drafts with `status: draft` manifest — `draft_service.create_draft` + `draft_storage.write_draft_artifacts`
- Heuristic mapping/checkpoint inference — `app/templates/inference/engine.py` — `run_sample_inference`

Not implemented as registry rules: MAP-002 JSONPath-vs-sample, SMP-002 secret keys in samples, CHK-001 checkpoint required for publish, compatibility `api_version` mismatch, `source_evidence`, pack signing.

Draft comment in `templates/router.py`: drafts are “not published Source Packs.”

### Q7. Is there package upload (zip/tar) validation?

**No pack archive ingest.** Closest untrusted-config ingest:

- JSON export/import: `validate_import_bundle` (`app/backup/import_validator.py`) — version, graph refs, supported `source_type` / destination adapters, duplicate names, masked-auth warning
- curl/Postman JSON: `app/backup/router.py` — `POST .../curl/parse`, `POST .../postman/parse`

Support ZIP is **export-only** (`app/admin/support_bundle.py`).

### Q8. Is there Git-based package install?

**No.** **STALE for HTTPS archive install** — `install_package_from_git_url` fetches `.tar.gz` with SSRF controls; it still does **not** clone git. Original:

**No.** `draft_storage.draft_dir` sanitizes ids; it does not clone. Platform install docs (`README.md`, `docs/deployment/install-guide.md`) clone **this repo**, not vendor packs.

### Q9. Is package signing or Ed25519 verification implemented?

**No pack signatures.** **STALE** — `package_signature.verify_package_signature` uses `Ed25519PublicKey.verify`. Original:

**No pack signatures.** Ed25519 appears only as:

- SSH private keys for remote-file sources — `app/sources/remote_file_ssh.py`
- UI placeholder `hostname ssh-ed25519 AAAA...` — `frontend/src/components/connectors/remote-file-connector-fields.tsx`

JWT signature verification: `app/auth/jwt_service.py` — `decode_token`. TLS: `app/platform_admin/cert_service.py` (RSA). Spec 049 open question #1 leaves pack signing undecided.

`cryptography` Ed25519 API exists in the already-cloned OSS (`Ed25519PublicKey.verify`) and is already installable via `python-jose[cryptography]`. Using it for packs is a **product decision**, not a missing library.

### Q10. Is AI-generated connector validation implemented?

**No AI pack generator.** Existing related pieces:

- Heuristic Template Builder inference (no LLM) — `run_sample_inference`
- Spec 049 §2.5 / §8: no external AI for generation or approval; no auto-publish
- `CHANGELOG.md`: “No AI transforms”
- AI Gateway / AI Streams — proxy/governance of AI **traffic**, not connector authoring (`specs/090-m31-2-ai-stream-ux/spec.md`: wizard creates `AI_PROXY_RECEIVER` streams)

Do not add an “AI connector validator” that duplicates `validate_manifest_dict` + completeness.

### Q11. Does Data Relay validate OpenAPI documents for packs?

**No.** Platform OpenAPI is FastAPI’s own schema. Connector `auth_schema.json` is a GDC field list or a JSON Schema **fragment** for forms, not OpenAPI.

OSS `openapi-spec-validator` (`validate`, `SpecValidator.iter_errors`) is relevant **only** if Template Builder accepts OpenAPI files. Prefer **file upload** over `validate_url` to avoid SSRF (`all_urls_handler`).

### Q12. How is JSON Schema used?

**Not via the `jsonschema` PyPI package.** Data Relay uses:

| Layer | Mechanism | File / function |
| --- | --- | --- |
| Backend models | Pydantic v2 `model_validate` | `ConnectorManifest`, `TemplateDefinition`, FastAPI bodies |
| Auth schema load | “root must be an object” | `loader._load_auth_schema` (AUT-001) |
| Frontend auth forms | Normalize GDC `fields[]` **or** JSON Schema `properties` | `frontend/src/components/connectors/schema-form/schema-form-normalize.ts` — `normalizeAuthSchema` |
| Frontend field rules | required / minLength / enum | `schema-form-validation.ts` — `validateSchemaForm` |

`ajv` appears in `frontend/package-lock.json` as a transitive dependency, not an app import.

OSS `jsonschema.validators.validate` (check schema + `best_match` errors) would duplicate Pydantic for manifests. Optional use: **if** auth_schema files are authored as real JSON Schema drafts and operators need draft-07/2020-12 compliance beyond form rendering — **improve** `AUT-001`, do not replace Pydantic manifests.

### Q13. Is secret detection applied to packages?

**Not as a pack-file scanner.** Secrets are handled as:

1. **Forbidden in templates** (policy) — spec 049 §6.4; constitution
2. **Masking on the way in/out** — `app/security/secrets.py`; curl `headers_masked`
3. **CI PEM grep** — `lightweight-secret-scan`
4. **Runtime event findings** — `app/sensitive_detection/` (wrong layer for marketplace zip)

`SMP-002` is the intended pack-level check and is **not** wired into `validator.py`. **Partial STALE:** marketplace `package_secret_scan` is wired; `validator.py` still has no SMP-002. Original:

`SMP-002` is the intended pack-level check and is **not** wired into `validator.py`. Improvement = call `is_sensitive_field_name` / `redact_pem_literals` over loaded mapping/sample JSON in the **existing** loader. That is not a new marketplace feature.

`detect-secrets` `scan_file` is a better fit for **git CI** (keyword + high-entropy + PEM plugins) than for in-process materialize.

### Q14. Is license / provenance validated for packages?

**No SPDX / license field** on `ConnectorManifest`. Provenance that exists is operational (lab seed badges, DB `gdc_db_*` keys, backup `template_metadata` warning), not supply-chain attestation of a vendor pack.

### Q15. Is archive/package zip safety implemented?

**No inbound archive validation** for connector packs. Path safety for drafts: `draft_storage.py`. Graph safety for JSON bundles: `validate_import_bundle`. ZIP write: support bundle only.

Zip-slip, compression bombs, and nested tar are **gaps only if** product adds pack archives. Until then, classifying this as “add a zip library” would invent a surface specs 013/049 forbid.

---

## OSS library review (cloned source)

### openapi-spec-validator (`2121137`)

- Public API: `validate(spec)`, `validate_url(spec_url)`, deprecated `validate_spec` / `validate_spec_url` — `openapi_spec_validator/shortcuts.py`
- Version dispatch: `get_spec_version` → `OpenAPIV2SpecValidator` … `OpenAPIV32SpecValidator`
- Engine: `SpecValidator.iter_errors` runs `schema_validator.iter_errors` then keyword validators (`validation/validators.py`)
- Schema backend: `schemas/backend/jsonschema.py` — `create_validator` via `jsonschema.validators.validator_for`

**Fit:** Template Builder OpenAPI **file** lint. **Not** connector manifests. Avoid `validate_url` on untrusted URLs.

### jsonschema (`2d7d41e`)

- `jsonschema.validators.validate(instance, schema)` — `check_schema` then `best_match(iter_errors)` (`validators.py` ~1265–1332)
- Drafts: Draft3 through Draft202012 (`jsonschema/__init__.py`)

**Fit:** Optional stricter `auth_schema.json` if product standardizes on a JSON Schema draft. **Not** a replacement for `ConnectorManifest` / MAN-* / completeness.

### detect-secrets (`5e14193`)

- `scan_file` / `scan_diff` — `detect_secrets/core/scan.py`
- Keyword denylist — `plugins/keyword.py` (`password`, `secret`, `api_?key`, …)
- PEM — `plugins/private_key.py` (`BEGIN RSA PRIVATE KEY`, `BEGIN OPENSSH PRIVATE KEY`, …)

**Fit:** CI complement to `lightweight-secret-scan` (broader than two PEM strings). **Not** a replacement for `SENSITIVE_FIELD_NAMES`, curl masking, or `sensitive_detection` on events. High-entropy plugins will false-positive on sample payloads and auth schema defaults — baseline/allowlist required.

### cryptography (`ac0a94c`)

- Ed25519: `Ed25519PrivateKey.generate` / `sign`; `Ed25519PublicKey.from_public_bytes` / `verify` — `src/cryptography/hazmat/primitives/asymmetric/ed25519.py` (Rust OpenSSL bindings)
- Already used: `app/platform_admin/cert_service.py` (RSA X.509); pulled by `python-jose[cryptography]`

**Fit:** Pack sign/verify **if** spec 049 Q1 is yes. **Do not** add a second crypto stack. **Do not** replace JWT or TLS with Ed25519 pack signatures.

---

## Recommended reuse (no new parallel product)

If marketplace ingest is ever specified, the pipeline should **call** existing functions, not reimplement them:

```text
[optional future zip/git]
    → draft_storage path rules (or import_validator if JSON bundle)
    → loader.load_connector_modules / validate_manifest_dict
    → completeness.classify_package_completeness + package_is_usable
    → security.secrets.is_sensitive_field_name on samples (SMP-002)
    → connector_templates.service.materialize_templates
```

Optional **add dependency** (only with a matching spec):

| Library | When | Do not use for |
| --- | --- | --- |
| `openapi-spec-validator` | OpenAPI file ingest in Template Builder | Manifest YAML, auth_schema forms |
| `jsonschema` | Auth schema authored as full JSON Schema drafts | Replacing Pydantic MAN-* |
| `detect-secrets` | CI on `connectors/` + `templates/` | Runtime event detection; curl masking |
| `cryptography` Ed25519 | Explicit pack-signing decision | JWT sessions; SSH remote-file keys |

**replace:** none.

---

## Gaps vs proposed pipeline (honest, non-duplicative)

These are absences of **marketplace ingest**, not absences of validation:

1. No zip/tar pack format, so no archive safety stage.
2. No Git pack URL, so no clone/submodule policy.
3. No OpenAPI pack input in UI/API.
4. `SMP-002` / MAP-002 / ARR-001 not executed in `validator.py` (spec 049 vs M17.5 loader).
5. No SPDX license field; no pack Ed25519 signature.
6. Incomplete built-ins (`orca`, `sentinelone`, `wiz` METADATA_ONLY; `cybereason` INCOMPLETE) already **blocked** from install by completeness — working as designed.

---

## Tests and UI that already prove the gate

| Asset | Asserts |
| --- | --- |
| `tests/test_connectors_registry_m17_5_1.py` | Manifest MAN-* , duplicate ids, filesystem load, catalog API |
| `tests/test_connectors_registry_completeness.py` | COMPLETE / INCOMPLETE / METADATA_ONLY / INVALID; builtin inventory; API `usable` |
| `tests/test_connector_templates_m17_5_4.py` | Materialize path |
| `tests/test_templates_api.py`, `tests/test_template_drafts.py` | Phase 1 registry + drafts |
| `frontend/.../builtin-package-picker.test.tsx` | Metadata-only cannot install |
| `frontend/.../stream-template-picker.test.tsx` | INVALID / METADATA_ONLY blocked |
| `frontend/.../connector-catalog-page.test.tsx` | Catalog completeness display |

---

## Verdict

Data Relay already has a **local package validation and install pipeline**: discover → MAN/STR/MAP/ENR/AUT/API/MIG lint → completeness → materialize/instantiate, with secret **masking** and JSON **bundle** validation on adjacent ingest paths.

A marketplace security pipeline should **extend those functions**, not clone OSS validators into a parallel product. `openapi-spec-validator`, `jsonschema`, `detect-secrets`, and Ed25519 are optional tools for **future, spec-gated** OpenAPI ingest, draft-compliant auth schemas, CI secret scanning, and pack signing — none of which should replace the Connector Registry that already exists.
