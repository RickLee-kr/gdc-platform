# Agent 3 — Union Schema / Transform UI Audit

> **Closure (2026-08-29):** Scheduled OSS Fit implementation is complete. W3 and W5 remain DELETE / NOT_REQUIRED. This file remains the pre-implementation audit record. See [DATA-RELAY-OSS-IMPLEMENTATION-WORKPLAN.md](./DATA-RELAY-OSS-IMPLEMENTATION-WORKPLAN.md).

## Correct-branch reconciliation

**Codebase:** `/home/aella/gdc-oss-reconcile`  
**Branch:** `audit/code-to-oss-fit-reconcile`  
**HEAD:** `99dd3bac886760460201f54deaaa282ec0e98bc1` (`99dd3ba feat(operations): implement P0 test before apply impact preview`)  
**Date:** 2026-08-29  
**Independent re-verification:** 2026-08-29 — `union-schema-tree.tsx` still recursive (`SchemaTreeNode`); `MAX_PATHS = 500` in `unionSchema.ts`; no `@tanstack/react-virtual` / `jsonata` / `monaco-editor` in `frontend/package.json`.  
**Mode:** Read-only product code. This section supersedes W3 / W5 in `DATA-RELAY-OSS-IMPLEMENTATION-WORKPLAN.md` for this HEAD. Historical sections §1–§13 below were written against `/home/aella/gdc-platform` `feature/post-m29-development` (2026-08-28) and remain as OSS Q&A; they must not be read as a live workplan.  
**Constraint:** **No new DSL.** Do not recommend jq, JMESPath, VRL, Bloblang, or a second JSONata engine.

### Workplan classification

| ID | Old workplan item | Classification | Why |
| --- | --- | --- | --- |
| **W3** | Flatten + `@tanstack/react-virtual` on `union-schema-tree.tsx` | **DELETE_FROM_WORKPLAN** | Tree is still a custom recursive React tree (not virtualized). Product already has in-repo windowers. Adding TanStack would dual-implement windowing and is not required for a `MAX_PATHS = 500` inventory. |
| **W5** | Vendor jsonata-js `test/test-suite` as TEST_CORPUS for jsonata-python | **DELETE_FROM_WORKPLAN** | There is **no** JS conformance corpus on this branch. Product already covers the Data Relay contract (`apply_full_event_jsonata_mapping` must return a dict) via `tests/test_full_event_mapping.py` plus E2E goldens `G-TF-JSONATA-SINGLE` / `NESTED` / `ARRAY`. Importing JS 2.2.2 cases against python 0.6 is upstream port QA, not a product gap. |

Neither item is `ALREADY_IMPLEMENTED` or `PARTIAL`: W3’s TanStack dep was never added; W5’s JS suite was never vendored. Both are **deleted from the workplan**, not deferred as P1.

### Decision: keep custom windowing — do not add TanStack Virtual

**Keep** `frontend/src/lib/windowed-virtual-range.ts` (`computeWindowedRange`), `frontend/src/hooks/use-virtual-window.ts` (`useVirtualWindow`), `frontend/src/lib/fixed-row-virtual-window.ts` (`computeFixedRowVirtualRange`), and the prefix-sum window in `frontend/src/components/runtime/virtualized-stream-grid.tsx`. **Do not** add `@tanstack/react-virtual`.

Evidence:

1. **`union-schema-tree.tsx` is not virtualized.** `buildSchemaTree` nests `SchemaTreeNode`s; `SchemaTreeNodeRow` is recursive with per-node `useState` expand, `aria-expanded` buttons, rare/sensitive badges, and up to 5 sample rows. `UnionSchemaTree` maps `roots` directly into the DOM (`data-testid="union-schema-tree"`). No flatten-of-expanded-keys, no `useVirtualizer`, no `computeWindowedRange`. Default `expandStrategy` is `'smart'` (expand `depth < 2`), not expand-all.
2. **`frontend/package.json` has no `@tanstack/react-virtual`, `rc-tree`, `monaco-editor`, or `jsonata`.** Dependencies are CVA, clsx, lucide, React 19, react-router, recharts, tailwind-merge.
3. **Custom windowing is the product pattern and is already live.** Comment on `windowed-virtual-range.ts`: “Fixed-size windowed range … (no external virtualization library).” Consumers: `useVirtualWindow` → `routes-overview-page.tsx`; `computeFixedRowVirtualRange` → `streams-console.tsx`; prefix-sum mixed header/card heights → `virtualized-stream-grid.tsx` (`STREAM_CARD_ROW_HEIGHT` / `GROUP_HEADER_ROW_HEIGHT`). Phase 6.5 history (`docs/history/performance/runtime-ui-virtualization-phase-6_5.md`) records that `@tanstack/react-virtual` was **not** added; in-repo windowing was the chosen implementation.
4. **TanStack’s only extra vs in-repo helpers is `measureElement` for unknown variable height.** The Union Schema tree’s height variation is nested sample `<ul>`s (max 5), not an unbounded list. Inventory is capped at `MAX_PATHS = 500` / `MAX_DEPTH = 12` in `unionSchema.ts`. If expand-all jank is later *measured*, the adapter is flatten expanded keys then reuse `computeWindowedRange` or the grid prefix-sum pattern — **SOURCE_ADAPTATION of existing helpers**, not a new npm dependency. That optional UX tweak is **not** a workplan P1 and is **not** W3 as written.
5. **rc-tree stays REJECT.** Product chrome (rare / sensitive / generated / frequency) would be dropped; rc-tree virtual path is fixed `itemHeight`.

### Other schema trees (same conclusion)

| Component | Role | Virtualized? |
| --- | --- | --- |
| `union-schema-tree.tsx` | Stream-scope Union Schema field picker | No — recursive React |
| `union-schema-tree-detail-layout.tsx` | Tree + `union-field-detail-panel` split | Layout only |
| `mapping-json-tree.tsx` | Single-event JSON fallback (`JsonTreeNodes` recursive `useState`) | No |
| `routes-flow-tree-table.tsx` | Operational snapshot stream→route groups | Not a schema tree; not windowed (group count is snapshot-sized) |
| `_archive/legacy-spa/components/JsonTree.tsx` | Archived | Ignore |

Wizard consumers (`wizard-full-event-transform-workspace.tsx` `SourceSchemaPanel`, `wizard-basic-mapping-panel.tsx`, `mapping-workspace.tsx`) still prefer Union Schema tree when present, else `MappingJsonTree`. Do not replace either widget with rc-tree or Monaco.

### Union Schema inference (unchanged; do not replace with GenSON)

- Frontend SoT: `frontend/src/utils/unionSchema.ts` — `inferValueType`, `mergeInferredTypes`, `walkEventFields`, `buildUnionSchema`, `isRareUnionField` (30%), `MAX_SAMPLE_VALUES = 5`. Sample policy: `unionSchemaSamplePolicy.ts` 10 min / 20 recommended.
- Backend observation: `app/schema_observation/path_walker.py` — same JSONPath + coarse types; **no** `occurrence_count` / `sample_values`. Still stream-scope, not per-route.
- GenSON remains **REJECT** as Union Schema engine (JSON Schema ≠ field inventory).

### Transform UI (already complete; no new DSL)

| Surface | This HEAD |
| --- | --- |
| Five enrichment modes | `enrichment-rules-model.ts`: Static, Calculated, Lookup, Conditional, Normalize |
| Full-event JSONata | `app/mappers/full_event_mapping.py` `apply_full_event_jsonata_mapping`: `jsonata.Jsonata(expression).evaluate(event)`; result **must be a dict**. Dep: `requirements.txt` `jsonata-python>=0.6.0,<1` |
| Editor | `wizard-full-event-transform-workspace.tsx` `<textarea>` (`JSONATA_TEXTAREA_CLASS`); `advanced-transform-workspace.tsx` `<textarea rows={3}>`. No Monaco. |
| Local preview | `wizard-full-event-preview.ts` `applyJsonataLocal` **does not evaluate**; tells operator to use backend jsonata-python |
| Per-field JSONata in preview | Still `TRANSFORM_ENGINE_UNAVAILABLE` in `preview_service.py`. Do **not** fill that gap with jq/VRL/jsonata-js. |
| Pass-through | Unchanged product default. |

### JSONata tests — is there already a JS corpus?

**No.** This branch has no `tests/jsonata_conformance/`, no `tests/test_jsonata_corpus.py`, no vendored `test/test-suite/groups/**/*.json`.

What exists is the **product** contract, not the jsonata-js suite:

- `tests/test_full_event_mapping.py` — one representative object constructor (`JSONATA_EXPRESSION` with `$split` / `$count`); preview + HTTP tests. Regex full-event is separate.
- E2E goldens `e2e/suite-validation/golden/golden-fixtures/G-TF-JSONATA-{SINGLE,NESTED,ARRAY}.json` plus expected collector/runtime/delivery files.
- Frontend wizard tests around the textarea + backend preview payload.

Do not vendor 1291 JS 2.2.2 cases against python 0.6 (mostly skip/xfail; many results are not dicts). Do not add `jsonata` npm. Do not evaluate JSONata in the browser as SoT.

### Never-adopt (reconfirmed on this HEAD)

1. No jq / JMESPath / VRL / Bloblang.
2. No jsonata-js runtime (frontend or API process).
3. No Monaco as Transform editor.
4. No rc-tree / Ant tree as Union Schema.
5. No GenSON as Union Schema.
6. No `@tanstack/react-virtual` for this tree (keep custom windowing).
7. No per-route Union Schema.

---

**Repo (historical audit below):** `/home/aella/gdc-platform`  
**Branch:** `feature/post-m29-development`  
**Date:** 2026-08-28  
**Scope:** Code-to-OSS fit only. No Data Relay source, tests, configs, Full Matrix, or QA Lab changes.

## Constraints (non-negotiable)

- Union Schema is **Stream Scope**. Sample policy: **10 minimum / 20 recommended** events. All Routes share the same Union Schema. **No per-route schemas.**
- Transform UI modes: **Static, Calculated, Lookup, Conditional, Normalize**. Unknown Field: **Pass Through**.
- Architecture: **One Stream → Many Routes → Many Destinations**. Route Processing: **Transform → Protection → Classification → Policy → Delivery**.
- **NEW DSL MUST NOT be added.** Do not recommend jq, JMESPath, VRL, or Bloblang as user languages.
- Do not replace Runtime Snapshot, hide P0 operational metrics, or introduce a parallel transform/runtime engine.
- Adoption vocabulary: `DIRECT_DEPENDENCY` | `SOURCE_ADAPTATION` | `HARVESTER_SOURCE` | `TEST_CORPUS` | `REFERENCE_PATTERN` | `REJECT`.
- Priority: `P0` | `P1` | `P2` | `LATER` | `REJECT`.

## Method

1. Read Data Relay Union Schema, Transform, Mapping, inference, and JSONata files at function level.
2. Shallow-clone OSS into `/tmp/oss-audit-clones/` and inspect **implementation**, manifests, licenses, tests, and recent commits — not READMEs only.
3. Answer the 15 audit questions per OSS, then emit an integration matrix.

OSS clones (this audit):

| OSS | Clone path | HEAD (shallow) | License |
| --- | --- | --- | --- |
| TanStack Virtual | `/tmp/oss-audit-clones/virtual` | `e9874f0` 2026-08-18 | MIT (`LICENSE`) |
| rc-tree (`@rc-component/tree`) | `/tmp/oss-audit-clones/tree` | `528f6b0` 2026-08-28 | MIT (`LICENSE.md`) |
| Monaco Editor | `/tmp/oss-audit-clones/monaco-editor` | `d620ca0` 2026-08-27 | MIT (`LICENSE.txt`) |
| GenSON | `/tmp/oss-audit-clones/genson` | `e541183` 2026-07-06 | MIT (`LICENSE`) |
| JSONata JS | `/tmp/oss-audit-clones/jsonata` | `6c7e95f` 2026-07-16 (v2.2.2) | MIT (`LICENSE`) |

---

## 1. Data Relay current implementation (file / function map)

### 1.1 Union Schema — inference and sample policy

| Concern | File | Functions / types |
| --- | --- | --- |
| Field inventory from sample events | `frontend/src/utils/unionSchema.ts` | `inferValueType`, `mergeInferredTypes`, `walkEventFields`, `collectPathsFromEvent`, **`buildUnionSchema`**, `isRareUnionField` (30% threshold), `unionSchemaFromStreamConfig`, `buildRepresentativeEventFromUnionSchema` |
| Caps | same | `MAX_SAMPLE_VALUES = 5`, `MAX_PATHS = 500`, `MAX_DEPTH = 12` |
| Sample count SoT | `frontend/src/utils/unionSchemaSamplePolicy.ts` | `UNION_SCHEMA_MIN_SAMPLE_EVENTS = 10`, `UNION_SCHEMA_RECOMMENDED_SAMPLE_EVENTS = 20`, `getUnionSchemaSampleStatus`, `resolveUnionSchemaSampleCount` |
| Sensitive overlay (not inference) | `frontend/src/utils/unionSchemaSensitiveSuggestions.ts` | `attachSensitiveSuggestions`, `enrichUnionSchemaWithSensitiveSuggestions` → `runSensitiveDetectionPreview` |
| Sensitive display | `frontend/src/utils/unionSchemaFieldDisplay.ts` | `isUnionFieldSensitive` |
| Persist to stream config | `frontend/src/components/streams/wizard/wizard-union-schema-persist.ts` | `buildUnionSchemaPersistPayload`, `persistWizardUnionSchema` (PUT `config_json.union_schema`) |
| Shared across routes (test SoT) | `frontend/src/components/streams/wizard/wizard-union-schema-sensitive-p0.test.ts` | “shares one backend-suggested union schema across three routes without auto protection” |

Union Schema is **not** JSON Schema. It is a **flat field inventory**:

```ts
{ total_events, fields: [{ field_path, field_type, occurrence_count, sample_values, suggested_sensitive_type?, sensitivity_class?, ... }] }
```

Rare = `occurrence_count / total_events < 0.3` (`RARE_FIELD_RATIO_THRESHOLD`).

### 1.2 Union Schema — backend (runtime / observation, not wizard inference)

Wizard inference lives in the **frontend**. Backend walks events for **runtime observation / drift baseline**, using the same JSONPath + coarse types.

| Concern | File | Functions |
| --- | --- | --- |
| Runtime path walker | `app/schema_observation/path_walker.py` | `infer_value_type`, `merge_inferred_types`, `walk_event_fields`, `collect_paths_from_event`, `collect_paths_from_events` |
| Observation merge | `app/schema_observation/service.py` | `collect_paths_from_events` into `StreamObservedSchema` |
| Baseline from Union Schema | `app/schema_observation/union_schema_baseline.py` | `normalize_union_schema_fields`, `paths_from_union_schema`, **`establish_baseline_from_union_schema`** — comment: “Routes share one stream-level baseline — never destination/route-specific” |
| Shared batch contract | `app/runners/route_context_builder.py` | `_normalize_union_schema`, `build_shared_batch_context` copies **one** `stream_config["union_schema"]` onto `SharedBatchContext.union_schema` |
| Persist API | `app/runtime/stream_configuration_service.py` | reads/writes `cfg["union_schema"]` (~L624, L683) |

Backend walker does **not** store `occurrence_count` or `sample_values`. Those exist only on the wizard Union Schema payload.

### 1.3 Union Schema tree UI (no virtualization today)

| Concern | File | Functions / components |
| --- | --- | --- |
| Nested tree from flat paths | `frontend/src/components/streams/union-schema-tree.tsx` | `buildSchemaTree`, `pathSegmentsAfterRoot`, `SchemaTreeNodeRow` (recursive, per-node `useState` expand), `GeneratedFieldsGroup` |
| Detail panel | `frontend/src/components/streams/union-field-detail-panel.tsx` | frequency, rare, sensitive, samples |
| Tree + detail split | `frontend/src/components/streams/union-schema-tree-detail-layout.tsx` | `UnionSchemaTreeDetailLayout` |
| Generated (enrichment) fields | `frontend/src/utils/generatedFieldsTree.ts` | `buildGeneratedFieldTreeNodes`, `ruleToSyntheticUnionField` |
| Single-event JSON tree (fallback) | `frontend/src/components/streams/mapping-json-tree.tsx` | recursive `MappingJsonTree`, same expand strategies (`smart` / `all` / `minimal`) |
| Wizard consumers | `wizard-full-event-transform-workspace.tsx` `SourceSchemaPanel`; `wizard-basic-mapping-panel.tsx`; `mapping-workspace.tsx` | Union Schema tree when present; else `MappingJsonTree` |

**Limit:** every visible node is a React component. Expand-all on a 500-path CloudTrail-like inventory (+ sample rows) can produce hundreds of DOM nodes. No `useVirtualizer`, no flatten-then-window. Existing product virtualization (`frontend/src/lib/windowed-virtual-range.ts` `computeWindowedRange`, `frontend/src/hooks/use-virtual-window.ts`, `frontend/src/lib/fixed-row-virtual-window.ts`) is **fixed row height** and used on Streams/Routes/Runtime grids — **not** on this tree.

`frontend/package.json` has **no** `@tanstack/react-virtual`, `rc-tree`, or `monaco-editor`.

### 1.4 Transform UI modes (already implemented — do not replace)

| Mode | Frontend model | Backend execution |
| --- | --- | --- |
| Static / Calculated / Lookup / Conditional / Normalize | `frontend/src/components/streams/wizard/enrichment-rules-model.ts` — `EnrichmentRuleType`, `defaultRuleForType`, `ENRICHMENT_RULE_TYPES` | `app/enrichers/rule_executor.py` `_RULE_TYPES`; `app/enrichers/expression_evaluator.py` `evaluate_calculated_expression` (sandboxed, **not** JSONata); `app/enrichers/lookup_tables.py`; `app/enrichers/rule_validation.py` |
| Wizard field-rules tab | `wizard-transform-rules-panel.tsx` tab `field_rules` | Enrichment engine |
| Unknown field Pass Through | `frontend/src/utils/mappingPassThrough.ts`; wizard `unmappedFieldsPolicy` | `app/mappers/pass_through.py`; `app/mappers/unmapped_policy.py` `DEFAULT_UNMAPPED_FIELDS_POLICY = "pass_through"` |

Calculated expressions are a **small sandboxed language** (`concat`, `upper`, `lower`, `coalesce`, `now_utc`, `{{field}}`). They are **not** a slot for jq/VRL/Bloblang.

### 1.5 JSONata — already the Advanced/full-event engine

| Concern | File | Functions |
| --- | --- | --- |
| Dependency | `requirements.txt` | `jsonata-python>=0.6.0,<1` |
| Runtime evaluate | `app/mappers/full_event_mapping.py` | **`apply_full_event_jsonata_mapping`**: `jsonata.Jsonata(expression).evaluate(event)`; result **must be a dict** |
| Preview path | `app/runtime/preview_service.py` | `run_transform_preview` → `apply_full_event_mapping` for `mapping_mode=full_event_jsonata` |
| Per-field JSONata rules | same `preview_service.py` | `_transform_preview_advanced_unavailable` — per-field `mode in {jsonata, regex_extract}` currently **blocks save** (`TRANSFORM_ENGINE_UNAVAILABLE`) |
| Wizard editor | `wizard-full-event-transform-workspace.tsx` | **`<textarea>`** (`JSONATA_TEXTAREA_CLASS`), not Monaco |
| Per-rule editor | `frontend/src/components/transform/advanced-transform-workspace.tsx` | `<textarea>` for JSONata expression |
| Local preview fallback | `wizard-full-event-preview.ts` | `applyJsonataLocal` **does not evaluate**; tells operator to use backend `jsonata-python` |
| Mapping workspace | `frontend/src/components/mappings/mapping-workspace.tsx` | Basic JSONPath table + Advanced/Expert tabs wrapping `AdvancedTransformWorkspace` |

**Do not add a second user language.** JSONata is already the Advanced transform DSL. The gap is editor UX and **conformance coverage**, not “pick a new DSL”.

### 1.6 Structural limits (before OSS)

1. Union Schema tree is a **custom recursive tree** with product-specific badges (rare / sensitive / generated / frequency). Replacing it with a generic tree widget would drop those semantics.
2. Inference already walks events and records **frequency + samples**. JSON Schema generators do not.
3. JSONata runtime is **Python-only**. Frontend textarea + backend preview is the contract. A browser JSONata engine would fork evaluation.
4. Per-field JSONata in `run_transform_preview` is explicitly **unavailable** in this build; full-event JSONata **is** available.
5. `MAX_PATHS = 500` bounds tree size; virtualization is a **scale UX** improvement, not a missing architecture.

---

## 2. Fifteen audit questions — TanStack Virtual

**Candidate package:** `@tanstack/react-virtual` `3.14.10` + `@tanstack/virtual-core` `3.17.8`  
**Peer:** `react` / `react-dom` `^16.8 \|\| ^17 \|\| ^18 \|\| ^19` — **React 19 OK**.  
**Core APIs:** `useVirtualizer` / `useWindowVirtualizer` in `packages/react-virtual/src/index.tsx`; `Virtualizer` class, `VirtualItem`, `estimateSize`, `getVirtualItems()`, `measureElement` in `packages/virtual-core/src/index.ts`. Dynamic-height example: `examples/react/dynamic/src/main.tsx`.

### Q1. Where is this implemented in Data Relay?

Fixed-row windowing only: `computeWindowedRange` (`frontend/src/lib/windowed-virtual-range.ts`), `useVirtualWindow` (`frontend/src/hooks/use-virtual-window.ts`), `computeFixedRowVirtualRange` (`frontend/src/lib/fixed-row-virtual-window.ts`), used by `streams-console.tsx`, `routes-overview-page.tsx`, `virtualized-stream-grid.tsx`. **Union Schema tree is not virtualized.**

### Q2. Structure and limits?

Custom windowers assume **constant `itemSize`**. Union Schema rows are **variable height** (expand + up to 5 sample lines). Recursive `SchemaTreeNodeRow` cannot window without a **flatten of expanded nodes** first. Existing helpers cannot measure real row height (`measureElement`).

### Q3. Which OSS files/functions?

- `packages/react-virtual/src/index.tsx` — `useVirtualizer`, `useVirtualizerBase`, `containerRef`, `directDomUpdates`
- `packages/virtual-core/src/index.ts` — `class Virtualizer`, `getVirtualItems()`, `getTotalSize()`, `estimateSize`, `measureElement`, `overscan`
- `examples/react/dynamic/src/main.tsx` — variable row pattern (`estimateSize: () => 45` + measure)

### Q4. What would OSS improve?

Window only visible flattened tree rows. Expand-all on large inventories (up to `MAX_PATHS` 500 + samples) stays smooth. Same dependency could later upgrade Streams/Routes lists, but those already work.

### Q5. Overlap with Data Relay?

Overlaps **list virtualization math**, not Union Schema inference, rare/sensitive flags, or transform modes. Does **not** replace `buildUnionSchema` or `UnionSchemaTree` product chrome.

### Q6. Direct dependency?

**Yes, optionally** for the Union Schema / Mapping JSON trees. Small, headless, MIT, React 19. Do not pull it solely to rewrite already-working Streams/Routes virtualizers.

### Q7. Source adaptation?

Not required. Prefer the package over copying 2k-line `Virtualizer`. Adaptation is **our flatten layer** (`buildSchemaTree` → expanded-key flatten), analogous to rc-tree’s `flattenTreeData`.

### Q8. Pattern-only?

If product rejects a new npm dep, copy the **flatten + window** idea onto `computeWindowedRange` and add `estimateSize`. That is weaker than `measureElement` for sample-expanded rows.

### Q9. Connector Harvester source?

**No.**

### Q10. License?

**MIT** (`/tmp/oss-audit-clones/virtual/LICENSE`). NOTICE of copyright required on redistribution. Commercial OK.

### Q11. Architecture invasion?

**No.** UI-only. Does not change Stream/Route/Destination, Union Schema scope, or Route Processing order.

### Q12. Integration points?

1. `frontend/src/components/streams/union-schema-tree.tsx` — flatten expanded `SchemaTreeNode[]`, virtualize the list, keep `SchemaTreeNodeRow` visuals.
2. Optionally `mapping-json-tree.tsx` for huge single events.
3. `package.json` add `@tanstack/react-virtual`.

Keep `UnionSchemaTreeDetailLayout`, `UnionFieldDetailPanel`, rare/sensitive/generated badges.

### Q13. Do not apply?

- Do not virtualize away accessibility of expand/collapse (`aria-expanded` on existing buttons).
- Do not replace Runtime Snapshot pages’ data source.
- Do not use as a reason to drop `MAX_PATHS` without a product decision.
- Do not rewrite Streams/Routes virtualizers in the same change (conflict risk with Agent 2).

### Q14. Difficulty / regression?

**Medium / medium.** Must flatten expanded keys (rc-tree pattern). Tests: `union-schema-tree.test.tsx`, `union-schema-tree-generated.test.tsx`, `wizard-full-event-transform-workspace.test.tsx`, `wizard-basic-mapping-panel` consumers. Risk: scroll jump on expand, search filter vs window, generated-fields group.

### Q15. Priority?

**P1** — `DIRECT_DEPENDENCY` for Union Schema tree when expand-all / large connector events hurt. Not P0: current tree is functionally complete for 10–20 samples of modest width.

---

## 3. Fifteen audit questions — rc-tree (`@rc-component/tree`)

**Package:** `@rc-component/tree` `1.5.2`  
**Peers:** `react: "*"`, `react-dom: "*"` (devDeps include React 19).  
**Deps:** `@rc-component/motion`, `@rc-component/util`, **`@rc-component/virtual-list`**, `clsx`.  
**Virtualization:** `src/NodeList.tsx` wraps `VirtualList` from `@rc-component/virtual-list`; requires `height` + **`itemHeight` (fixed)**. Flatten: `src/utils/treeUtil.ts` **`flattenTreeData`**. Public API: `src/Tree.tsx` `virtual?`, `height?`, `itemHeight?`; default export `src/index.ts`.

### Q1. Where in Data Relay?

Custom tree: `union-schema-tree.tsx` `buildSchemaTree` + recursive `SchemaTreeNodeRow`. Not rc-tree.

### Q2. Limits?

Product tree is **styled for Data Relay** (Tailwind, rare/sensitive chips, sample lists, generated group). No check/drag (rc-tree’s main extra surface). Rows are **variable height** — rc-tree virtual path is **fixed `itemHeight`**.

### Q3. OSS files?

- `src/Tree.tsx` — expand/select/check/drag, `virtual` prop (~1569 lines)
- `src/NodeList.tsx` — `VirtualList` (~L280)
- `src/utils/treeUtil.ts` — `flattenTreeData` (~L116)
- `src/TreeNode.tsx` — default node chrome
- `assets/*.less` — Ant-style CSS (clash with Tailwind 3.4 tokens)

### Q4. What would it improve?

Ready-made keyboard, flatten, and optional virtual list. **Does not** know frequency/rare/sensitive.

### Q5. Overlap?

Replaces the **entire** `UnionSchemaTree` if adopted wholesale — high overlap, low incremental value vs custom tree + TanStack flatten.

### Q6. Direct dependency?

**No.** Pulls motion + virtual-list + Less CSS. Checkable/drag APIs unused. Fixed row height fights sample rows.

### Q7. Adaptation?

Possible to wrap `title` render with Data Relay badges, but you still fight CSS prefix (`rc-tree`) and itemHeight.

### Q8. Pattern-only?

**Yes.** Steal **`flattenTreeData` algorithm** (expanded-key set → flat list) as the adapter for TanStack Virtual. Do not import the component.

### Q9. Harvester?

**No.**

### Q10. License?

**MIT** (`LICENSE.md`, Copyright Alipay.com). Commercial OK.

### Q11. Architecture?

A full swap would not change Stream-scope Union Schema **data**, but would **risk UX regression** on Transform/Mapping field picking. Drag-and-drop tree semantics are not in the product model.

### Q12. If applied?

Would replace `UnionSchemaTree` internals. **Not recommended.** If anything: copy `flattenTreeData` into `frontend/src/utils/` as a small helper (SOURCE_ADAPTATION of ~80 lines), MIT notice.

### Q13. Do not apply?

- Do not mount Ant Design tree as Union Schema.
- Do not enable check/drag.
- Do not take `@rc-component/virtual-list` **and** TanStack Virtual (duplicate windowers).
- Do not per-route trees.

### Q14. Difficulty / regression?

**High / high** for wholesale. **Low / low** for flatten-algorithm copy.

### Q15. Priority?

**REJECT** as dependency. **REFERENCE_PATTERN** (flatten) — use with TanStack, P1 as an implementation note, not a separate workstream.

**Verdict vs custom + TanStack Virtual:** keep **custom tree chrome**; flatten expanded nodes; virtualize with **TanStack** (variable `estimateSize` / `measureElement`). rc-tree virtualization is the wrong height model.

---

## 4. Fifteen audit questions — Monaco Editor

**Repo version in clone:** `0.56.0` (private monorepo; npm `monaco-editor`).  
**License:** MIT, Microsoft.  
**React sample in-tree:** `samples/browser-esm-vite-react/package.json` still pins **React 17** and `monaco-editor ^0.32.0` — not a React 19 reference. Vite integration requires `MonacoEnvironment.getWorker` (`docs/integrate-esm.md`, `samples/browser-esm-vite-react/src/userWorker.ts`).  
**Languages:** CSS/HTML/JSON/TS + many `basic-languages`. **No JSONata language.** Custom languages use `monaco.languages.setMonarchTokensProvider` (`website/src/website/data/playground-samples/extending-language-services/custom-languages/sample.js`).  
**Bundle:** full `monaco-editor` entry “continues to load all features and languages” (CHANGELOG 0.56.0). Clone tree **29M** without `node_modules`. Historical minified `editor.main` is **multi-MB**; even `monaco-editor/editor` + one language + workers is large vs current Data Relay frontend (React, lucide, recharts, CVA only). Workers: JSON/TS/CSS/HTML editor workers.

### Q1. Where in Data Relay?

JSONata is a **textarea**:

- `wizard-full-event-transform-workspace.tsx` (~L585) `aria-label="Full event JSONata expression"`
- `advanced-transform-workspace.tsx` (~L260–269) JSONata `<textarea rows={3}>`

No Monaco, no CodeMirror, no language worker.

### Q2. Limits?

No syntax highlighting, autocomplete, or bracket matching. Expressions in tests (`tests/test_full_event_mapping.py` `JSONATA_EXPRESSION`) are **short object constructors**, not multi-file programs. Local preview (`applyJsonataLocal`) cannot parse/highlight either.

### Q3. OSS files?

- `docs/integrate-esm.md` — Vite/webpack worker contract
- `samples/browser-esm-webpack-small/index.js` — feature/language tree-shaking
- CHANGELOG 0.56.0 — `monaco-editor/editor` + `monaco-editor/features/*` + `monaco-editor/languages/definitions/*`
- No `jsonata` under language definitions (search of clone: none)

### Q4. What would it improve?

Highlighting and find-in-editor for long pasted JSONata. **Would not** evaluate expressions (runtime remains `jsonata-python`). **Would not** add IntelliSense unless a custom completion provider maps Union Schema paths — extra product work.

### Q5. Overlap?

Overlaps the textarea only. Does not overlap Union Schema inference, enrichment modes, or pass-through.

### Q6. Direct dependency?

**No for default Transform UI.** Cost: workers, Vite config, CSS, fonts, a11y divergence, Tailwind theme mismatch, no native JSONata grammar.

### Q7. Adaptation?

A Monarch tokenizer for JSONata would be custom SOURCE_ADAPTATION on top of Monaco — still pays bundle cost.

### Q8. Pattern-only?

If highlighting is wanted later, a **tiny** token highlighter (or `textarea` + CSS) is enough. Do not treat Monaco as a pattern for “how editors should look”.

### Q9. Harvester?

**No.**

### Q10. License?

**MIT** (`LICENSE.txt`). Redistribution of minified editor requires MIT notice. No copyleft.

### Q11. Architecture?

Does not change Route Processing. Risk: operators assume the editor **runs** JSONata in-browser (false unless `jsonata` JS is also added — **forbidden as a second engine**). Worker CSP may break offline/HTTPS compose.

### Q12. If applied anyway?

Lazy-load only on Advanced/full-event tab; `monaco.editor.create` on the textarea mount in `wizard-full-event-transform-workspace.tsx`; language `'jsonata'` via Monarch **or** fallback `'javascript'`. Still evaluate via `runTransformPreview` / `apply_full_event_jsonata_mapping`.

### Q13. Do not apply?

- Do not ship full `import 'monaco-editor'` (all languages).
- Do not add jsonata-js **and** Monaco as a client evaluator.
- Do not use Monaco for Union Schema JSON view (`<pre>` is enough).
- Do not use Monaco for Calculated enrichment (`evaluate_calculated_expression` is not JSONata).
- Do not introduce jq/VRL/Bloblang language packs.

### Q14. Difficulty / regression?

**High / medium-high.** Vite worker + Playwright (wizard full-event tests) + bundle budget. Offline install size.

### Q15. Priority?

**REJECT** for the JSONata editor. Current textarea + backend preview matches the product (paste-from-external-tool copy in `GUIDANCE_LINES` / `FULL_EVENT_JSONATA_GUIDANCE`). Revisit only as **LATER** if measured paste size / error-localization demand it — still not a P0/P1.

---

## 5. Fifteen audit questions — GenSON

**Version:** `1.4.0` (`genson/__init__.py`). **Python:** `>=3.10` (`setup.cfg`) — compatible with Data Relay. **API:** `SchemaBuilder.add_object` / `add_schema` / `to_schema` (`genson/schema/builder.py`). Object merge: `genson/schema/strategies/object.py` `add_object` — tracks **`required` as set intersection**, `properties` as recursive nodes. **No occurrence counts, no sample values, no sensitivity.** Outputs **JSON Schema Draft 6+** (`type`, `properties`, `required`, `anyOf` when types diverge). Guiding rule (README.rst): every object must validate; same broad types **merge**, not `anyOf`.

### Q1. Where in Data Relay?

Frontend: `buildUnionSchema` / `walkEventFields` (`unionSchema.ts`). Backend observation: `path_walker.py` `walk_event_fields` / `collect_paths_from_events`. Sensitive: **separate** `sensitive_detection` + `attachSensitiveSuggestions`. Not GenSON, not JSON Schema.

### Q2. Limits of current inference?

- Frequency and rare (30%) — **present**
- Sample values (max 5 primitives) — **present**
- Mixed types via `mergeInferredTypes` — **present** (collapses to `"mixed"`, not JSON Schema `anyOf`)
- Array sampling first 3 items — **present** (same idea as GenSON array strategy)
- Does **not** emit JSON Schema `required` / `$schema`
- Caps at 500 paths / depth 12
- Backend observation **drops** occurrence/samples

GenSON’s job (JSON Schema for validation) is a **different artifact** from Union Schema (operator field tree + route-shared inventory).

### Q3. OSS files?

- `genson/schema/builder.py` — `SchemaBuilder.add_object`, `to_schema`
- `genson/schema/strategies/object.py` — `required` intersection, `properties`
- `genson/schema/strategies/scalar.py`, `array.py`, `enum.py`
- `genson/schema/node.py` — merge node
- Tests: `test/test_add_multi.py`, `test/test_gen_multi.py`

**None** implement frequency, rare, or PII.

### Q4. What would it improve?

If Data Relay needed **JSON Schema export** (Marketplace package, OpenAPI-ish docs), GenSON could generate `properties`/`required` from the same 10–20 samples. It would **not** improve Union Schema tree, rare badges, or sensitive flags.

### Q5. Overlap?

**High overlap on type walking** (object/array/scalar merge). Replacing `buildUnionSchema` with GenSON would **lose** `occurrence_count`, `sample_values`, rare, and the `$.a.b[]` path convention used by Transform/Protection.

### Q6. Direct dependency?

**No** for Union Schema. Adding GenSON as the inference engine is a **wrong model**. Optional later for a JSON Schema **export** helper only.

### Q7. Adaptation?

Do not port GenSON into `unionSchema.ts`. Frontend already mirrors `path_walker.py`. A Python GenSON call in the wizard path would **split** inference (TS vs Python) and break offline wizard preview.

### Q8. Pattern-only?

**Yes:** `required` = keys seen in **all** objects (GenSON `self._required &= properties`) is a possible extra Union Schema field (`always_present: boolean`) — but `occurrence_count === total_events` already encodes that. No new dependency needed.

### Q9. Harvester?

**No** as a connector ecosystem. Harvester should not treat GenSON as a Singer/Telegraf source. (JSON Schema **output** might later feed Marketplace validation — Agent 5 — not this tree.)

### Q10. License?

**MIT** (`LICENSE`, Jon Wolverton). OK.

### Q11. Architecture?

Replacing Union Schema with JSON Schema **would** invade architecture: Routes would be tempted toward per-destination schemas; rare/sensitive UX would vanish; Stream-scope inventory would become Draft-7 documents. **Reject that replacement.**

### Q12. Integration if used at all?

Only a **side export**: `buildUnionSchema(events)` stays SoT; optional `genson.SchemaBuilder` in a backend util for “download JSON Schema” — **not** `config_json.union_schema`. Do not write GenSON output into `SharedBatchContext.union_schema`.

### Q13. Do not apply?

- Do not use GenSON as Union Schema.
- Do not drop frequency/rare/sensitive because JSON Schema lacks them.
- Do not infer per Route.
- Do not feed GenSON schemas into Route Processing as a second catalog.

### Q14. Difficulty / regression?

Replacement: **high / P0 regression** (wizard, baseline, protection suggestions, tests `unionSchema.test.ts`, `test_union_schema_baseline_p0.py`). Side-export: low / low.

### Q15. Priority?

**REJECT** as Union Schema / Transform inference engine. **REFERENCE_PATTERN** only for “required = intersection” (already implied by occurrence). JSON Schema export = **LATER / P2** if a spec asks for it — still not a substitute.

---

## 6. Fifteen audit questions — JSONata JS (`jsonata-js/jsonata`)

**Version:** `2.2.2`. **Engine:** `src/jsonata.js` factory `jsonata(expr)` → `{ evaluate, assign, ast }` (`jsonata.d.ts`). Parser: `src/parser.js`. Functions: `src/functions.js`.  
**Conformance corpus:** `test/run-test-suite.js` loads `test/test-suite/groups/*/*.json` + `test/test-suite/datasets/`. This clone: **1291** case JSON files across groups including `transform`, `transforms`, `function-*`, `hof-*`, `conditionals`, etc. Runner compiles `jsonata(testcase.expr)`, binds `dataset`, asserts `result` / errors.  
**Data Relay runtime:** `jsonata-python>=0.6.0,<1` via `jsonata.Jsonata(expression).evaluate(event)` in `apply_full_event_jsonata_mapping`. **Not** the JS package. Frontend `applyJsonataLocal` refuses to evaluate.

### Q1. Where in Data Relay?

Backend only: `app/mappers/full_event_mapping.py` `apply_full_event_jsonata_mapping`. Preview: `run_transform_preview`. Tests: `tests/test_full_event_mapping.py` (one representative object constructor). E2E golden `G-TF-JSONATA-*`. Per-field JSONata in preview is **unavailable**.

### Q2. Limits?

- Thin wrapper: compile + evaluate + “must return object”.
- No timeout/stack guards wired from JS `JsonataOptions.timeout` / `stack`.
- **No** import of the 1291-case JS suite against jsonata-python.
- Version skew: JS **2.2.2** vs Python **0.6.x** — many suite cases will fail or be unimplemented; that is **useful**, not a reason to swap engines.
- Dual-engine risk if JS is added to the browser.

### Q3. OSS files?

- `src/jsonata.js` — `evaluate`, `evaluatePath`, `evaluateBinary`, transform operator
- `src/parser.js`, `src/functions.js`, `src/datetime.js`, `src/signature.js`
- `test/run-test-suite.js` — corpus driver
- `test/test-suite/groups/**/*.json` — expressions + expected results
- `test/test-suite/datasets/*.json` — inputs
- Example transform case: `test/test-suite/groups/transform/case000.json`

### Q4. What would it improve?

**TEST_CORPUS** for jsonata-python: subset the suite to cases that return **JSON objects** (Data Relay constraint) and skip/xfail Python gaps. Improves confidence in `apply_full_event_jsonata_mapping` without a new DSL.

JS **runtime in the browser** would only help offline preview (`applyJsonataLocal`) — at the cost of JS vs Python drift (operators already hit `TRANSFORM_ENGINE_UNAVAILABLE` vs full-event path). **Do not** ship JS as the evaluator of record.

### Q5. Overlap?

The **language** overlaps by design (same JSONata). The **JS implementation** overlaps jsonata-python. Product tests overlap a tiny slice of the corpus.

### Q6. Direct dependency (frontend or backend)?

- Frontend `jsonata` npm: **No** (second engine).
- Backend: already has jsonata-python. Do not add jsonata-js via Node in the API process.

### Q7. Adaptation?

Do not port `src/jsonata.js` into Python. jsonata-python **is** the port. Adaptation = **test harness** that reads the JSON cases.

### Q8. Pattern-only?

The evaluate/assign/AST API is already mirrored. No new pattern needed for Transform UI.

### Q9. Harvester?

**No.**

### Q10. License?

**MIT** (`LICENSE`; IBM copyright on source headers). Test JSON files are usable as TEST_CORPUS with MIT notice. Do not relicense as a user DSL.

### Q11. Architecture?

JS engine in UI: risk of **preview ≠ runtime**. New DSL (jq/VRL): **architecture violation**. Corpus-only: **no** architecture change.

### Q12. Integration points (corpus)?

1. Add a **test-only** path (e.g. `tests/jsonata_conformance/`) that loads vendored or git-submodule cases — **do not** modify Full Matrix fixtures to “make corpus pass”.
2. Filter: `result` is `dict`; skip async/higher-order if python-jsonata lacks them; xfail documented gaps.
3. Call `jsonata.Jsonata(expr).evaluate(dataset)` the same way as `apply_full_event_jsonata_mapping` (object-return check can wrap the helper).
4. Keep product tests `test_full_event_mapping.py` as the UX-level contract.

### Q13. Do not apply?

- Do not add jq, JMESPath, VRL, Bloblang.
- Do not evaluate JSONata in the browser as SoT.
- Do not replace Static/Calculated/Lookup/Conditional/Normalize with “just write JSONata”.
- Do not change `run_transform_preview` per-field unavailability **in this audit** (implementation is out of scope); corpus does not unblock that by itself.
- Do not vendor the entire JS runtime into `frontend/`.

### Q14. Difficulty / regression?

Corpus harness: **medium / low** if xfail is honest. Shipping JS evaluator: **high / high** (preview divergence, bundle, CSP).

### Q15. Priority?

**TEST_CORPUS — P1** for jsonata-python conformance (object-returning subset).  
**REJECT** jsonata-js as a Data Relay runtime or user-facing library.  
**REJECT** any additional transform language.

---

## 7. Cross-cutting: 15 questions (summary table)

Questions from the program brief, answered for this workstream as a whole:

| # | Question | Answer |
| --- | --- | --- |
| 1 | Where implemented? | Union Schema: `unionSchema.ts` `buildUnionSchema` + tree `union-schema-tree.tsx`; persist `wizard-union-schema-persist.ts`; backend share `route_context_builder.py` / `union_schema_baseline.py`. Transform modes: `enrichment-rules-model.ts` + `rule_executor.py`. JSONata: `full_event_mapping.py` + textareas. Pass-through: `pass_through.py` / `mappingPassThrough.ts`. |
| 2 | Structure / limits? | Custom recursive trees; no variable-height virtualization; inference already has frequency/rare/samples; JSONata editor is textarea; per-field JSONata preview blocked; frontend does not run JSONata. |
| 3 | OSS modules? | TanStack `useVirtualizer`; rc-tree `flattenTreeData` + `NodeList`/`VirtualList`; Monaco `editor.create` + workers; GenSON `SchemaBuilder`; JSONata `test/test-suite` + `src/jsonata.js`. |
| 4 | What OSS reduces/improves? | TanStack: large-tree scroll. rc-tree flatten: adapter idea. Monaco: little for current paste-sized expressions. GenSON: nothing for Union Schema. JSONata suite: python conformance. |
| 5 | Duplication? | GenSON vs `buildUnionSchema`/`path_walker`; rc-tree vs `UnionSchemaTree`; jsonata-js vs jsonata-python; TanStack vs `computeWindowedRange` (list-only). |
| 6 | Dependency? | Only TanStack Virtual is a justified **optional** UI dep. |
| 7 | Adaptation? | Flatten algorithm from rc-tree; not GenSON/Monaco/jsonata-js source. |
| 8 | Pattern only? | rc-tree flatten; GenSON required-intersection (already implied). |
| 9 | Harvester source? | **None of these five.** |
| 10 | License? | All five MIT. Safe with NOTICE. No copyleft in these clones. |
| 11 | Architecture intact? | Yes if we reject Monaco+JS engine, GenSON-as-schema, rc-tree wholesale, and new DSLs. |
| 12 | Connect where? | See per-OSS Q12. Primary: `union-schema-tree.tsx`; tests under `tests/` for jsonata corpus. |
| 13 | Must not apply? | New DSLs; per-route schemas; GenSON as Union Schema; Monaco default editor; jsonata-js SoT; rc-tree as the field tree. |
| 14 | Difficulty / regression? | TanStack P1 medium; corpus P1 medium/low; others high if forced. |
| 15 | Priority? | P1: TanStack on Union Schema tree + JSONata TEST_CORPUS. P2/LATER: JSON Schema export. REJECT: Monaco, rc-tree dep, GenSON engine, jsonata-js runtime, jq/VRL/Bloblang. |

---

## 8. Adoption matrix

| Area | Data Relay file / module | Current implementation | OSS | OSS file / module | Gap | Reusable part | Adoption | License | Architecture risk | Integration difficulty | Benefit | Priority | Recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Union Schema tree windowing | `union-schema-tree.tsx` `SchemaTreeNodeRow` | Recursive React, no virtual list | TanStack Virtual | `useVirtualizer`, `Virtualizer.getVirtualItems` | Expand-all / 500 paths jank | Headless window + `measureElement` | **DIRECT_DEPENDENCY** | MIT | Low | Medium | Smooth field picker | **P1** | Flatten expanded nodes; keep custom row UI |
| Tree flatten | `buildSchemaTree` | Nested tree only | rc-tree | `flattenTreeData` | Need flat list for virtualizer | Flatten algorithm | **REFERENCE_PATTERN** (optional **SOURCE_ADAPTATION** of flatten) | MIT | Low | Low | Enables TanStack | **P1** (with Virtual) | Do not npm-install rc-tree |
| Generic tree widget | `UnionSchemaTree` | Custom badges, samples, generated fields | rc-tree | `Tree.tsx`, `NodeList.tsx`, Less assets | Product semantics vs Ant tree | Keyboard/virtual (fixed height) | **REJECT** | MIT | Medium (UX) | High | None vs custom+TanStack | **REJECT** | Keep custom tree |
| JSONata editor | `wizard-full-event-transform-workspace.tsx` textarea; `advanced-transform-workspace.tsx` | Plain textarea, backend preview | Monaco | `monaco.editor.create`, workers, no JSONata lang | Highlighting | Editor chrome | **REJECT** | MIT | Medium (workers/CSP/false “runs here”) | High | Low for short exprs | **REJECT** | Keep textarea |
| Schema inference | `unionSchema.ts` `buildUnionSchema`; `path_walker.py` | Frequency, samples, rare, mixed, sensitive overlay | GenSON | `SchemaBuilder.add_object`, `object.py` required | JSON Schema ≠ Union Schema; no rare/sensitive | Type merge ideas | **REJECT** (engine) / **REFERENCE_PATTERN** | MIT | **High** if replaced | High if replaced | None for Union Schema | **REJECT** | Do not replace inference |
| JSONata engine | `apply_full_event_jsonata_mapping` | jsonata-python 0.6.x | jsonata-js | `src/jsonata.js` | Browser preview; version skew | Language (already used) | **REJECT** (runtime) | MIT | High (dual engine) | High | Preview offline only | **REJECT** | Backend remains SoT |
| JSONata conformance | `tests/test_full_event_mapping.py` | Few product cases | jsonata-js | `test/test-suite/**` (1291 JSON files), `run-test-suite.js` | Python port coverage unknown | Case JSON + datasets | **TEST_CORPUS** | MIT | Low | Medium | Catch eval drift | **P1** | Object-result subset + xfail |
| User transform languages | Enrichment 5 modes + JSONata + regex | Closed set | jq / JMESPath / VRL / Bloblang | — | — | — | **REJECT** | — | **Blocker** | — | None | **REJECT** | Charter: no new DSL |
| Harvester | n/a | n/a | all five | n/a | n/a | n/a | **REJECT** (`HARVESTER_SOURCE`) | — | — | — | — | — | Not connector ecosystems |

---

## 9. Never-adopt / do-not-do list

1. **Do not add jq, JMESPath, VRL, or Bloblang** as operator languages.
2. **Do not** make Union Schema per-route or per-destination.
3. **Do not** replace Union Schema with JSON Schema / GenSON output.
4. **Do not** drop frequency, rare (30%), sample values, or sensitive suggestions.
5. **Do not** replace Static / Calculated / Lookup / Conditional / Normalize with “JSONata only”.
6. **Do not** change Unknown Field default away from Pass Through.
7. **Do not** evaluate JSONata in the browser as source of truth (`applyJsonataLocal` is correctly backend-bound).
8. **Do not** install Monaco as the default Transform editor.
9. **Do not** replace `UnionSchemaTree` with rc-tree / Ant Design Tree.
10. **Do not** introduce a parallel transform runtime or pipeline framework.
11. **Do not** hide or bypass Route Processing order (Transform → Protection → Classification → Policy → Delivery).
12. **Do not** treat these OSS repos as Connector Harvester sources.
13. **Do not** modify Full Matrix / QA Lab to absorb JSONata JS suite failures — isolate corpus tests.

---

## 10. Existing Data Relay capabilities (do not re-propose as new OSS features)

- Union Schema from 10–20+ samples (`unionSchemaSamplePolicy.ts`)
- Shared stream `config_json.union_schema` and `SharedBatchContext.union_schema`
- Rare + sensitive field UX
- Custom schema tree + detail panel
- Transform field modes (five types) and pass-through
- Full-event JSONata via jsonata-python
- Regex full-event mapping
- Fixed-row virtualization on operational lists (separate from this tree)
- Schema observation / drift baseline from Union Schema

---

## 11. Recommended implementation order (audit only — not this task)

1. **P1** — Flatten Union Schema expanded nodes; add `@tanstack/react-virtual` to `UnionSchemaTree` only. Preserve badges and tests.
2. **P1** — Vendor or fetch JSONata JS `test/test-suite` as **TEST_CORPUS** for jsonata-python; object-returning subset; xfail map for 0.6 vs 2.2.2.
3. **P2 / LATER** — Optional JSON Schema **export** (not storage) if a spec requires it; GenSON is then a possible helper, still not Union Schema.
4. **Never in this track** — Monaco, rc-tree package, jsonata-js runtime, GenSON-as-inference, new DSLs.

**Conflicts:** Agent 2 may also recommend TanStack Virtual for lists. Share **one** `@tanstack/react-virtual` version; do not dual-implement windowers for the schema tree. Do not let a topology/graph library own Union Schema.

---

## 12. Unverified / out of band

- Exact npm unpacked size of `monaco-editor@0.56.0` (clone is 29M source; published package typically larger with min/esm).
- jsonata-python 0.6 feature matrix vs JS 2.2.2 (corpus will measure this; not executed in this audit).
- Whether Agent 2 already selected TanStack Virtual for Streams tables (coordinate at Integration Planner).
- Per-field JSONata `TRANSFORM_ENGINE_UNAVAILABLE` is an existing product gap; this audit does not recommend a new language to fill it — only jsonata-python completeness via corpus.

---

## 13. Clone evidence (maintenance)

| Repo | Latest shallow commit | Signal |
| --- | --- | --- |
| TanStack/virtual | 2026-08-18 Version Packages | Active, React 19 in package devDeps |
| react-component/tree | 2026-08-28 drag-expansion fix | Active |
| microsoft/monaco-editor | 2026-08-27 sample bump | Active; large surface |
| wolverdude/genson | 2026-07-06 CI/docs | Maintained; 1.4.0; Python 3.10–3.14 |
| jsonata-js/jsonata | 2026-07-16 v2.2.2 | Active; 100% coverage scripts in package.json |

All licenses confirmed in **source LICENSE files**, not README claims only.
