# M6 Protection Engine (MVP)

## Status

- **Milestone:** M6 — Protection Engine
- **Prerequisites:** M1 Schema Observation, M2 Field Added/Removed, M3a Type Change Detection, M4 Operator Workflow, M5 Sensitive Detection (all implemented and stabilized)
- **This document:** implementation authority for M6 only; no runtime code until explicitly scheduled after spec approval

## Purpose

Apply **deterministic field-level masking** to outbound delivery payloads on a per-Stream basis, driven by operator-confirmed sensitive findings. M6 protects destinations (Webhook, Syslog variants) from receiving cleartext values at known sensitive paths while preserving checkpoint semantics on the original enriched event.

---

## Non-Goals (Forbidden in M6)

The following are **out of scope** and must not appear in M6 design or implementation:

| Forbidden | Notes |
|-----------|--------|
| Policy Engine | No conditional rule DSL, priority chains, or cross-stream policies |
| Routing Engine | No route selection or delivery path changes |
| Destination Failover | Unchanged route failure policies (`specs/004-delivery-routing/spec.md`) |
| Tokenization | No reversible tokens, external token store, or vault integration |
| AI Detection | No LLM or external classification APIs |
| Regex Replace | No regex-based transform stage (see Advanced Transform policy) |
| External Vault | No HSM/KMS tokenization backends |

M6 is **masking only**: Full Mask, Partial Mask, Hash.

---

## 1. M6 Scope

### In scope

- Stream-scoped protection rules persisted in `stream_protection_rules`
- Runtime application: **one in-memory pass** after M5 sensitive detection, **immediately before** route fan-out
- Outbound copy masking; original enriched events used for checkpoint cursor fields
- Operator workflow: acknowledged M5 finding → create rule → optional resolve `protection_applied`
- False positive resolve on sensitive finding; linked rule disabled or removed
- APIs: list rules, summary, create rule, patch rule, sensitive finding resolve
- UI: Runtime Detail Protection Summary + Rule Table; Sensitive panel Apply / False positive
- Preview parity: same protection engine on draft/final-event and pipeline-debug delivery preview stages (read-only, no DB commit)
- Feature flag: `GDC_PROTECTION_ENABLED` (default `true` in production templates; tests may disable)
- Structured observability: field keys and counts only — **never** cleartext sensitive values in logs or `delivery_logs`

### Out of scope (M6)

- Per-destination or per-route different mask modes
- Automatic rule creation from `open` findings without operator acknowledge + apply
- Masking on raw extracted events (schema observation namespace)
- Changing M5 detection rules or confirm gates
- Masking connector/source/destination **configuration** APIs (existing `mask_secrets` remains separate)
- Durable queue / Delivery Worker changes (`specs/048-runtime-reliability/spec.md`)

---

## 2. Architecture

### Pipeline position (normative)

```text
Source
  → Rate Limit
  → Extract
  → Schema Observation (M1, raw events, non-blocking)
  → Mapping
  → Enrichment
  → Sensitive Detection (M5, non-blocking, DB signals only)
  → Protection Engine (M6, outbound copy mutation)
  → Route Fan-out
  → Formatter (per destination, inside send)
  → Destination Send
  → Checkpoint (after successful delivery ACK)
  → Logs
```

**Placement rule:** Protection runs in `StreamRunner` after `_collect_and_transform_events` returns enriched events and **before** `_fan_out`. Conceptually: **Sensitive Detection 이후, Fan-out 직전, Stream 단위 1회**.

### Data planes

| Plane | Content | M6 behavior |
|-------|---------|-------------|
| Enriched (internal) | Post-enrichment event dict | Unmodified for checkpoint extraction (`s3_key`, `gdc_db_watermark`, etc.) |
| Outbound (delivery) | Deep copy (or COW) of enriched batch | Masked per enabled `stream_protection_rules` |
| M5 findings DB | Paths/classes, no values | Unchanged; rules reference `source_finding_id` |

### Component boundaries

| Module | Responsibility |
|--------|----------------|
| `app/protection/` (new) | Rule load, path walk, mode applicators, batch API |
| `app/protection/operator_workflow.py` | Create/patch rules, link to findings |
| `StreamRunner` | Invoke `protect_events_for_delivery(enriched) → delivery_events`; pass `delivery_events` to `_fan_out`; keep `enriched` for checkpoint |
| `preview_service` / pipeline-debug | Call same `protect_events_for_delivery` before format/delivery preview |
| `app/runtime/router.py` | REST endpoints under `/streams/{stream_id}/protection-*` |

### Fan-out and destinations

- All routes on a Stream receive the **same** masked `delivery_events` list (MVP).
- Destination types in MVP: `WEBHOOK_POST`, `SYSLOG_UDP`, `SYSLOG_TCP`, `SYSLOG_TLS` (and legacy `SYSLOG_*` aliases) — masking applies to the event dict **before** formatters serialize to wire JSON/text.
- No destination-specific protection configuration in M6.

### Failure philosophy

- **Field-level failure must not fail the event:** unknown path, type mismatch, or applicator error → skip field, emit structured warning (`stage: protection`), continue batch.
- **Stream-level kill-switch:** when `GDC_PROTECTION_ENABLED=false`, skip protection entirely (pass-through enriched copy to delivery).

---

## 3. Protection Modes

Normative mode values stored in `protection_mode`:

| DB / API value | Name | Behavior |
|----------------|------|----------|
| `full_mask` | Full Mask | Replace scalar value at `field_path` with a fixed sentinel. String → `********` (8 asterisks, same as platform secret mask). Number → `null`. Boolean → `false`. `null` → `null`. Object/array at leaf path: replace entire node with `{}` or `[]` matching inferred JSON type from path walk when unambiguous; otherwise `{}`. |
| `partial_mask` | Partial Mask | **Strings only.** If value is not a string, fall back to `full_mask` for that occurrence. Email-shaped (`local@domain`): mask local part to first char + `***`, domain to first char of labels + `***` before TLD. Phone-shaped (digits length ≥ 7): keep last 4 digits visible, prefix `***`. Default string: if length ≤ 4 → `********`; else show last 4 chars, prefix `***`. |
| `hash` | Hash | **Strings only** (non-string → `full_mask`). Output: lowercase hex `HMAC-SHA256(key, utf-8(value))` where `key` is per-stream salt (see Configuration). Prefix log/UI label: `sha256:` + hex. Same value + same salt → same digest (correlation possible by design). |

**Tokenization** is not a mode and must not be added as an alias in M6.

### Default mode when creating a rule from a finding

Suggested default (operator may override on create):

| `sensitivity_class` | Default `protection_mode` |
|---------------------|---------------------------|
| `secret` | `full_mask` |
| `pii` | `partial_mask` |
| `security_metadata` | `full_mask` |

`detection_method` and `finding_json.matched_rule` do **not** select mode automatically; they are copied into API read models for audit/UI only.

### Path semantics

- `field_path` uses the **same namespace and walker** as M5 sensitive detection and schema observation (enriched event, `$` root, `.` segments, `[]` for array traversal).
- One enabled rule per `(stream_id, field_path)`; if M5 has multiple classes for the same path, operator creates one rule per class is **not** allowed by unique constraint — operator must pick one class/mode per path (document in UI copy).

### Configuration (settings)

| Setting | Purpose |
|---------|---------|
| `GDC_PROTECTION_ENABLED` | Master enable |
| `GDC_PROTECTION_MAX_DEPTH` | Align with `GDC_SENSITIVE_DETECTION_MAX_DEPTH` default 64 |
| `GDC_PROTECTION_MAX_PATHS` | Align with sensitive max paths default 5000 |
| `GDC_PROTECTION_MAX_EVENTS_PER_RUN` | Align with sensitive max events default 500 |
| `GDC_PROTECTION_HMAC_SECRET` | Platform secret for hash salt composition: `HMAC(key, f"{stream_id}:{stream_salt}")` where `stream_salt` is stable per stream (e.g. stream id + created_at hash) — exact formula fixed at implementation time and documented in operator docs |

---

## 4. DB Schema

### Table: `stream_protection_rules`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `INTEGER` PK | autoincrement |
| `stream_id` | `INTEGER` FK → `streams.id` | `ON DELETE CASCADE`, indexed |
| `field_path` | `TEXT` | not null |
| `sensitivity_class` | `VARCHAR(32)` | not null; values: `secret`, `pii`, `security_metadata` |
| `protection_mode` | `VARCHAR(16)` | not null; `full_mask`, `partial_mask`, `hash` |
| `enabled` | `BOOLEAN` | not null, default `true` |
| `source_finding_id` | `INTEGER` FK → `stream_sensitive_findings.id` | nullable, `ON DELETE SET NULL` |
| `created_by` | `VARCHAR(128)` | not null |
| `created_at` | `TIMESTAMPTZ` | not null |
| `updated_at` | `TIMESTAMPTZ` | not null |

**Unique constraint:** `(stream_id, field_path)` — name: `uq_stream_protection_rules_stream_path`

### Related tables (unchanged)

- `stream_sensitive_findings` — M5; add operator resolve usage only (no schema change required beyond existing `resolution`, `resolved_at`, `resolved_by`, `operator_note` columns if already present from M5 migration)

### Resolution enum (M5, used by M6)

- `false_positive` — disable/delete linked rule; finding `resolved`
- `protection_applied` — finding `resolved` after successful rule create (or concurrently)

---

## 5. API

Base path: `/api/v1/runtime/streams/{stream_id}/...` (consistent with M4/M5 sensitive and drift endpoints).

Auth: same as M5 acknowledge — operators with stream runtime control permission (RBAC-lite Administrator / equivalent write role).

### `GET /streams/{stream_id}/protection-rules`

- Returns all rules for stream (default: include `enabled` and `disabled`; optional query `enabled_only=true`).
- Response entry fields: `id`, `stream_id`, `field_path`, `sensitivity_class`, `protection_mode`, `enabled`, `source_finding_id`, `created_by`, `created_at`, `updated_at`, optional denormalized `detection_method`, `matched_rule` from linked finding when `source_finding_id` set.

### `GET /streams/{stream_id}/protection/summary`

- `stream_id`
- `protection_enabled` (from `GDC_PROTECTION_ENABLED`)
- `enabled_rule_count`, `disabled_rule_count`
- `by_mode`: counts for `full_mask`, `partial_mask`, `hash`
- `by_class`: counts per `sensitivity_class` (enabled rules only)
- `last_run_masked_field_count` (optional observability from latest run obs snapshot if persisted in memory only, may be null on API)

### `POST /streams/{stream_id}/protection-rules`

Request body:

```json
{
  "field_path": "$.user.email",
  "sensitivity_class": "pii",
  "protection_mode": "partial_mask",
  "source_finding_id": 123,
  "enabled": true
}
```

Rules:

- `source_finding_id` **required** for MVP create-from-finding flow; finding must belong to same `stream_id`, status `acknowledged`, `confirm_run_count >= GDC_SENSITIVE_DETECTION_CONFIRM_RUNS`.
- If `(stream_id, field_path)` already exists → `409 Conflict`.
- On success: insert rule; recommend client call resolve `protection_applied` or server optionally auto-resolve finding in same transaction (implementation choice; spec requires **at least one** of: paired resolve endpoint call or atomic resolve in POST).

### `PATCH /streams/{stream_id}/protection-rules/{rule_id}`

- Allowed: `protection_mode`, `enabled`, `sensitivity_class` (discouraged after create; allowed for operator correction only).
- Not allowed: `field_path`, `stream_id` (immutable).
- `404` if rule not found for stream.

### `POST /streams/{stream_id}/sensitive-findings/{finding_id}/resolve` (M6 — required)

Request body:

```json
{
  "resolution": "false_positive",
  "note": "optional operator note"
}
```

Allowed `resolution` values: `false_positive`, `protection_applied` (others existing in M5 model such as `accepted_risk` are **not** required in M6 UI).

Behavior:

- Finding must be `acknowledged` (or `open` with confirm gate satisfied — normative: **`acknowledged` only** for resolve to match apply flow).
- `false_positive`: set finding `resolved`, disable linked rule (`enabled=false`) if `source_finding_id` match exists.
- `protection_applied`: set finding `resolved`; rule must already exist for same `field_path` or be created in same session (validate rule exists).

Response: updated finding entry (no sensitive values).

### Errors (common)

| Code | Condition |
|------|-----------|
| 400 | Invalid mode/class/path; finding not acknowledged |
| 404 | Stream/finding/rule not found |
| 409 | Duplicate `(stream_id, field_path)` |

---

## 6. Runtime Behavior

### StreamRunner sequence

1. Complete mapping, enrichment, M5 `detect_sensitive_fields` (unchanged).
2. Let `enriched_events` be the batch returned from transform.
3. If `GDC_PROTECTION_ENABLED` and stream has ≥1 enabled rule:  
   `delivery_events = protect_batch(enriched_events, rules)`  
   else `delivery_events = shallow_copy(enriched_events)` per event.
4. `_fan_out(runtime_stream, delivery_events)`.
5. On delivery success, `_update_checkpoint_after_success(successful_events=enriched_events)` — **not** masked copy.

### `protect_batch` contract

- Input: list of enriched event dicts, enabled rules for `stream_id`.
- Output: new list of dicts (deep copy at event root; mutate only targeted paths).
- Per event, per enabled rule: walk to `field_path`, apply mode; count `masked_field_applications`.
- On applicator error: log `stage=protection`, `status=FIELD_PROTECTION_WARNING`, include `field_path`, `rule_id`, `error_message` — **exclude** `value`, `sample`, `raw`, `payload`.
- Emit obs: `stage=protection_complete`, `stream_id`, `rules_applied`, `masked_field_applications`, `warning_count`, `duration_ms`.

### Delivery payload guarantee

- Bytes on wire (Webhook JSON, Syslog line JSON) are built from `delivery_events` only.
- **Normative:** no cleartext substring of a masked path’s pre-mask value appears in serialized delivery payload for that run.

### Failure logs and replay

- `route_send_failed` / retry payloads must not embed cleartext sensitive values at protected paths.
- Normative M6: `replay_events` in failure logs use **masked** delivery copy or omit event bodies (prefer masked copy for operability).
- `last_success_event` in checkpoint uses **enriched** unmasked event (existing watermark fields); operators must treat checkpoint DB as **internal operational data** with same access controls as today.

### Preview and pipeline-debug

- After enrichment (and optional M5 dry-run off in preview), run `protect_batch` with current DB rules before `run_format_preview` / route delivery preview.
- No `delivery_logs` writes; no checkpoint updates.

### Transaction boundaries

- Rule CRUD commits in API request transaction (standard FastAPI session).
- Protection application is **in-memory only** during run; no per-field DB writes during mask.

---

## 7. UI

### Runtime Detail page

**Protection Summary** card (`data-testid=protection-summary`):

- `protection_enabled` flag
- Enabled / disabled rule counts
- Counts by mode and class
- Link to rule table section

**Protection Rule Table** (`data-testid=protection-rules-table`):

- Columns: field_path, sensitivity_class, protection_mode, enabled, source finding id, created_by, updated_at
- Actions: enable/disable toggle (PATCH), mode dropdown (PATCH) — requires runtime control permission

### Sensitive Findings panel (extend M5)

For each **acknowledged** finding:

- **Apply protection** — opens minimal modal: `protection_mode` (default from class), confirm → POST protection-rules with `source_finding_id` → optional resolve `protection_applied`
- **Mark false positive** — POST resolve `false_positive` with note

Open findings: no apply button (must acknowledge first).

### Not in M6 UI

- Stream wizard dedicated Protection step
- Per-destination protection toggles
- Policy editor / rule priority UI

---

## 8. Operator Workflow

```text
M5 detects → open finding (confirm runs)
       → operator Acknowledge
       → operator Apply protection (POST rule) → enabled rule
       → optional Resolve protection_applied
       → subsequent runs mask outbound paths

Alternative:
       → Acknowledge → Mark false positive → resolve + disable rule
```

| Step | System state |
|------|----------------|
| Detection | `stream_sensitive_findings.status=open` |
| Acknowledge | `acknowledged`; no rule yet |
| Apply protection | `stream_protection_rules.enabled=true`, linked `source_finding_id` |
| Resolve `protection_applied` | finding `resolved` |
| False positive | finding `resolved`, rule `enabled=false` |

Re-open semantics: follow M5 upsert rules (resolved findings are not re-opened by detection upsert).

---

## 9. Testing Plan

Documentation-only plan for implementers; tests are added in the implementation milestone, not in this spec commit.

### Unit tests

- Mode applicators: `full_mask`, `partial_mask`, `hash` on representative strings, numbers, nested paths, arrays
- Path walker alignment with M5 paths (`$.a`, `$.items[].id`)
- `protect_batch` skip-on-error does not drop events
- Rule CRUD validation and unique constraint

### Integration tests

- StreamRunner: enriched checkpoint field unchanged when delivery masked
- Webhook E2E: WireMock receives JSON without cleartext email/token at protected path
- Syslog E2E: line payload masked
- Feature flag off: byte-identical delivery to pre-M6 behavior for same fixture stream without rules

### API tests

- POST rule requires acknowledged finding
- PATCH enable/disable
- Resolve false positive disables rule
- 409 duplicate path

### Preview tests

- Final-event / E2E draft preview output matches runtime mask for same sample + rules

### Performance smoke

- 500 events, 20 rules: run completes; protection `duration_ms` logged; no timeout regression beyond 10% baseline (CI optional threshold)

---

## 10. Exit Criteria

M6 is **done** when all of the following pass:

### Mode verification

1. **Full Mask:** Given `secret` path with string value, Webhook/Syslog delivery payload contains `********` (or specified sentinel) and not the original string.
2. **Partial Mask:** Given `pii` email/phone paths, delivery shows partial pattern per §3 definitions; non-string at path uses full mask fallback.
3. **Hash:** Given `hash` mode, delivery shows `sha256:` + 64 hex chars; identical input produces identical digest under same stream salt.

### Checkpoint

4. After successful delivery, checkpoint `last_success_event` (and derived watermark fields) reflect **pre-mask enriched** values used for polling progression; masking does not corrupt `s3_key`, `gdc_db_watermark`, or equivalent cursor fields in fixtures.

### Delivery safety

5. Serialized delivery payload for protected paths contains **no cleartext** of the pre-mask value (automated assertion in E2E).

### Regression

6. `GDC_PROTECTION_ENABLED=false`: M1–M5 behavior and delivery bytes unchanged vs baseline fixtures (no rules applied).
7. With protection on but **zero** enabled rules, delivery identical to pre-M6.

### Operator

8. Acknowledged finding → POST rule → next run masks; resolve `protection_applied` reflected in API.
9. False positive resolve → rule disabled; path no longer masked on subsequent runs.

### Observability

10. No test or manual inspection finds cleartext sensitive values in `delivery_logs`, protection warnings, or support-bundle samples for masked paths.

---

## 11. M7+ Excluded Scope

Deferred explicitly to later milestones:

| Topic | Reason |
|-------|--------|
| Tokenization / external vault | Requires secret store and reverse lookup |
| Policy Engine | Conditional masking, rule priorities, org-wide templates |
| Per-destination protection profiles | Complicates fan-out and operator model |
| Routing / failover integration | Separate reliability milestone |
| Auto-mask on `open` findings | Operator intent not confirmed |
| AI-assisted rule suggestions | Forbidden by platform transform policy |
| Regex replace / advanced JSONata mask | Advanced Transform stage separation |
| Masking raw/schema observation namespaces | Different trust boundary |
| Historical replay re-mask of `delivery_logs` | Retention/backfill concern |
| Cross-stream rule libraries | Enterprise policy feature |

---

## References

- `specs/002-runtime-pipeline/spec.md` — checkpoint after delivery, transaction policy
- `specs/004-delivery-routing/spec.md` — fan-out and destination types
- `specs/047-pipeline-debugger/spec.md` — preview extension point
- M5 implementation: `app/sensitive_detection/` — path rules, finding model, acknowledge API
- Constitution: checkpoint only after successful destination delivery; Stream as execution unit

## Changelog

| Date | Change |
|------|--------|
| 2026-06-04 | Initial M6 MVP implementation specification |
