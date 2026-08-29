# Data Relay ↔ Presidio Sensitive Detection / Protection Audit

> **Closure (2026-08-29):** Scheduled OSS Fit implementation is complete. W4 COMPLETE; W15 IBAN COMPLETE; W15 Phone is `DEFERRED_FALSE_POSITIVE_RISK` (intentional, not a failure). Presidio runtime was not introduced. This file remains the pre-implementation audit record. See [DATA-RELAY-OSS-IMPLEMENTATION-WORKPLAN.md](./DATA-RELAY-OSS-IMPLEMENTATION-WORKPLAN.md).

## Correct-branch reconciliation

**Agent:** E — Governance / Sensitive Detection Delta Reconciliation  
**Date:** 2026-08-29  
**Independent re-verification:** 2026-08-29 — `pattern_rules.py` still PEM+email only (no `luhn`/`iban`/`phonenumbers`/`presidio` under `app/`).  
**Codebase:** `/home/aella/gdc-oss-reconcile`  
**Branch:** `audit/code-to-oss-fit-reconcile`  
**HEAD:** `99dd3bac886760460201f54deaaa282ec0e98bc1`  
**Mode:** Read-only product code. This file only. No implementation.

Reconciles old workplan items **W4** (Presidio Luhn/SSN/email into `pattern_rules.py`) and **W15** (IBAN/phone) against HEAD. Original Agent 6 body below is historical (audited `1f270e8`); function-level facts below are from this HEAD.

### Verdict

| Workplan | Classification | Reason |
|----------|----------------|--------|
| **W4** — Luhn PAN, SSN invalidation, stronger email | **STILL_REQUIRED** | Not equivalent today. Value patterns are still PEM + full-string email only. No Luhn, no SSA invalidation, no TLD/embedded email in `pattern_rules.py`. Field-name hits on `credit_card` / `ssn` are **not** checksum validation. |
| **W15** — IBAN checksum / optional phone values | **STILL_REQUIRED** | Not equivalent today. No IBAN leaf, regex, or checksum. Phone is field-name (`phone` / `mobile` / `msisdn`) plus protection last-4 mask — not value detection. No `phonenumbers`. |
| Presidio `AnalyzerEngine` / spaCy / anonymizer / structured / image / GLiNER | **REJECT** (unchanged) | Parallel governance + NLP on the hot path. Canonical `docs/canonical/05-GOVERNANCE-SECURITY.md` already owns Stream findings → Protection → Classification → Policy → Delivery. |

Neither W4 nor W15 is `ALREADY_IMPLEMENTED`, `PARTIAL`, `NO_LONGER_NEEDED`, or `DELETE_FROM_WORKPLAN`. Field-name PII and protection masking existed when W4/W15 were written; they do not close the checksum/value-pattern gap.

### Actual pattern functions (`app/sensitive_detection/pattern_rules.py`)

Module docstring: `"Value pattern rules for sensitive detection (PEM + email only)."`

| Symbol | Behavior at HEAD |
|--------|------------------|
| `pem_pattern_match(value)` | `"-----BEGIN"` and `"-----END"` substring. Class `secret`, rule `pattern.pem`. |
| `email_pattern_match(value)` | Full-string `^…$` regex, max 320 chars. No TLD check, no substring/embedded match. |
| `evaluate_pattern_rules(field_path, *, inferred_type, sample_value)` | Strings only; **PEM before email**; at most one hit. Email also requires `leaf_allows_pattern_pii(leaf)` (field-name PII leaf). Both paths still call `apply_false_positive_policy`. |

**Absent (W4/W15 targets):** `luhn_*`, credit-card regex/validate, SSN `invalidate_result`, IBAN checksum, phone matcher, KR RRN, score/validate-invalidate API. Grep of `app/` finds no `luhn`, `iban`, `phonenumbers`, `presidio`, `spacy`, or `AnalyzerEngine`.

### Detection / path rules (not checksums)

| File | Functions | HEAD fact |
|------|-----------|-----------|
| `detection.py` | `detect_hits_for_batch`, `collect_string_samples_from_events`, `persist_sensitive_hits` | Field-name then `evaluate_pattern_rules` on **first string sample per path**. Caps: depth 64 / paths 5000 / events 500. Never stores raw values (`_FORBIDDEN_FINDING_JSON_KEYS`). |
| `path_rules.py` | `evaluate_field_name_rules`, `apply_false_positive_policy`, `leaf_allows_pattern_pii` | Exact PII leaves include `email`, `phone`, `mobile`, `msisdn`, `ssn`, `social_security`, `national_id`, `credit_card`, `card_number`. **No `iban`.** Seven FP policies unchanged. `leaf_allows_pattern_pii` is still “email pattern only if PII field-name would match.” |
| `suggestions.py` | `suggested_sensitive_type_for_hit` | Labels for `pattern` `email`/`pem` plus leaf names (`Likely Credit Card`, `Likely Phone`). Suggestion-only. |

A leaf named `credit_card` is flagged without Luhn. A Luhn-valid PAN in `$.payload.pan` is still **not** flagged. Same for SSN/IBAN values in oddly named fields.

### Protection / classification / route overlay (already complete; out of W4/W15)

| Area | File → functions | Relation to W4/W15 |
|------|------------------|-------------------|
| Protection apply | `app/protection/engine.py` `protect_batch` | Path-targeted. Do not change for checksums. |
| Mask modes | `app/protection/modes.py` `partial_mask_value` | Email local/domain mask; **≥7 digits → last-4**. Masking, not detection. |
| Policy extra | `app/protection/policy_engine.py` `_EMBEDDED_EMAIL_RE` / `_findings_from_text` | AI-text embedded email only. Does **not** harden `pattern_rules.email_pattern_match`. |
| Classification | `app/classification/levels.py` `default_level_from_findings`; `engine.py` `classify_batch` | Consumes existing hit classes. New pattern hits would flow automatically. |
| Route protection | `app/route_protection/resolver.py` `resolve_route_protection_config` | Filters `route_overrides` with `int(item.get("route_id")) == route_id`. |
| Route policy | `app/route_policy/resolver.py` `resolve_route_policy_config` | Route-scoped `delivery_behavior` + drift gates. |

Canonical `05-GOVERNANCE-SECURITY.md` requires this stack (Stream execution, Route processing, Transform → Protection → Classification → Policy → Delivery). It does **not** require Luhn/IBAN/SSN value validators. W4/W15 remain **accuracy** work inside `pattern_rules.py`, not a governance-architecture hole.

### Tests (no checksum corpus)

`tests/test_sensitive_detection_rules.py` covers FP policies + `test_pattern_pem_secret` + email leaf gate / email-on-`$.email`. No Luhn PAN tables, SSN invalidation, IBAN, or phone-value cases. Other tests (`test_sensitive_detection_runtime.py`, `test_sensitive_detection_upsert.py`, `test_oss_v101_sprint7_sensitive_detection_batch.py`, `test_union_schema_sensitive_suggestions.py`) exercise field-name / persist / batch upsert — not W4/W15 algorithms.

### REJECT (reaffirmed)

- `DIRECT_DEPENDENCY` of `presidio-analyzer` / `presidio-anonymizer` / `presidio-structured`
- spaCy / `AnalyzerEngine` / NER / GLiNER / Transformers / LangExtract / image-redactor
- Replacing `protect_batch` with Presidio anonymizer
- Enabling IP/URL/UUID/DATE/PERSON as default PII

Optional later `phonenumbers` **alone** (Apache-2.0) remains acceptable **only if** W15 implements phone **value** detection; it is still not present.

### Workplan action

Keep **W4** (P1 `SOURCE_ADAPTATION` + `TEST_CORPUS`) and **W15** (P2, after W4). Do not delete. Do not mark implemented. Port algorithms into `pattern_rules.py` behind existing FP + `leaf_allows_pattern_pii` + confirm-runs. Do not touch Protection Engine architecture or route override merge.

---

**Agent:** 6 — Sensitive Detection / Protection  
**Date:** 2026-08-28  
**Requested branch:** `feature/post-m29-development`  
**Workspace HEAD at audit time:** `fix/route-processing-ux-p0-1-classification-policy` (`1f270e8`)  
**Mode:** Read-only Code-to-OSS Fit Audit. No Data Relay source, tests, configs, Full Matrix, or QA Lab were modified. No implementation.

**OSS clone:** `/tmp/oss-audit-clones/presidio` (shallow clone of `https://github.com/microsoft/presidio`)  
**OSS HEAD inspected:** `eb93051` (2026-08-26) `feat(analyzer): Add Healthcare identifiers recognizer (#2159)`  
**Packaged version in source:** `presidio_analyzer` / `presidio_anonymizer` `2.2.364`  
**OSS license:** MIT (`LICENSE` at repository root; `pyproject.toml` classifiers `License :: OSI Approved :: MIT License`)

---

## 0. Guardrails (non-negotiable)

| Guardrail | Implication for this audit |
|-----------|----------------------------|
| Do **not** replace Data Relay Governance architecture | Keep Stream findings → Protection rules → Classification → Policy → Delivery |
| Do **not** assume full Presidio runtime adoption | `AnalyzerEngine` is **REJECT**, not a drop-in DLP sidecar |
| One Stream → Many Routes → Many Destinations | Route overrides stay **route-scoped**; never duplicate Streams |
| Route Processing order | Transform → **Protection** → **Classification** → **Policy** → Delivery |
| Runtime-First | Detection/protection changes must not replace StreamRunner / checkpoint / delivery |
| No Parallel Governance Engine | Presidio analyzer/anonymizer/structured **services** are out |
| E2E throughput 5–20 EPS | spaCy / GLiNER / Transformers / LLM recognizers are incompatible with the hot path |

**Adoption methods used below**

| Method | Meaning in this audit |
|--------|------------------------|
| `DIRECT_DEPENDENCY` | Add an OSS package as a runtime dependency |
| `SOURCE_ADAPTATION` | Port a recognizer/pattern/checksum into Data Relay modules |
| `HARVESTER_SOURCE` | Not applicable (connector metadata harvest) |
| `TEST_CORPUS` | Reuse OSS pytest cases as Data Relay tests |
| `REFERENCE_PATTERN` | Copy an algorithm/pattern; do not take the engine |
| `REJECT` | Do not adopt |

---

## 1. Executive verdict

Data Relay already has a **complete, route-aware governance stack**: field-name + two value patterns for detection, operator findings workflow, path-targeted protection (full/partial mask, HMAC hash, identity-vault tokenization, drop), classification levels, policy actions, and **per-route overrides** that merge onto shared stream rules without duplicating streams.

Microsoft Presidio is a **unstructured-text PII SDK** (analyzer + anonymizer + optional structured/image/CLI). What is better than Data Relay today is the **recognizer library**: Luhn-validated credit cards, IBAN checksums, SSA-aware US SSN invalidation, TLD-validated emails in free text, `phonenumbers`-based phones, and a large **pytest corpus**. What must not be adopted is the **analyzer engine, spaCy/NER stack, anonymizer service, image redactor, or structured engine as a parallel governance runtime**.

**Recommended posture**

| Priority | Item | Adoption | Target |
|----------|------|----------|--------|
| **P1** | Credit-card Luhn + SSN invalidation + email value hardening | `SOURCE_ADAPTATION` | `app/sensitive_detection/pattern_rules.py` |
| **P1** | Presidio recognizer pytest tables (email, CC, SSN, IBAN, KR RRN) | `TEST_CORPUS` | `tests/test_sensitive_detection_rules.py` |
| **P2** | IBAN checksum; optional KR RRN; optional phone | `SOURCE_ADAPTATION` | same pattern module + FP policy |
| **P2** | `validate_result` / `invalidate_result` + score bands | `REFERENCE_PATTERN` | pattern hit metadata only |
| **LATER** | Country-specific ID packs (opt-in, not default) | `SOURCE_ADAPTATION` | gated by stream/tenant locale |
| **REJECT** | `presidio-analyzer` / spaCy / `AnalyzerEngine` as runtime | `REJECT` | — |
| **REJECT** | `presidio-anonymizer` replacing Protection Engine | `REJECT` | — |
| **REJECT** | `presidio-structured` / image-redactor / LangExtract / GLiNER / Azure NER | `REJECT` | — |

There is **no P0**. Existing field-name detection plus operator/auto-protect already covers the operational path. Value-pattern expansion is an accuracy improvement, not a missing architecture.

`HARVESTER_SOURCE` does not apply. `DIRECT_DEPENDENCY` of Presidio packages is **REJECT**. Optional later `DIRECT_DEPENDENCY` of **`phonenumbers` alone** (Apache-2.0, already a Presidio dep) is acceptable only if Data Relay adds phone **value** detection; it is not required to start.

---

## 2. Data Relay — where the function lives today

### 2.1 Pipeline (already implemented)

Route Processing is **Transform → Protection → Classification → Policy → Delivery**:

| Stage | Module | Function |
|-------|--------|----------|
| Orchestration | `app/runners/route_stage.py` | Fan-out per route; reuses shared detection context |
| Detection (batch, once) | `app/sensitive_detection/detection.py` `detect_hits_for_batch` | Field-name + pattern hits on enriched JSON paths |
| Detection persist | `app/sensitive_detection/service.py` `detect_sensitive_fields` | Upsert `stream_sensitive_findings`; non-blocking |
| Shared context | `app/sensitive_detection/context.py` `SensitiveDetectionContext` | Single-pass findings reused by classification/policy |
| Protection resolve | `app/route_protection/resolver.py` `resolve_route_protection_config` | Dual-read route vs stream rules + **route_id-filtered** overrides |
| Protection apply | `app/protection/engine.py` `protect_batch` | Path-targeted mask/hash/tokenize/drop |
| Protection stage | `app/route_protection/stage.py` `route_protection_stage` | Cache identical inherited configs across routes |
| Classification | `app/classification/engine.py` `classify_batch` | Sensitivity class → PUBLIC/INTERNAL/CONFIDENTIAL/RESTRICTED |
| Classification stage | `app/route_classification/stage.py` | Uses **shared findings**, not a second detector |
| Policy | `app/protection/policy_engine.py` | Post-protection conditions; quarantine/block/audit |
| Policy stage | `app/route_policy/stage.py` + `app/route_policy/resolver.py` | Route overlay of matching stream conditions |

**Route overrides stay route-scoped.** `resolve_route_protection_config` filters `route_overrides` with `int(item.get("route_id")) == route_id`. Classification floors and policy `delivery_behavior` do the same. This does **not** duplicate Streams.

### 2.2 Sensitive detection (M5)

| File | Role |
|------|------|
| `app/sensitive_detection/models.py` | Classes: `secret`, `pii`, `security_metadata`. Methods: `field_name`, `pattern`. Confirm-run gate. |
| `app/sensitive_detection/path_rules.py` | Exact/substring field-name rules + **seven false-positive policies** (standalone id/uuid, `_id` suffix, metric substrings, token allow-list, session, cookie, bare `user`) |
| `app/sensitive_detection/pattern_rules.py` | **Only two value patterns:** PEM (`-----BEGIN`/`-----END`) and **full-string** email regex, both still gated by FP policy; email additionally requires a PII leaf |
| `app/sensitive_detection/detection.py` | Walks JSON paths (depth/path/event caps from `app/config.py`); **first string sample per path**; never stores raw values in `finding_json` |
| `app/sensitive_detection/operator_workflow.py` | Acknowledge / resolve / API visibility after `GDC_SENSITIVE_DETECTION_CONFIRM_RUNS` (default 2) |
| `app/sensitive_detection/suggestions.py` | Union Schema labels; **suggestion-only**, does not persist or create rules |
| `app/security/secrets.py` `SENSITIVE_FIELD_NAMES` | Credential leaf names reused as secret Tier-A matches |
| `tests/test_sensitive_detection_rules.py` | FP policy + PEM/email contract |

**Hard limits (hot-path safe):** `GDC_SENSITIVE_DETECTION_MAX_DEPTH=64`, `MAX_PATHS=5000`, `MAX_EVENTS_PER_RUN=500`. Detection is **path-oriented JSON**, not free-text NER.

**Value-pattern gap (real):** credit-card / SSN / phone / IBAN / national ID **values** are not validated. A field named `credit_card` is flagged by leaf rules; a Luhn-valid PAN in `$.payload.pan` is not.

### 2.3 Protection / masking (M6–M7, M13.3)

| File | Role |
|------|------|
| `app/protection/models.py` | Modes: `full_mask`, `partial_mask`, `hash`, `tokenization`, `drop_field`. Policy actions: audit/quarantine/block/require_review |
| `app/protection/modes.py` | `********`; email `a***@d***.tld`; phone last-4; HMAC-SHA256 `sha256:…` |
| `app/protection/identity_vault.py` | Reversible **token** `USER_NNNNNN`; stores **hash only**, never plaintext |
| `app/protection/engine.py` | JSONPath-like `$.a[].b` application; batch vault lookup |
| `app/protection/ephemeral.py` | Batch-local auto-protect (schema-drift), not persisted |
| `app/schema_drift_policy/orchestrator.py` | `unknown_sensitive_field_policy` including `auto_protect` |
| `frontend/src/components/streams/protection-panel.tsx` | Stream vs **route** rule UI |
| `frontend/src/components/streams/wizard/step-data-protection.tsx` | Wizard actions: audit / mask_partial / mask_full / tokenize / hash / drop_field + **route overrides** |

Partial mask is **structured-field** (email/phone heuristics on a leaf value), not span-in-paragraph redaction.

### 2.4 Classification and policy

| File | Role |
|------|------|
| `app/classification/levels.py` | secret→RESTRICTED, pii→CONFIDENTIAL, security_metadata→INTERNAL |
| `app/classification/engine.py` | Rules override defaults; stamps level on events |
| `app/protection/policy_engine.py` | Evaluates findings + classification; extra embedded-email regex for AI text |
| `app/governance_policies/` | Named policy catalog (DRAFT→REVIEW→ACTIVE→RETIRED) |
| `frontend/src/components/governance/policy-editor-drawer.tsx` | DATA_PROTECTION / COMPLIANCE; actions quarantine/tokenize/mask/audit_only |

### 2.5 Governance UI (operations, not a detector)

Inspected under `frontend/src/components/governance/`: dashboard, workspace, policy catalog/editor/simulation/impact, violation/quarantine/replay centers, audit trail, approval, operations. These **compose existing APIs**. Sensitive findings UX lives primarily on the stream:

- `frontend/src/components/streams/sensitive-findings-panel.tsx`
- Quarantine detail shows `sensitive_findings` (`quarantine-center-page.tsx`)

### 2.6 Current structure and limits

**Strengths**

- Operator-in-the-loop (confirm runs, acknowledge, false-positive resolution).
- Findings never persist sample values (`_FORBIDDEN_FINDING_JSON_KEYS`).
- Protection is **field-path**, matching JSON events and Union Schema.
- Inherited protection is executed **once per identical config** (`protection_execution_cache_key`) so extra routes do not multiply `protect_batch`.
- Secrets/credentials are a **first-class class**; Presidio barely covers this.

**Limits vs a text DLP toolkit**

- Two value patterns only; email must be the **entire** string (`^…$`).
- No checksum validation (Luhn, IBAN, RRN, SSN group rules).
- No confidence score; a hit is boolean.
- No in-string entity spans (by design: JSON leaves, not prose).
- Country-specific national IDs are field-name only (`ssn`, `national_id`).

---

## 3. Presidio — what was actually inspected

Shallow clone, not README-only. Key trees:

```
presidio-analyzer/presidio_analyzer/
  analyzer_engine.py
  entity_recognizer.py
  pattern_recognizer.py
  context_aware_enhancers/lemma_context_aware_enhancer.py
  nlp_engine/nlp_engine_provider.py
  recognizer_registry/recognizer_registry.py
  predefined_recognizers/          # 97 *recognizer*.py files
  conf/default_recognizers.yaml
  conf/spacy.yaml                  # default model en_core_web_lg
presidio-anonymizer/presidio_anonymizer/operators/
  mask.py hash.py redact.py replace.py encrypt.py
presidio-structured/               # pandas/JSON → AnalyzerEngine
presidio-image-redactor/           # OCR + redaction
presidio-cli/
presidio-analyzer/tests/           # 110 test_*recognizer*.py files
LICENSE                            # MIT
```

Project is transitioning Microsoft → **Data Privacy Stack** (`docs/project_transition.md`); clone URL remains `github.com/microsoft/presidio`. License stays MIT. Maintenance is active (HEAD 2026-08-26).

### 3.1 Entity taxonomy (code + YAML)

Generic entities used by default recognizers (`conf/default_recognizers.yaml`):  
`CREDIT_CARD`, `EMAIL_ADDRESS`, `PHONE_NUMBER`, `IBAN_CODE`, `IP_ADDRESS`, `CRYPTO`, `DATE_TIME`, `URL`, `UUID`, `MAC_ADDRESS`, plus spaCy NER mapped in `conf/spacy.yaml`: `PERSON`, `LOCATION`, `NRP`, `ORGANIZATION` (ORG **ignored** as high FP).

Country-specific (many **`enabled: false`** by default), including `US_SSN`, `US_PASSPORT`, `UK_NHS`, `KR_RRN` (**disabled** in default YAML; `supported_language: "ko"`), India/AU/DE/IT/ZA/… packs.

This taxonomy is **PII-entity labels on text spans**. Data Relay taxonomy is **sensitivity class + JSON field_path**. Mapping is many-to-one (`CREDIT_CARD`/`US_SSN`/`EMAIL_ADDRESS` → `pii`), not a replacement.

### 3.2 Recognizers and patterns (source)

| Recognizer | File | Mechanism | Score / validation |
|------------|------|-----------|-------------------|
| Email | `predefined_recognizers/generic/email_recognizer.py` | Substring regex + `tldextract` `validate_result` | Pattern 0.5; valid TLD → `MAX_SCORE` 1.0 |
| Credit card | `generic/credit_card_recognizer.py` | Weak regex 0.3 + **Luhn** `validate_result` | Valid Luhn → 1.0 |
| US SSN | `country_specific/us/us_ssn_recognizer.py` | 5 patterns 0.05–0.5 + `invalidate_result` (all-same digits, 000/666 area, 00 group, placeholder SSNs) | Context words boost via enhancer |
| Phone | `generic/phone_recognizer.py` | `phonenumbers.PhoneNumberMatcher` regions US/GB/DE/FR/IL/IN/CA/BR | Base score 0.4 |
| IBAN | `generic/iban_recognizer.py` | Regex + checksum; country pattern table `iban_patterns.py` | 0.5 + validation |
| KR RRN | `country_specific/korea/kr_rrn_recognizer.py` | `YYMMDD-[1-4]dddddd` + region/checksum | Language `ko`; default YAML **disabled** |
| Crypto | `generic/crypto_recognizer.py` | Bitcoin P2PKH/Bech32 checksum | Not API secrets |
| IP / URL / UUID / MAC / Date | generic/ | Regex | **High FP on telemetry JSON** |

`PatternRecognizer.__analyze_patterns` (`pattern_recognizer.py`): compile regex (`regex` package, timeout `REGEX_TIMEOUT_SECONDS` default 60s); `validate_result` True → score 1.0; `invalidate_result` True → score 0 (dropped).

### 3.3 Scoring

- Pattern base score ∈ (0, 1].
- `EntityRecognizer.MIN_SCORE = 0`, `MAX_SCORE = 1.0`.
- `LemmaContextAwareEnhancer`: +0.35 if context lemmas match within 5 prefix tokens (`context_similarity_factor`); default matching mode **substring** (can FP, e.g. `lic` ⊂ `duplicate`).
- `AnalyzerEngine.default_score_threshold` default **0** (everything above 0 returns).
- spaCy NER: `low_confidence_score_multiplier: 0.4`; ORGANIZATION ignored.

Data Relay has **no score**. Adapting scores as optional `finding_json` metadata is `REFERENCE_PATTERN`; driving protection from NER scores is `REJECT`.

### 3.4 Masking / anonymization

`presidio-anonymizer` operators (text **spans**, not JSON paths):

| Operator | File | Behavior vs Data Relay |
|----------|------|------------------------|
| `Mask` | `operators/mask.py` | N chars from start/end with a char |
| `Hash` | `operators/hash.py` | SHA256/512; **random 32-byte salt if omitted** (non-stable) |
| `Redact` | `operators/redact.py` | Empty string |
| `Replace` | `operators/replace.py` | Literal or `<ENTITY>` |
| Encrypt/Decrypt | AES | Not equivalent to identity vault |

Data Relay already has **stronger operational masking** for JSON: stable HMAC per stream, last-4 phone, email local/domain mask, vault tokens, drop_field. Do not replace `app/protection/modes.py`.

### 3.5 Test corpus

110 recognizer test modules under `presidio-analyzer/tests/`. High-value parametrize tables:

- `tests/test_email_recognizer.py` — valid, IDN/punycode, embedded in sentence, trailing-dot negative
- `tests/test_credit_card_recognizer.py` — Visa/MC/Amex/Discover test PANs, dashed/spaced, **failing Luhn negatives**
- `tests/test_us_ssn_recognizer.py` — weak vs medium formats, placeholder invalidation
- IBAN / phone / KR RRN / country IDs similarly structured

Usable as **Data Relay unit tests** after rewriting assertions from `(start,end,score)` spans to `evaluate_pattern_rules(path, sample_value=…)`.

### 3.6 License and dependencies

| Component | License (repo evidence) | Notes |
|-----------|-------------------------|--------|
| Presidio (all packages in this repo) | **MIT** (`LICENSE`) | Attribution required if code is copied |
| `presidio-analyzer` deps (`pyproject.toml`) | spaCy `>=3.4.4,<4` (**hard**), numpy, `regex`, `tldextract`, `phonenumbers`, PyYAML, Pydantic 2 | spaCy is required even if only regex recognizers are used |
| Default NLP | `en_core_web_lg` (`conf/spacy.yaml`) | Hundreds of MB; separate model license/download |
| `presidio-anonymizer` | MIT; dep `cryptography>=48,<49` | Data Relay already uses `python-jose[cryptography]` |
| Optional extras | transformers, stanza, gliner, langextract, Azure AI Language, AHDS | Extra license/cloud surface |

**Python:** Presidio `requires-python = ">=3.10,<3.15"`. Data Relay API image is `python:3.12-slim-bookworm` (`docker/Dockerfile.api`). Version-compatible **if** a dependency were added; it should not be.

**Supply chain:** org transition (microsoft → data-privacy-stack); PyPI homepage in `pyproject.toml` already points at `github.com/data-privacy-stack/presidio`. MIT allows adaptation. No file-level copyleft found in the clone (single root `LICENSE`).

### 3.7 Performance implications (for Data Relay EPS)

| Approach | Cost | Fit for 5–20 EPS batches |
|----------|------|---------------------------|
| Data Relay field-name + 2 regexes on first sample per path | O(paths) Python | Current hot-path design |
| Presidio `AnalyzerEngine` default (spaCy lg + all recognizers) on every event serialized to text | NLP load + dozens of regexes + phonenumbers | **Breaks** throughput and isolation |
| `NoOpNlpEngine` + pattern recognizers only | Still pulls spaCy package; still scans full text | Wrong data model (spans vs paths) |
| Adapted Luhn/IBAN/SSN on **string samples already collected** | A few checksums per path | Compatible if still sample-capped and confirm-gated |
| GLiNER / Transformers / LangExtract | GPU/LLM | `REJECT` |

Presidio README itself warns detection is not guaranteed complete.

---

## 4. What is better than Data Relay today (and what is not)

**Better in Presidio (adapt, do not import the engine)**

1. Credit-card **Luhn** after a weak regex (`CreditCardRecognizer.validate_result`).
2. US SSN **invalidation** (impossible SSA groups, all-same digits, published samples).
3. Email **embedded in text** + **TLD check** (`tldextract`), vs Data Relay full-string-only + PII-leaf gate.
4. IBAN **checksum** and country formats.
5. Phone **regional validation** (`phonenumbers`).
6. KR RRN **format + checksum** (locale pack).
7. Explicit **score + context words + validate/invalidate** pipeline.
8. Large **negative/positive test tables**.

**Better in Data Relay (keep)**

1. JSON **field_path** targeting and Union Schema suggestions.
2. **Secret** and **security_metadata** classes; PEM/API key/token field names.
3. FP policy that **blocks** `id`/`uuid`/`user_id`/`session_token` — Presidio `UuidRecognizer` would fight this.
4. Operator confirm-runs and findings **without storing values**.
5. Route-scoped protection/classification/policy **overrides**.
6. Stable HMAC hash, identity vault, drop_field, inherited-protection cache.
7. Governance catalog, quarantine, replay, audit — Presidio has none of this product surface.

**Worse / dangerous if adopted as-is**

- Default NER `PERSON`/`LOCATION` on log JSON (false positives, PII over-redaction).
- `IP_ADDRESS` / `URL` / `DATE_TIME` / `UUID` as PII on a relay (operational fields).
- Random-salt hash (breaks correlation that Data Relay HMAC is meant to preserve).
- Scanning **all** string values with country regex packs on every batch.

---

## 5. Answers to the 15 planning questions

### Q1. Where is the function implemented in Data Relay?

See §2. Detection: `app/sensitive_detection/*`. Protection: `app/protection/*` + `app/route_protection/*`. Classification: `app/classification/*` + `app/route_classification/*`. Policy: `app/protection/policy_engine.py`, `app/governance_policies/*`, `app/route_policy/*`. UI: stream panels + `frontend/src/components/governance/*` + wizard `step-data-protection.tsx`. Runtime wire-up: `app/runners/route_stage.py`, `app/sensitive_detection/service.py`.

### Q2. Structure and limits of the current implementation?

JSONPath field-name rules + PEM/email patterns; confirm-gated findings; path-targeted protection; shared detection context; route dual-read + override merge. Limits: almost no value checksums; email not substring; no scores; no national-ID validators; detection is sample-first-per-path not full-corpus NER.

### Q3. Which OSS files/modules/functions are relevant?

| OSS | Path | Function / class |
|-----|------|------------------|
| Analyzer orchestration | `presidio_analyzer/analyzer_engine.py` | `AnalyzerEngine.analyze` |
| Pattern runtime | `presidio_analyzer/pattern_recognizer.py` | `PatternRecognizer.__analyze_patterns`, `validate_result`, `invalidate_result` |
| Scoring/context | `lemma_context_aware_enhancer.py` | `enhance_using_context` |
| Registry | `recognizer_registry.py`, `conf/default_recognizers.yaml` | `load_predefined_recognizers` |
| Email / CC / SSN / phone / IBAN / KR RRN | files in §3.2 | `analyze` / `validate_result` |
| Anonymizer | `operators/mask.py`, `hash.py`, `redact.py` | `operate` |
| Structured | `presidio_structured/analysis_builder.py` | wraps `AnalyzerEngine` |
| Tests | `presidio-analyzer/tests/test_*_recognizer.py` | parametrize corpora |

### Q4. What can OSS reduce or improve?

Reduce **hand-rolled** credit-card/SSN/IBAN false negatives by adapting checksums. Improve **test coverage** via corpus. Does **not** reduce Governance/Protection Engine code — those are product, not missing DLP.

### Q5. What overlaps existing Data Relay features?

| Presidio | Data Relay overlap |
|----------|-------------------|
| Email regex | `pattern_rules.email_pattern_match` (stricter leaf gate, weaker embedding) |
| Mask/hash/redact operators | `protection/modes.py` (JSON-aware, already richer) |
| Entity labels PERSON/EMAIL | Findings `pii` + classification CONFIDENTIAL |
| Analyzer as policy engine | `policy_engine.py` + governance policies |
| Structured JSON analysis | `detect_hits_for_batch` + path walker |

Treat overlap as **do not duplicate**.

### Q6. Should Presidio be a dependency?

**No.** `DIRECT_DEPENDENCY` of `presidio-analyzer` pulls spaCy/numpy/`regex`/tldextract/phonenumbers and invites `AnalyzerEngine` on the runtime. `presidio-anonymizer` duplicates Protection Engine with the wrong data model.  
Optional later: `phonenumbers` or `tldextract` **alone** if Q7 ports those recognizers.

### Q7. Should code be adapted?

**Yes, narrowly:** Luhn, SSN `invalidate_result` rules, IBAN checksum, email TLD/embedded match **still behind** `apply_false_positive_policy` and PII-leaf (or an explicit new allow-list). Port into `pattern_rules.py` (+ tests). MIT requires copyright notice in adapted files.

### Q8. Algorithms/patterns only?

**Yes** for: score bands, validate/invalidate split, regex timeout, country-pack **opt-in**. Do not take Lemma enhancer (needs spaCy tokens) unless rewritten against JSON **leaf names** (Data Relay already uses leaves as context).

### Q9. Connector Harvester source?

**No.** `HARVESTER_SOURCE` is N/A. Presidio is not a connector catalog.

### Q10. License usable?

**Yes (MIT)** for source adaptation and test corpus. Do not vendor spaCy models without checking **model** licenses. `phonenumbers` is a separate Apache-2.0 package if added.

### Q11. Does it invade Data Relay architecture?

**Full Presidio runtime: yes** (parallel governance + NLP on events + span anonymizer).  
**Adapted checksums in `pattern_rules.py`: no**, if protection remains path rules and overrides remain `route_id`-scoped.

### Q12. If applied, which Data Relay files connect?

| Change | Files |
|--------|--------|
| New value patterns | `app/sensitive_detection/pattern_rules.py` |
| FP / leaf allow for new patterns | `app/sensitive_detection/path_rules.py` (`leaf_allows_pattern_pii` today email-only) |
| Hit metadata (pattern name, optional score) | `detection.py` `_sanitize_finding_json` (already has `pattern`) |
| Suggestions labels | `suggestions.py` `_LEAF_LABELS` |
| Tests | `tests/test_sensitive_detection_rules.py` (+ runtime tests if classification uses new classes of hits) |
| **Do not change for this OSS fit** | `app/protection/engine.py`, `route_protection/resolver.py`, governance UI architecture, StreamRunner |

Classification/policy automatically consume new `pii` hits via existing `detect_hits_for_batch` → `SensitiveDetectionContext`. No new pipeline stage.

### Q13. What must not be applied?

- `AnalyzerEngine` / Flask analyzer server / Docker `presidio-analyzer` sidecar  
- spaCy / Stanza / Transformers / GLiNER / LangExtract / Azure AI Language / AHDS  
- `presidio-structured` as JSON DLP (it **is** AnalyzerEngine)  
- `presidio-image-redactor`  
- Replacing `protect_batch` with `AnonymizerEngine`  
- Enabling IP/URL/UUID/DATE/PERSON as default PII  
- Crypto wallet recognizer as “secret” detection  
- Scanning every string on the delivery hot path without caps  
- Stream-duplicating “PII pipelines” per destination  

### Q14. Implementation difficulty and regression risk?

| Item | Difficulty | Regression risk |
|------|------------|-----------------|
| Luhn + CC regex on samples | Low | Medium if not leaf/FP-gated (numeric IDs) |
| SSN invalidation + pattern | Low | Medium (9-digit order IDs) — keep leaf gate or high-precision pattern only |
| Email substring + TLD | Low–med | Medium (must not flag `user@host` in `$.message` without policy) |
| IBAN / KR RRN | Low | Low if opt-in |
| `phonenumbers` dependency | Low | Medium FP in logs; optional |
| Full Presidio | High | **High** — EPS, false positives, architecture |

Stay inside existing confirm-run + operator resolve (`RESOLUTION_FALSE_POSITIVE`) to bound production noise.

### Q15. Introduction priority?

1. **P1** `SOURCE_ADAPTATION` + **P1** `TEST_CORPUS` for CC/SSN/email.  
2. **P2** IBAN / optional KR RRN / `REFERENCE_PATTERN` validate-invalidate.  
3. **LATER** locale packs.  
4. **REJECT** engine, NER, anonymizer service, image, structured runtime.

No P0.

---

## 6. Fit matrix (OSS → Data Relay → Gap → Integration → Method → Risk → Priority)

| Area | Data Relay file/module | Current implementation | OSS | OSS file/module | Gap | Reusable part | Adoption method | License | Architecture risk | Integration difficulty | Expected benefit | Priority | Recommendation |
|------|------------------------|------------------------|-----|-----------------|-----|---------------|-----------------|---------|-------------------|------------------------|------------------|----------|----------------|
| Value patterns | `pattern_rules.py` | PEM + full-string email | Presidio | `email_recognizer.py` | No TLD check; no in-string email | Regex + `validate_result` via tldextract **or** copy TLD logic | `SOURCE_ADAPTATION` | MIT | Low if leaf/FP gated | Low | Fewer missed emails in email-like leaves | **P1** | Adapt; keep `leaf_allows_pattern_pii` |
| Credit cards | `path_rules.py` leaves only | `credit_card` / `card_number` names | Presidio | `credit_card_recognizer.py` | No Luhn on values | Luhn + weak regex | `SOURCE_ADAPTATION` | MIT | Med (numeric FP) | Low | Detect PAN in oddly named fields | **P1** | Adapt behind FP + confirm runs |
| US SSN | Field name `ssn` | No SSA rules | Presidio | `us_ssn_recognizer.py` | Invalid groups still match names only | `invalidate_result` | `SOURCE_ADAPTATION` | MIT | Med | Low | Lower SSN FP when value-scanning | **P1** | Adapt with leaf gate |
| IBAN | None | — | Presidio | `iban_recognizer.py` | No IBAN | Checksum + patterns | `SOURCE_ADAPTATION` | MIT | Low | Med | EU banking events | **P2** | Opt-in pattern |
| Phone values | Leaves `phone`/`mobile` | Partial mask last-4 only | Presidio | `phone_recognizer.py` | No libphonenumber | Matcher + regions | `SOURCE_ADAPTATION` or later `DIRECT_DEPENDENCY` `phonenumbers` | MIT / Apache-2.0 | Med FP | Med | Better phone detection | **P2** | Optional; do not pull Presidio |
| KR RRN | `national_id` name | No checksum | Presidio | `kr_rrn_recognizer.py` | KR format | Regex + checksum | `SOURCE_ADAPTATION` | MIT | Low | Low | KR deployments | **LATER** | Locale pack; default YAML disables it |
| Secrets | `SENSITIVE_FIELD_NAMES` + PEM | Strong | Presidio | `crypto_recognizer.py` | Crypto ≠ API secrets | None | `REJECT` | MIT | High misfit | — | None | **REJECT** | Keep Data Relay secret rules |
| IP/URL/UUID/Date | FP policy blocks uuid | Operational fields | Presidio | `ip_recognizer.py` etc. | Would mark telemetry as PII | None | `REJECT` | MIT | High | — | Negative | **REJECT** | Conflicts with FP1 |
| NER PERSON | None | — | Presidio | `spacy.yaml` + `SpacyRecognizer` | Unstructured names | None | `REJECT` | MIT + model | **Critical** | High | Breaks EPS | **REJECT** | Parallel NLP governance |
| Analyzer engine | `detect_hits_for_batch` | Path walker | Presidio | `analyzer_engine.py` | Different data model | Orchestration ideas only | `REJECT` | MIT | **Critical** | High | None | **REJECT** | No parallel engine |
| Context scores | Boolean hits | — | Presidio | `lemma_context_aware_enhancer.py` | No score | Leaf-as-context (already have) | `REFERENCE_PATTERN` | MIT | Low | Low | Optional confidence in `finding_json` | **P2** | Do not import spaCy lemmas |
| Validate/invalidate | Boolean pattern | — | Presidio | `pattern_recognizer.py` | No checksum hook | Method split | `REFERENCE_PATTERN` | MIT | Low | Low | Cleaner pattern API | **P2** | Mirror in pattern_rules |
| Mask operators | `modes.py` | JSON modes + vault | Presidio | `operators/*.py` | Span vs path | Partial overlap | `REJECT` | MIT | High if replace | — | Duplicate | **REJECT** | Keep Protection Engine |
| Hash operator | HMAC-SHA256 stable | Stream salt | Presidio | `operators/hash.py` | Random salt default | SHA256 | `REJECT` | MIT | Med (breaks correlation) | — | Negative | **REJECT** | Unstable hashes |
| Structured JSON | Path detection | — | Presidio | `analysis_builder.py` | Uses AnalyzerEngine | Column→entity map idea | `REJECT` | MIT | High | High | Duplicate | **REJECT** | Already have JSON walker |
| Image DLP | N/A | — | Presidio | `presidio-image-redactor` | Out of product | — | `REJECT` | MIT | — | — | — | **REJECT** | Out of scope |
| LLM/GLiNER/Azure | N/A | AI Gateway separate | Presidio extras | `langextract_*`, `gliner_recognizer.py` | Cloud/LLM on events | — | `REJECT` | mixed | **Critical** | High | EPS/privacy | **REJECT** | AI Gateway out of this audit |
| Test tables | `test_sensitive_detection_rules.py` | FP + PEM/email | Presidio | `tests/test_*_recognizer.py` | Thin value corpus | Parametrize cases | `TEST_CORPUS` | MIT | Low | Low | Regression tests | **P1** | Rewrite to path/sample API |
| Flask servers | FastAPI app | — | Presidio | analyzer `app.py` | Extra process | — | `REJECT` | MIT | High | — | — | **REJECT** | No sidecar |
| Country YAML packs | None | — | Presidio | `default_recognizers.yaml` `enabled: false` rows | Locale IDs | Patterns | `SOURCE_ADAPTATION` | MIT | Med FP | Med | Regional | **LATER** | Opt-in only |
| Connector harvest | — | — | — | — | — | — | `HARVESTER_SOURCE` | — | — | — | — | N/A | Not a harvester source |

---

## 7. False-positive risk (explicit)

| If we adapt… | FP scenario | Mitigation already in Data Relay |
|--------------|-------------|----------------------------------|
| Luhn on all strings | Long numeric IDs, test PANs | Keep metric/id suffix FP; confirm_runs=2; operator false_positive resolve |
| SSN 9-digit regex | Order IDs, timestamps | Prefer dashed `AAA-GG-SSSS`; use `invalidate_result` rules; require `ssn`-like leaf **or** high score |
| Embedded email | `from: user@host` in log `message` | Do **not** remove `leaf_allows_pattern_pii` without a new policy; AI path already has `_EMBEDDED_EMAIL_RE` in `policy_engine.py` |
| Phone matcher | Numeric codes, IDs | Restrict to phone-like leaves first |
| IBAN | Alphanumeric SKUs | Checksum + `iban`/`account` leaves |
| KR RRN | Birthdate-like 13-digit | Checksum; `ko` locale opt-in (Presidio default **disabled**) |
| UUID/IP recognizers | Every event | **Do not adapt** — FP1 already blocks `uuid` |

Presidio context matching default **substring** is itself an FP source; do not copy that mode onto JSON keys.

---

## 8. Architecture collision checklist

| Proposed OSS use | Collision? |
|------------------|------------|
| AnalyzerEngine as Governance | **Yes** — Parallel Governance Engine |
| Anonymizer as Protection stage | **Yes** — Parallel protection; wrong granularity |
| Per-destination Presidio pipeline | **Yes** — Stream duplication |
| spaCy on StreamRunner batch | **Yes** — Runtime-First + EPS |
| Pattern checksums in `pattern_rules.py` | **No** |
| Tests copied into `tests/test_sensitive_detection_*.py` | **No** |
| Route override still `route_id` filter | Must remain — do not “fix” by cloning streams |

---

## 9. Unconfirmed / out of scope

- Full non-shallow git history and issue tracker (clone is depth 1; HEAD date 2026-08-26 is sufficient for “maintained”).
- Exact `en_core_web_lg` on-disk size on Data Relay hosts (not downloaded).
- Whether product charter requires KR/US national ID **value** detection (not assumed).
- AI Gateway inspection (`app/ai_gateway/inspection.py` already calls `detect_hits_for_batch`) — AI Gateway is out of this OSS program’s scope; do not expand it via Presidio LLM recognizers.
- File-by-file license of **spaCy models** (not in the Presidio tree).

---

## 10. Recommended implementation order (audit only — do not implement here)

1. Add MIT-attributed Luhn + CC / SSN invalidation / email tests from Presidio tables into Data Relay tests, then implement matching `pattern_rules` behind existing FP + confirm gates.  
2. Optionally IBAN; optionally KR RRN as a locale flag.  
3. Stop. Do not add Presidio packages, NER, or anonymizer.

---

## 11. Short summary for Integration Planner (Agent 9)

Presidio is a **MIT** PII **recognizer and test** goldmine, not a governance runtime. Data Relay already owns detection persistence, protection modes, route overrides, classification, and policy. Adopt **checksums and corpora** into `app/sensitive_detection/pattern_rules.py`. **Reject** `AnalyzerEngine`, spaCy, anonymizer replacement, structured/image/LLM extras. Priority **P1** adaptation + tests; **no P0**; **no DIRECT_DEPENDENCY** of Presidio.
