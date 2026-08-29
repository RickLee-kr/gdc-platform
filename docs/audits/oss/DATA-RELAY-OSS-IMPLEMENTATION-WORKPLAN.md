# Data Relay OSS Implementation Workplan

**Companion to:** [DATA-RELAY-CODE-TO-OSS-FIT-AUDIT.md](./DATA-RELAY-CODE-TO-OSS-FIT-AUDIT.md)  
**Authority HEAD (audit baseline):** `99dd3bac886760460201f54deaaa282ec0e98bc1` (`origin/feature/post-m29-development`)  
**Independent re-verification:** 2026-08-29  
**Implementation closed:** 2026-08-29

```text
OSS_FIT_SCHEDULED_IMPLEMENTATION_COMPLETE=YES
WAVE_1=PASS
WAVE_2=PASS
```

Phone detection is an intentional defer (`DEFERRED_FALSE_POSITIVE_RISK`), not a failed work item.  
W9 / W11 / W12 / W13 / W14 are **not** OSS Fit completion blockers.

Do not modify Full Matrix, QA Lab, production config, or `app/dev_validation_lab/**` as part of OSS Fit.

---

## Closure status (2026-08-29)

SHAs below are commits **reachable from** `oss-fit/integration-wave2` (`118088427ca725842fd5078405ddb3ec4601c32a`). Feature-branch SHAs that were rewritten at Wave 1 merge (for example `7c910f9`, `7279848`, `21b08aa`) are **not** recorded here.

| Work | Final | Commit on integration history |
| --- | --- | --- |
| W1 Dialog/Sheet | COMPLETE | `300e0f0` wrap + `e9b7359` remaining overlays |
| W2 HTTP 4xx / Retry-After | ALREADY_IMPLEMENTED | (pre-existing on `99dd3ba`) |
| W3 TanStack Virtual | DELETE / NOT_REQUIRED | — |
| W4 Luhn / SSN / email | COMPLETE | `1ebb2d7` |
| W5 JSONata JS corpus | DELETE / NOT_REQUIRED | — |
| W6 Builtin sample secret-name policy | COMPLETE | `908e38c` |
| W7 dlt / Meltano harvester depth | COMPLETE | `a72a3f6` |
| W8 Button / Input / Dropdown | COMPLETE | `3a1c5a0` |
| W9 Jitter activation | DEFERRED_PRODUCT_DECISION | — |
| W10 Source rate limiter | ALREADY_IMPLEMENTED | (pre-existing on `99dd3ba`) |
| W11 Retry persistence | DEFERRED_PRODUCT_DECISION | — |
| W12 TanStack Table | DEFERRED_PRODUCT_DECISION | — |
| W13 xyflow / dagre canvas | DEFERRED_PRODUCT_DECISION | — |
| W14 Telegraf / Fluent Bit native parsers | DEFERRED_PRODUCT_DECISION | — |
| W15 IBAN | COMPLETE | `a51c078` |
| W15 Phone | DEFERRED_FALSE_POSITIVE_RISK | (no detector added) |

| Integration | SHA | Notes |
| --- | --- | --- |
| Wave 1 environment / WireMock host port | `e0e6157` | Default WireMock host port **28080** (not 18080) |
| Wave 2 integration | `1180884` | Merge W6 → W15 → W8 |
| Audit documentation closure | `0a2349b` | Final statuses + SHAs on this branch |

---

## Original planning record

The remainder of this file is the 2026-08-29 planning workplan (kept for evidence). Remaining-work language below is historical; **closure status above is authoritative**.

```text
$ git rev-parse --abbrev-ref HEAD
audit/code-to-oss-fit-reconcile
$ git rev-parse HEAD
99dd3bac886760460201f54deaaa282ec0e98bc1
```

This workplan **replaces** the 2026-08-28 W1–W15 schedule. Items proven **ALREADY_DONE** or **DELETE** are not remaining work. W2 / W9 / W10 / W11 were **not** kept as open work until proven: W2 and W10 are proven implemented; W9 helper exists with production `jitter_ratio=0`; W11 persist is optional UX.

## Proof for W2 / W6 / W7 / W9 / W10 / W11 (do not keep as unproven work)

| ID | Proof on `99dd3ba` | Action |
| --- | --- | --- |
| **W2** | `app/http/resilience/classifier.py` `ResponseClassifier.classify_response`: 2xx SUCCESS, 429 RATE_LIMIT + `parse_retry_after_header`, 408/5xx RETRY, other 4xx FATAL. `app/delivery/webhook_sender.py` `WebhookSender.send` uses `_CLASSIFIER` + `RetryPolicy`. Tests: `test_classify_response_status_matrix`, `test_webhook_4xx_fatal_no_retry`, `test_webhook_429_uses_retry_after`. | **ALREADY_DONE** |
| **W6** | Marketplace: `package_secret_scan.assert_package_secrets_clean` from `lifecycle_archive.resolve_and_validate_staged_package`, harvester, builder. Filesystem: `validator.py` has MAN/STR/MAP/ENR/API/docs only — **no** `scan_package_secrets`, **no** SMP-002. `detect-secrets` not in requirements. | **MODIFY** P2 (builtin samples only) |
| **W7** | `build_default_harvester_registry` registers singer, meltano, otel, fluent_bit, telegraf. `MeltanoHarvesterAdapter(SingerHarvesterAdapter)` alias. Telegraf/Fluent Bit return UNSUPPORTED without `harvester.yaml`. **No** `dlt` adapter. Tests: `test_singer_static_snapshot_harvest`, `test_fluent_bit_and_telegraf_fixture_backed`. | **MODIFY** P1 (dlt + Meltano REST depth) |
| **W9** | `RetryPolicy.apply_jitter` / `delay_seconds` exist. Dataclass default `jitter_ratio: float = 0.0`. `WebhookSender.send` constructs `RetryPolicy(max_attempts=..., initial_backoff_seconds=...)` — no opt-in. Test `test_retry_policy_jitter_is_bounded` uses `jitter_ratio=1.0`. | **DEFER** (behavior choice, not missing module) |
| **W10** | `SourceRateLimiter.allow` token bucket; empty config allows. `StreamRunner.run` calls `self.source_limiter.allow(stream_id, source_rate_limit_json)` before fetch. Tests: `test_allows_requests_under_limit`, `test_blocks_when_limit_exceeded`, `test_http_poller_skipped_when_source_rate_limited`. Canonical 03: Source Rate Limiter `IMPLEMENTED`. | **ALREADY_DONE** |
| **W11** | Runtime loop: `stream_loader.py` copies `_get(route, "retry_count", 2)` / `backoff_seconds`; `StreamRunner._apply_failure_policy` RETRY_AND_BACKOFF. Persist: `app/routes/models.py` `Route` has `failure_policy` only; `app/routes/schemas.py` has no retry columns. | **DEFER** (optional operator UX, not OSS) |

## W1–W15 action summary

| ID | Final Action | Remaining? |
| --- | --- | --- |
| W1 | **KEEP** P0 | Yes |
| W2 | **ALREADY_DONE** | No |
| W3 | **DELETE** | No |
| W4 | **KEEP** P1 | Yes |
| W5 | **DELETE** | No |
| W6 | **MODIFY** P2 | Yes (narrow) |
| W7 | **MODIFY** P1 | Yes (narrow) |
| W8 | **KEEP** P1 | Yes |
| W9 | **DEFER** | No schedule |
| W10 | **ALREADY_DONE** | No |
| W11 | **DEFER** | No schedule |
| W12 | **DEFER** | No schedule |
| W13 | **DEFER** | No schedule |
| W14 | **DEFER** | No schedule |
| W15 | **KEEP** P2 | Yes (after W4) |

---

## Wave 0 — do not schedule

| Item | Why |
| --- | --- |
| OSS collector/tap **runtimes** | Parallel engine |
| Kumo / Tailwind 4 / Radix / vaul / ECharts | CSS/IA |
| Presidio AnalyzerEngine / spaCy | Parallel governance |
| Monaco, GenSON-as-schema, rc-tree, jsonata-js runtime | Dual engine/schema |
| `@tanstack/react-virtual` (old W3) | Dual windowing; C10 |
| jsonata-js test-suite (old W5) | Product tests suffice |
| detect-secrets | `package_secret_scan` exists |
| Re-implement W2 / W10 | Already wired + tested |
| Airbyte / AGPL singer-io taps / Redpanda Connect | DO_NOT_USE |

Marketplace local tar.gz, Git HTTPS archive, and AI builder **UI** already exist on this HEAD. Do not treat “no marketplace” as a gap. Do not add `git clone`.

---

## Remaining work (file/function)

### W1 — KEEP — Base UI Dialog + Sheet (P0)

| Field | Value |
| --- | --- |
| **Goal** | Shared overlay with focus trap, Escape, portal; GDC Tailwind 3.4. |
| **Files** | Add `frontend/src/components/ui/dialog.tsx`, `sheet.tsx`. Migrate wizard/policy/destination/admin overlays **and** this-HEAD `marketplace-upload-dialog.tsx`, `marketplace-package-detail.tsx`, `marketplace-ai-builder.tsx`. Do not replace `layout/sidebar.tsx` or KPI widgets. |
| **New dependency** | `@base-ui/react` `1.7.x` |
| **Conflicts** | W8 after W1. Parallel OK with W4/W7. |
| **Prerequisites** | None. Stay on Tailwind 3.4. |
| **Verification** | Vitest for migrated overlays; `npm run build`; Escape + focus trap; keep `data-testid`. |

### W8 — KEEP — Button / Input / Menu / Tooltip (P1)

| Field | Value |
| --- | --- |
| **Goal** | CVA + existing `gdcUi` tokens; Base UI menu; overflow-safe tooltip; keep `HELP_COPY`. Token strings already exist — wrap them, do not invent a second palette. |
| **Files** | Add `frontend/src/components/ui/button.tsx`, `input.tsx`, `dropdown-menu.tsx`; adapt `help-tooltip.tsx`. Gradual call sites. |
| **New dependency** | Same `@base-ui/react` as W1. |
| **Conflicts** | After W1. |
| **Prerequisites** | W1 landed. |
| **Verification** | Primitive unit tests; `npm run build`. |

### W4 — KEEP — Presidio checksums into `pattern_rules` (P1)

| Field | Value |
| --- | --- |
| **Goal** | Luhn PAN, SSN invalidation, stronger email. Keep FP policy + confirm-gated findings. |
| **Files** | `app/sensitive_detection/pattern_rules.py`; `tests/test_sensitive_detection_rules.py`. Do not replace `protection/engine.py`. |
| **New dependency** | None. **REJECT** `presidio-analyzer`. |
| **Conflicts** | W15 after W4. Parallel with W1. |
| **Prerequisites** | Port algorithms only. |
| **Verification** | Sensitive-detection unit tests. No EPS/NER. |

### W7 — MODIFY — Harvester depth, not a new tool (P1)

| Field | Value |
| --- | --- |
| **Goal** | Add **dlt** `RESTAPIConfig` adapter (same `HarvesterSourceAdapter` contract: no execution). Deepen Meltano/Singer **static** REST evidence (`path`/`http_method` from class attrs or checked-in schema — still no tap run). |
| **Files** | `app/connectors_registry/harvester/registry.py` `build_default_harvester_registry`; new `harvester/sources/dlt.py`; extend `harvester/sources/singer.py`. Tests: `tests/test_marketplace_connector_harvester.py`. |
| **New dependency** | None in API process. Do not vendor dlt/Meltano runners. |
| **Conflicts** | W6 if both touch pack write; serialize around `package_builder.py` / secret scan. |
| **Prerequisites** | Keep license gate + `assert_package_secrets_clean`. Skip AGPL `singer-io/tap-*`. Incremental cursor → fetch watermark only. |
| **Verification** | Fixture harvest → draft pack; `package_generated` only when REST mapped; no StreamRunner changes. |

### W6 — MODIFY — Filesystem module sample policy (P2)

| Field | Value |
| --- | --- |
| **Goal** | Apply secret-**name** policy to builtin `connectors/` samples in `validator.py` (SMP-002 style). Marketplace packs **already** run `package_secret_scan`. Do not add detect-secrets. |
| **Files** | `app/connectors_registry/validator.py`; reuse `package_secret_scan` helpers or `app/security/secrets.py`. |
| **New dependency** | None. |
| **Conflicts** | W7 pack fixtures. |
| **Prerequisites** | Do not fail marketplace installs that already passed `assert_package_secrets_clean`. |
| **Verification** | Builtin modules still load; literal secrets in samples blocked; placeholders allowed if matching existing scanner policy. |

### W15 — KEEP — IBAN / optional phone (P2)

| Field | Value |
| --- | --- |
| **Goal** | After W4, optional IBAN checksum; phone only if product wants value detection. |
| **Files** | `pattern_rules.py` + FP policy + tests. |
| **New dependency** | Optional `phonenumbers`. Still REJECT Presidio runtime. |
| **Conflicts** | After W4. |
| **Verification** | Rule tests; do not weaken `id`/`user` FP policy. |

---

## Removed from remaining work (evidence)

### W2 — ALREADY_DONE

`app/delivery/webhook_sender.py` `WebhookSender.send` → `ResponseClassifier` / `RetryPolicy`. 4xx FATAL; 429 Retry-After. Tests: `tests/test_http_resilience.py`, `tests/test_http_resilience_callers.py`. Also `HttpPoller.fetch`, `delivery_queue/outcome.py`.

### W10 — ALREADY_DONE

`app/rate_limit/source_limiter.py` `SourceRateLimiter.allow`; `StreamRunner.run` before fetch. Tests: `tests/test_source_rate_limiter.py`.

### W3 — DELETE

Do not add `@tanstack/react-virtual`. Keep in-repo windowers (`windowed-virtual-range.ts`, `use-virtual-window.ts`, `fixed-row-virtual-window.ts`).

### W5 — DELETE

Do not vendor jsonata-js `test-suite`. Keep `tests/test_full_event_mapping.py` + E2E goldens `G-TF-JSONATA-SINGLE|NESTED|ARRAY`.

---

## Deferred (capability exists or optional product)

| ID | Why deferred |
| --- | --- |
| **W9** | `RetryPolicy.apply_jitter` exists; `jitter_ratio=0` on production callers by design. Opt-in is a behavior change, not a missing module. |
| **W11** | Retry **loop** exists (`stream_loader.py` defaults). Persist columns on `Route` are optional operator UX. |
| **W12** | Custom snapshot tables sufficient. |
| **W13** | Topology API + HTML flow; canvas not required by canonical 07. Graph must not become metrics SoT. |
| **W14** | Telegraf/Fluent Bit adapters are fixture skeletons; OTel static mapper exists. Native parsers later. |

---

## Parallel vs serial

**Parallel OK**

- W1 (frontend) ‖ W4 (backend patterns) ‖ W7 (harvester)

**Serial**

- W1 → W8
- W4 → W15
- W7 then W6 if both touch pack validation fixtures

**Do not** edit `webhook_sender.py` / StreamRunner delivery for remaining OSS-fit items (W2/W10 closed).

---

## Verification baseline

Frontend remaining items: `cd frontend && npm run build` + focused Vitest.  
W4/W15: `tests/test_sensitive_detection_rules.py`.  
W7: `tests/test_marketplace_connector_harvester.py`.  
Do not change lab EPS tests unless limiter work returns (it should not).
