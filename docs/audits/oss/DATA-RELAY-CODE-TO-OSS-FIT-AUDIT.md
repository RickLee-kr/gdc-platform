# Data Relay Code-to-OSS Fit Audit

**Product:** Data Relay (`gdc-platform`)  
**Correct baseline:** `origin/feature/post-m29-development`  
**Audit HEAD:** `99dd3bac886760460201f54deaaa282ec0e98bc1`  
**Independent re-verification:** 2026-08-29 (functions + tests, not file existence)  
**Implementation closed:** 2026-08-29 on descendant `oss-fit/integration-wave2`

```text
OSS_FIT_SCHEDULED_IMPLEMENTATION_COMPLETE=YES
WAVE_1=PASS
WAVE_2=PASS
```

Phone detection is an intentional defer (`DEFERRED_FALSE_POSITIVE_RISK`), not a failed work item.  
W9 / W11 / W12 / W13 / W14 are **not** OSS Fit completion blockers.

Final work-item statuses and SHAs: [DATA-RELAY-OSS-IMPLEMENTATION-WORKPLAN.md](./DATA-RELAY-OSS-IMPLEMENTATION-WORKPLAN.md).

The body below is the pre-implementation audit against `99dd3ba`. Current Status / Remaining Gap columns in the matrix describe that baseline, not the closed tree.

---

## Audit identity (planning pass)

**Worktree (planning):** `/home/aella/gdc-oss-reconcile`  
**Worktree branch:** `audit/code-to-oss-fit-reconcile`  
**Mode (planning pass):** Planning only. Product code, Full Matrix, QA Lab, and production config were not modified during the audit.

Recorded identity (must match this file):

```text
$ git rev-parse --abbrev-ref HEAD
audit/code-to-oss-fit-reconcile
$ git rev-parse HEAD
99dd3bac886760460201f54deaaa282ec0e98bc1
$ git rev-parse origin/feature/post-m29-development
99dd3bac886760460201f54deaaa282ec0e98bc1
```

This document supersedes the 2026-08-28 Integration Planner that was written against **wrong workspace HEAD** `1f270e8460de73c60b761d3879f66038b6df1fe7`. OSS clone research in `01`–`08` is reused. **Implementation status** is re-judged against `99dd3ba`.

Canonical authority: `docs/canonical/00-DOCUMENTATION-GOVERNANCE.md` — Product Charter → architecture docs → specs → **code/tests** → historical audits. Code beats lagging canonical **status tables**. See [09-correct-branch-delta-audit.md](./09-correct-branch-delta-audit.md).

Workplan: [DATA-RELAY-OSS-IMPLEMENTATION-WORKPLAN.md](./DATA-RELAY-OSS-IMPLEMENTATION-WORKPLAN.md).

---

## Identity (must match this file)

```text
BRANCH=audit/code-to-oss-fit-reconcile
HEAD=99dd3bac886760460201f54deaaa282ec0e98bc1
MERGE_BASE=6f280262dff393a967ebe7deca4712580d97e68b
OLD_AUDIT_HEAD=1f270e8460de73c60b761d3879f66038b6df1fe7
DELTA=41 commits (feature/post-m29-development ahead)
```

---

## Guardrails (still true)

```text
One Stream → Many Routes → Many Destinations
Route Processing: Transform → Protection → Classification → Policy → Delivery
```

Do **not** add: parallel connector/auth/delivery/retry/checkpoint/governance engines; new Transform DSL; OSS collector **runtimes**. Checkpoint remains after successful destination ACK, not after harvest/extract. Operational Snapshot remains metrics SoT. AI Gateway out of scope.

**Updated (was stale):** this HEAD **does** have Connectors Marketplace APIs/UI, harvester, pack secret scan, Ed25519 **verify**, Git HTTPS `.tar.gz` acquire (no `git clone`), durable `PERSISTENT_QUEUE` **inside** StreamRunner for webhook/SYSLOG_TCP, circuit breaker, and `SourceRateLimiter`. Those are Data Relay modules, not OTel/Vector.

---

## Stale conclusions from the 1f270e8 audit

| Old claim | Correct-branch evidence |
| --- | --- |
| No marketplace | `marketplace_*` routers, lifecycle, UI, installs, trusted keys |
| No Connector Harvester | `HarvesterService.harvest_and_import`; adapters singer/meltano/otel/fluent_bit/telegraf |
| Zip/Git ingest REJECT as missing | Local tar.gz lifecycle + `git_acquisition.py` HTTPS archive via `secure_fetch` |
| Pack signing LATER | `package_signature.py` `Ed25519PublicKey.verify` |
| Webhook retries all 4xx; no Retry-After | `ResponseClassifier` + `WebhookSender.send` |
| `SourceRateLimiter` stub | Token bucket `allow()` before fetch |
| No jitter helper | `RetryPolicy.apply_jitter` (default ratio 0) |
| Durable queue = parallel engine | Canonical queue **inside** StreamRunner — still REJECT OSS exporters |
| `completeness.py` install gate | File **absent** on this HEAD (was dirty workspace on old audit) |
| Detect-secrets needed for SMP-002 | `package_secret_scan.py` for marketplace packs |

---

## CONFLICT register (reconcile)

### C10 — TanStack Virtual (Agent D vs Agent F)

| Side | Claim |
| --- | --- |
| Agent D (03) | W3 **DELETE_FROM_WORKPLAN**. Tree not virtualized; `MAX_PATHS=500`; in-repo windowers; do not add `@tanstack/react-virtual`. |
| Agent F (02, first draft) | Virtual **PARTIAL**; keep W3 for unbounded trees/connector lists. |

**Final (re-verified):** **DELETE** original W3 (`DIRECT_DEPENDENCY` TanStack Virtual). Ops lists already use in-repo windowers (`computeWindowedRange` / `computeFixedRowVirtualRange`). `union-schema-tree.tsx` is recursive React with no `useVirtualizer`; inventory is capped at `MAX_PATHS = 500`. Dual windowing is the larger regression risk. Agent F 02 reconcile is **updated to match this Final**. Do **not** invent a new P1 “window the schema tree with in-repo helpers” (no new work IDs). If expand-all jank is later **measured**, reuse `computeWindowedRange` — DEFER, not scheduled.

### C2 — P0 Dialog vs webhook retry

**Final (updated):** W2 is **ALREADY_DONE**. Sole remaining P0 from this program is **W1** Dialog/Sheet.

### C9 — Marketplace vs Harvester

**Final (updated):** Marketplace **exists**. Harvester **exists** (static). Remaining: dlt adapter + Meltano REST depth (W7 MODIFY), filesystem sample policy (W6 MODIFY). Git acquire is HTTPS archive, not clone — does not violate One Stream / no parallel runtime.

Other conflicts C3–C8 from the 2026-08-28 planner stand (Kumo REJECT despite MIT; AGPL taps DO_NOT_USE; Connect DO_NOT_USE; Presidio engine REJECT; dagre stewardship if W13 ever proceeds).

---

## Work item matrix

| Work Item | Old Audit Conclusion | Correct Branch Evidence | Current Status | Remaining Gap | OSS Role | Final Action |
| --- | --- | --- | --- | --- | --- | --- |
| W1 Dialog/Sheet | P0 add `@base-ui/react` | `frontend/package.json` no Base UI; `components/ui` still card/tooltip/split; no focus trap | STILL_MISSING | Overlay a11y | DIRECT_DEPENDENCY | **KEEP** P0 |
| W2 4xx / Retry-After | P0 IMPROVE `WebhookSender` | `WebhookSender.send` + `ResponseClassifier`; tests `test_http_resilience.py`, `test_http_resilience_callers.py` | ALREADY_IMPLEMENTED | None | NO_LONGER_NEEDED | **ALREADY_DONE** |
| W3 TanStack Virtual | P1 dep on union-schema-tree | Tree still recursive; ops lists already windowed; no TanStack in package.json | STILL_MISSING tree window; **OSS dep not required** | Optional in-repo window if measured | REJECT dep | **DELETE** |
| W4 Presidio patterns | P1 SOURCE_ADAPTATION | `pattern_rules.py` still `pem_pattern_match` / `email_pattern_match` / `evaluate_pattern_rules` only | STILL_MISSING value checksums | Luhn/SSN/email harden | SOURCE_ADAPTATION | **KEEP** P1 |
| W5 JSONata JS corpus | P1 TEST_CORPUS | No JS suite; `test_full_event_mapping.py` + `G-TF-JSONATA-*` | NO_LONGER_NEEDED as product gap | Upstream port QA only | NO_LONGER_NEEDED | **DELETE** |
| W6 SMP-002 in validator | P1 apply secrets.py to samples | Marketplace: `package_secret_scan.assert_package_secrets_clean`. Filesystem `validator.py` not that scanner | PARTIALLY_IMPLEMENTED | Builtin `connectors/` samples | REFERENCE_ONLY (reuse scanner) | **MODIFY** P2 |
| W7 Meltano+dlt Harvester | P1 new offline tool | `HarvesterService` + singer/meltano/otel/fluent_bit/telegraf. **No dlt.** Meltano = alias of static Singer files, not REST AST | PARTIALLY_IMPLEMENTED | dlt adapter; REST class-attr depth | HARVESTER_REFERENCE | **MODIFY** P1 |
| W8 Button/Input/Menu/Tooltip | P1 after W1 | `gdcUi` tokens + `HelpTooltip`; no shared primitives; CVA unused | PARTIALLY_IMPLEMENTED | Shared kit | SOURCE_ADAPTATION | **KEEP** P1 |
| W9 Jitter | P1 add jitter | `RetryPolicy.apply_jitter`; production `jitter_ratio=0` | PARTIALLY_IMPLEMENTED | Opt-in on callers | REFERENCE_ONLY | **DEFER** |
| W10 SourceRateLimiter | P1 implement stub | `SourceRateLimiter.allow` + `StreamRunner.run`; `test_source_rate_limiter.py` | ALREADY_IMPLEMENTED | None | NO_LONGER_NEEDED | **ALREADY_DONE** |
| W11 Route retry persist | P1 columns on routes | Loop + `_get(route, "retry_count", 2)`; `Route` model has **no** those columns | PARTIALLY_IMPLEMENTED (loop only) | ORM/API persist | NO_LONGER_NEEDED as OSS | **DEFER** |
| W12 TanStack Table | P2 | Custom snapshot tables | Optional polish | — | DEFER | **DEFER** |
| W13 xyflow+dagre | P2 | Topology API + `RoutesFlowTreeTable`; `/runtime/topology` redirect; no xyflow | Optional canvas | Must not become SoT | DEFER | **DEFER** |
| W14 Telegraf/Camel/OTel hints | P2 harvest | OTel static mapper **yes**; Telegraf/Fluent **fixture skeleton**; no Camel | PARTIAL | Native parsers | HARVESTER_REFERENCE | **DEFER** |
| W15 IBAN/phone | P2 after W4 | No IBAN/phone value matchers | STILL_MISSING | After W4 | SOURCE_ADAPTATION | **KEEP** P2 |

---

## OSS matrix (this HEAD)

| OSS | Exact Data Relay Target | Existing Capability | Missing Capability | Adoption | Final Priority |
| --- | --- | --- | --- | --- | --- |
| `@base-ui/react` | `components/ui/dialog.tsx` + overlays | Native `fixed inset-0` dialogs | Focus trap / Escape / portal | DIRECT_DEPENDENCY | **P0** |
| `@base-ui/react` button/menu/tooltip | `gdcUi` + `HelpTooltip` | Tokens, CSS tooltip | Shared primitives | SOURCE_ADAPTATION | **P1** |
| `@cloudflare/kumo` | Tailwind 3.4 GDC tokens | Own design system | — | REJECT | REJECT |
| radix / vaul / default shadcn | — | — | — | REJECT | REJECT |
| `@tanstack/react-virtual` | `union-schema-tree.tsx` | In-repo list windowers | Tree window (optional) | REJECT | DELETE |
| `@tanstack/react-table` | Destinations/catalog lists | Custom tables | Headless polish | REFERENCE_ONLY | DEFER |
| `@xyflow/react` + dagre | Topology view | Snapshot + topology JSON + HTML flow | Interactive canvas | REFERENCE_ONLY | DEFER |
| Archify | — | — | — | REJECT | REJECT |
| monaco-editor | JSONata textarea | Backend preview | Highlighting | REJECT | REJECT |
| GenSON | `unionSchema.ts` `buildUnionSchema` | Frequency/rare/sensitive | — | REJECT | REJECT |
| jsonata-js runtime | `apply_full_event_jsonata_mapping` | jsonata-python | Dual engine | REJECT | REJECT |
| jsonata-js test-suite | `tests/test_full_event_mapping.py` | Product + E2E goldens | Full JS conformance | NO_LONGER_NEEDED | DELETE |
| meltano/sdk / Singer files | `harvester/sources/singer.py` | Static catalog/schema harvest | REST class AST | HARVESTER_REFERENCE | P1 depth |
| dlt RESTAPIConfig | harvester registry | **No adapter** | dlt source | HARVESTER_REFERENCE | **P1** |
| Telegraf / Fluent Bit | harvester adapters | Fixture skeleton | sample.conf / config_map | HARVESTER_REFERENCE | DEFER |
| OTel metadata.yaml | `harvester/sources/otel.py` | Static HTTP-poll map | Go runtime (must not add) | HARVESTER_REFERENCE | KEEP existing |
| Camel catalog | — | — | Metadata hints | REFERENCE_ONLY | DEFER |
| OSS collectors as runtime | StreamRunner | Own queue/retry/checkpoint | — | REJECT | REJECT |
| openapi-spec-validator | `package_validator.py` | Pydantic manifest + URL/license | Draft OpenAPI validate | REFERENCE_ONLY | LATER |
| jsonschema | builder heuristic OpenAPI | Hand-written parse | Draft instance validate | REFERENCE_ONLY | LATER |
| detect-secrets | `package_secret_scan.py` | Literal/PEM scan | Broader entropy plugins | NO_LONGER_NEEDED | DELETE |
| cryptography Ed25519 | `package_signature.py` | **Verify** + trusted keys | Platform **sign** API (by design) | NO_LONGER_NEEDED | — |
| Presidio recognizers | `pattern_rules.py` | PEM+email | Luhn/SSN/IBAN | SOURCE_ADAPTATION | **P1**/P2 |
| Presidio AnalyzerEngine | `protection/engine.py` | Path mask/hash/tokenize | — | REJECT | REJECT |
| Vector / Connect / OTel retry code | `app/http/resilience/` | Classifier + Retry-After + optional jitter | jitter opt-in | REFERENCE_ONLY | DEFER W9 |

License grades in [08-license-maintenance-audit.md](./08-license-maintenance-audit.md) still apply (Airbyte/Connect/AGPL taps DO_NOT_USE).

---

## Implementation order (remaining only)

1. **P0** W1 Dialog/Sheet  
2. **P1 parallel:** W4 patterns ‖ W7 dlt/Meltano depth  
3. **P1** W8 after W1  
4. **P2** W6 filesystem sample policy; W15 after W4  
5. **Do not schedule:** W2, W3, W5, W9, W10, W11, W12, W13, W14, Wave 0

---

## Unverified residual

1. Canonical `TARGET` labels for marketplace M29.8+ lag code — use code as implementation truth ([09](./09-correct-branch-delta-audit.md)).  
2. W9 enabling jitter in production is a behavior choice (thundering herd vs deterministic tests).  
3. W11 persist only if operators must tune per-route retry in UI.  
4. License 08 was not re-cloned in this reconcile; SPDX grades unchanged.
