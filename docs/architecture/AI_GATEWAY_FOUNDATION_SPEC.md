# AI Gateway Foundation — Architecture Definition (M21.0)

**Status:** Design only (no implementation)  
**Baseline:** OSS v1.0.0 (`v1.0.0`)  
**Authority:** `.specify/memory/constitution.md`, `specs/001-core-architecture/spec.md`, `specs/002-runtime-pipeline/spec.md`, `specs/004-delivery-routing/spec.md`  
**UX alignment:** DATA-RELAY-UX-CHARTER (operator vocabulary over engine vocabulary)

---

## 1. Executive Summary

AI Gateway Foundation (M21) introduces **AI traffic control** as a first-class operator surface while **reusing the existing Stream runtime** end-to-end. No parallel AI runtime, no StreamRunner fork, and no new orchestration engine.

M21 delivers:

- **AI Provider** configuration (vendor endpoints and credentials)
- **AI Stream** operator model (AI-scoped stream setup)
- **AI Destination** adapter(s) (provider wire protocol)
- **AI Traffic Routing** via existing Route fan-out

M21 explicitly **does not** deliver prompt/response inspection, AI policy, AI governance, or AI audit — those are M22–M24.

### Architecture Ready (design phase)

| Question | Answer |
|----------|--------|
| Can AI Gateway reuse existing Stream runtime? | **Yes** — via Source + Destination plugin adapters and existing Mapping → Enrichment → Route → Destination → Checkpoint pipeline |
| New runtime required? | **No** |
| StreamRunner changes in M21? | **None to orchestration** — only adapter registry extensions |

---

## 2. Existing Architecture Review

### 2.1 Current pipeline (authoritative)

```text
StreamRunner
  → Source fetch (SourceAdapterRegistry)
  → Event extraction
  → Mapping
  → Enrichment
  → Protection / Classification / Policy (governance pipeline — unchanged in M21)
  → Dynamic routing resolution (additive destinations)
  → Route fan-out
  → Destination send (DestinationAdapterRegistry)
  → Failover (primary → secondary, eligible errors)
  → Checkpoint (only after successful delivery ACK)
  → Structured delivery_logs
```

References: `specs/002-runtime-pipeline/spec.md`, `app/runners/stream_runner.py`, `specs/067-failover-routing/spec.md`, `specs/068-replay-engine/spec.md`.

### 2.2 Entity model today

| Entity | Role | AI Gateway relevance |
|--------|------|----------------------|
| **Stream** | Execution unit | AI Stream maps 1:1 to a Stream row |
| **Source** | Ingress adapter config | AI request ingress (webhook or AI-proxy source) |
| **Mapping** | Field transform | Shape provider request bodies |
| **Enrichment** | Static/advanced rules | Inject model, tenant, trace, routing hints |
| **Route** | Stream → Destination link | AI traffic routing |
| **Destination** | Egress adapter config | AI provider send target |
| **Checkpoint** | Post-delivery cursor | Advances after provider ACK |
| **Replay** | Failed delivery recovery | Re-sends stored protected payload |
| **Failover** | Active/standby egress | Primary AI provider → secondary provider |
| **Dynamic Routing** | Additive destination selection | Optional; classification-driven rules deferred to M22+ |

### 2.3 Existing AI Gateway code (legacy MVP — out of M21 scope)

The repository contains `app/ai_gateway/` — a **standalone REST surface** (`/api/v1/ai-gateway/*`) with:

- Prompt inspection (`inspection.py`)
- Gateway policies (`ai_gateway_policies`)
- Request audit (`ai_gateway_requests`)
- Mock provider (`invoke_mock_provider`)
- Governance integration (blocks, quarantine hooks)

This path is **not integrated with StreamRunner**. It is hidden from OSS production nav (`VITE_OSS_RELEASE_MODE`) and classified as governance-era MVP.

**M21 foundation decision:** New AI traffic flows through **Stream pipeline + adapters**. The standalone `app/ai_gateway` module is **frozen** in M21 (no expansion). Inspection/policy/governance features migrate conceptually to M22–M24, potentially consuming Stream `delivery_logs` rather than a separate request table.

### 2.4 Runtime reuse verdict

| Capability | Reuse existing runtime? | Mechanism |
|------------|-------------------------|-----------|
| Stream execution | ✅ Yes | Same `StreamRunner.run()` |
| Mapping / Enrichment | ✅ Yes | Same engines; AI-specific field contracts documented |
| Multi-destination | ✅ Yes | Route fan-out unchanged |
| Failover | ✅ Yes | `stream_failover_routes` between AI provider destinations |
| Dynamic routing | ✅ Yes (base routes in M21) | Additive rules optional; AI-policy-driven routing → M22+ |
| Replay | ✅ Yes | Provider send failures record `stream_replay_events` |
| Checkpoint | ✅ Yes | Provider delivery success triggers checkpoint |
| Rate limits | ✅ Yes | Separate source and destination rate limits preserved |

**Conclusion:** AI Gateway Foundation **does not require a new runtime**. It requires **adapter extensions** and **operator-facing configuration entities** only.

---

## 3. Scope

### 3.1 In scope (M21)

| Area | Deliverable (future implementation) |
|------|-------------------------------------|
| **AI Provider** | Vendor abstraction, credential storage contract, connectivity probe |
| **AI Stream** | Operator workflow to create AI ingress + routes + provider destinations |
| **AI Destination** | New `destination_type` family for LLM provider wire protocols |
| **AI Traffic Routing** | Route configuration, fan-out, optional failover between providers |
| **Ingress** | AI HTTP request acceptance bound to Stream context |
| **Observability** | Reuse `delivery_logs` stages (`source_fetch`, `mapping`, `enrichment`, `route_send`, …) |

### 3.2 Non-scope (M22–M24)

| Feature | Milestone |
|---------|-----------|
| Prompt inspection | M22 |
| Response inspection | M22 |
| AI policy engine | M23 |
| AI governance surfaces | M23 |
| AI audit trail (dedicated) | M24 |
| AI quarantine / block actions | M23+ |
| Classification-driven dynamic AI routing | M22+ |
| Prompt/response PII scanning | M22+ |
| Cost/token governance | M24+ |

### 3.3 Non-scope (general)

- New StreamRunner or DeliveryWorker
- AI transform in Mapping/Enrichment (constitution forbids arbitrary code / external AI APIs in transform engine)
- Merging Mapping and Enrichment stages
- Breaking existing HTTP/Syslog/Webhook destinations
- Enterprise SKU split

---

## 4. Runtime Model

### 4.1 Principle: no new runtime

```text
AI Request (ingress)
  ↓
Mapping
  ↓
Enrichment
  ↓
[existing governance stages — pass-through in M21]
  ↓
Route fan-out (+ optional failover)
  ↓
AI Provider Destination send
  ↓
Checkpoint (on ACK)
  ↓
delivery_logs
```

This is **identical** to `specs/002-runtime-pipeline/spec.md` with AI-specific adapters at ingress and egress.

### 4.2 Ingress model (AI Request → Source fetch)

**Recommended M21 approach:** extend Source adapter registry; do **not** add a parallel HTTP server inside StreamRunner.

| Option | Description | M21 choice |
|--------|-------------|------------|
| A. `WEBHOOK_RECEIVER` reuse | Clients POST to existing webhook ingest; payload stored in `__gdc_webhook_payload`; StreamRunner fetch returns it | ✅ **Phase 1 compatible** — zero new source type for MVP |
| B. `AI_PROXY_RECEIVER` source | Dedicated ingest path with AI-specific request normalization (OpenAI-compatible paths, SSE passthrough flags) | ✅ **Phase 2** — cleaner operator model |
| C. Standalone `/ai-gateway/*` evaluate | Current `app/ai_gateway` pattern | ❌ **Deprecated for traffic path** |

**Normalized AI request event** (post-extraction, pre-mapping):

```json
{
  "ai": {
    "request_id": "uuid",
    "method": "POST",
    "path": "/v1/chat/completions",
    "headers": { "content-type": "application/json" },
    "body": { },
    "client_ip": "10.0.0.1",
    "received_at": "2026-06-08T00:00:00Z"
  }
}
```

Mapping transforms `ai.body` → provider-specific request envelope. Enrichment adds `model`, `provider_hint`, `tenant_id`, `trace_id`.

### 4.3 Egress model (Destination → AI Provider)

New destination family:

```text
destination_type: AI_PROVIDER_POST   (M21 canonical)
```

Provider dispatch:

```text
adapter = DestinationAdapterRegistry.get("AI_PROVIDER_POST")
result = adapter.send(destination, enriched_event, provider_binding)
```

Adapter internally selects vendor implementation via `provider_kind` on linked `ai_providers` row or inline `config_json.provider_kind`.

### 4.4 Checkpoint and delivery semantics

Unchanged constitution rules:

- Checkpoint advances **only** after successful provider delivery (HTTP 2xx from provider, or vendor-defined success).
- Provider timeout / 5xx → route failure policy applies.
- HTTP 429 → existing rate-limit behavior (not failover-eligible per `specs/067-failover-routing/spec.md`).
- `LOG_AND_CONTINUE` vs `PAUSE_STREAM_ON_FAILURE` semantics unchanged.

### 4.5 Replay interaction

Per `specs/068-replay-engine/spec.md`:

- Provider send failure after failover exhaustion → `stream_replay_events` row with `protected_payload_json`.
- Replay resends **stored payload** through destination adapter only — no mapping/enrichment re-run.
- Suitable for AI provider transient outages.
- Checkpoint **never** updated on replay (unchanged).

### 4.6 Failover interaction

Per `specs/067-failover-routing/spec.md`:

- Configure `stream_failover_routes` with `primary_destination_id` = OpenAI endpoint, `secondary_destination_id` = Azure OpenAI standby.
- Eligible: connect errors, timeouts, provider 5xx.
- Primary fail + secondary success → route treated as success for checkpoint.

### 4.7 Dynamic routing interaction

M21: **base routes only** (operator-configured provider destinations).

M22+: optional additive destinations based on inspection/classification findings. Dynamic routing engine (`app/dynamic_routing/`) remains compatible but **not required** for M21 GA.

---

## 5. Provider Abstraction

### 5.1 Design goals

- **Vendor-agnostic** operator config (Provider entity)
- **Protocol-specific** adapters (OpenAI-compatible vs native Anthropic messages)
- **No outbound network** in Mapping/Enrichment Safe Expression Engine (unchanged)
- **Outbound network only** in Destination adapter `send()` — same boundary as `WEBHOOK_POST`
- **Deterministic tests** via mock adapter (no live API keys in CI)

### 5.2 Provider kinds (M21 target set)

| `provider_kind` | Wire style | Notes |
|-----------------|------------|-------|
| `openai` | OpenAI Chat Completions / Responses | API key auth |
| `azure_openai` | Azure deployment URL + api-version | API key or Azure AD (AD → post-M21) |
| `anthropic` | Messages API | `x-api-key` + `anthropic-version` |
| `google_gemini` | Generative Language API | API key / Vertex (Vertex → post-M21) |
| `ollama` | Local OpenAI-compatible `/api/chat` | No auth default |
| `vllm` | OpenAI-compatible inference server | Bearer optional |

### 5.3 Conceptual adapter interface (not implemented in M21.0)

```text
AiProviderAdapter (ABC)
  provider_kind: str

  validate_config(config_json, auth_json) -> None
  build_http_request(enriched_event, destination_config, provider_config) -> ProviderHttpRequest
  send(request, *, timeout_seconds) -> ProviderSendResult
  normalize_response(raw_response) -> dict   # for delivery_logs + optional client response path
```

Registry:

```text
AiProviderAdapterRegistry.get(provider_kind) -> AiProviderAdapter
```

**Composition:** `AI_PROVIDER_POST` destination adapter delegates to `AiProviderAdapterRegistry` — mirrors `DestinationAdapterRegistry` → syslog/webhook pattern in `specs/001-core-architecture/spec.md`.

### 5.4 Credential model

- Secrets stored in `auth_json` on `ai_providers` (encrypted at rest — same contract as connector credentials).
- Destinations reference `provider_id` or embed `provider_kind` + endpoint override.
- Never log raw API keys; `delivery_logs` record `provider_kind`, `model`, `status_code`, `latency_ms` only.

### 5.5 Response path (M21 minimal)

M21 foundation focuses on **forwarding** AI requests to providers via async Stream execution. Synchronous client proxy response (SSE streaming) is a **design consideration** for implementation spec:

| Mode | Behavior |
|------|----------|
| Async fire-and-log | Ingress returns 202; client polls/logs for outcome | Simplest; fits polling Stream model |
| Sync proxy | Ingress holds connection until provider responds | Requires webhook/proxy ingress extension |

**M21 recommendation:** Document both; implement **sync proxy for chat completions** as default operator expectation, backed by ingest handler outside StreamRunner (handler enqueues payload → triggers single Stream run → returns provider response). Still **one StreamRunner transaction** for transform + send.

---

## 6. UX Model (DATA-RELAY-UX-CHARTER)

### 6.1 Charter principles applied

Operators think in **data-control vocabulary**, not engine internals:

| Show (operator) | Hide (engine) |
|-----------------|---------------|
| **Provider** — vendor, endpoint, model default | Provider adapter registry, HTTP client internals |
| **AI Stream** — named traffic lane | `StreamRunner`, scheduler, worker threads |
| **Traffic** — volume, success/fail, latency | Route fan-out algorithm, failover state machine |
| **Destination** (labeled "Provider endpoint" in AI context) | `destination_type` enum, adapter class names |
| **Routes** — which provider serves which stream | Internal routing table IDs |

### 6.2 Navigation (proposed)

```text
Sidebar (new section)
  AI Gateway
    Providers        → list/create AI providers
    AI Streams       → list/create AI streams (wizard)
    Traffic          → aggregated metrics from delivery_logs + stream status
```

**Not exposed:** Runtime topology for AI internals, pipeline debug, adapter registry, mock provider toggles.

### 6.3 AI Stream wizard (operator steps)

| Step | Operator label | Backend binding |
|------|----------------|-----------------|
| 1 | Choose Provider | `ai_providers` + default destination scaffold |
| 2 | Configure Traffic | Ingress URL/token, rate limits |
| 3 | Map Request | Mapping UI (JSONPath on `ai.body`) |
| 4 | Enrich | Optional model/tenant/trace enrichment |
| 5 | Route | Link to provider destination(s); optional standby |
| 6 | Review & Enable | Enable Stream, show traffic endpoint |

Wizard creates or binds: `connectors`, `sources`, `streams`, `mappings`, `enrichments`, `destinations`, `routes` — same persistence model as OSS v1 stream wizard.

### 6.4 OSS vs internal surfaces

| Surface | OSS v1.0 | Post-M21 |
|---------|----------|----------|
| Standalone `/governance/ai` (legacy MVP) | Hidden | Deprecate redirect → new AI Gateway section |
| AI policy cards on governance dashboard | Hidden until M23 | Progressive enable |

---

## 7. Entity Draft (no DB creation in M21.0)

### 7.1 `ai_providers` (new table — implementation M21+)

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `name` | varchar(128) | Operator label |
| `provider_kind` | varchar(32) | `openai`, `azure_openai`, `anthropic`, `google_gemini`, `ollama`, `vllm` |
| `enabled` | boolean | |
| `config_json` | jsonb | `base_url`, `default_model`, `api_version`, `deployment_name`, timeouts |
| `auth_json` | jsonb | Encrypted credentials |
| `rate_limit_json` | jsonb | Optional destination rate policy seed |
| `created_at` / `updated_at` | timestamptz | |

**Relationships:**

- One provider → many destinations (optional FK `destinations.provider_id` additive column) OR destinations embed `provider_id` in `config_json` for M21 to avoid destinations schema churn — **implementation choice in M21.1**.

### 7.2 `ai_streams` (new table — operator facade)

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `stream_id` | int FK → `streams.id` UNIQUE | 1:1 execution binding |
| `name` | varchar(128) | Operator display name (may mirror stream.name) |
| `provider_id` | int FK → `ai_providers.id` nullable | Primary provider hint |
| `ingress_mode` | varchar(32) | `webhook` \| `ai_proxy` |
| `ingress_config_json` | jsonb | Public path slug, auth token hash, allowed methods |
| `traffic_profile_json` | jsonb | Model override, timeout, retry hints for UI |
| `enabled` | boolean | |
| `created_at` / `updated_at` | timestamptz | |

**Why not overload `streams` alone?** UX charter requires **AI Stream** as a distinct operator object without exposing stream internals. `ai_streams` is a thin facade; **execution remains `streams.id`**.

### 7.3 Existing tables (reused, no renames)

| Table | M21 usage |
|-------|-----------|
| `streams` | Execution unit |
| `sources` | Ingress config (`WEBHOOK_RECEIVER` or `AI_PROXY_RECEIVER`) |
| `mappings` / `enrichments` | Request shaping |
| `destinations` | `AI_PROVIDER_POST` rows |
| `routes` | Traffic routing |
| `stream_failover_routes` | Provider standby |
| `stream_replay_events` | Failed provider delivery recovery |
| `checkpoints` | Unchanged semantics |
| `delivery_logs` | Primary observability |

### 7.4 Entities explicitly not created in M21

- `ai_gateway_policies` expansion (frozen)
- `ai_inspection_results` (M22)
- `ai_audit_events` (M24)

---

## 8. Risk Analysis

### 8.1 Risk matrix

| Risk | Level | Mitigation |
|------|-------|------------|
| **Dual AI architectures** (legacy `app/ai_gateway` vs Stream pipeline) | **MEDIUM** | M21 spec declares Stream pipeline authoritative; legacy frozen and nav-deprecated |
| **Stream reuse breaks constitution** | **LOW** | Plugin adapter extension only; no StreamRunner orchestration edits |
| **Multi-destination fan-out to multiple providers** | **LOW** | Existing route model; document cost/latency implications for operators |
| **Replay stores provider payloads with secrets** | **MEDIUM** | Reuse protection engine masking before replay storage (existing pipeline) |
| **Failover between heterogeneous providers** | **MEDIUM** | Request shape may differ; mapping must emit provider-neutral or per-destination formatted payloads — document limitation |
| **Checkpoint conflation on partial multi-route success** | **LOW** | Unchanged spec: all required routes must succeed |
| **Sync SSE streaming** | **HIGH** (if required day-1) | Defer streaming to M21.1 implementation spec; M21 foundation supports non-streaming completions first |
| **Provider latency >> webhook timeout** | **MEDIUM** | Separate `AI_PROVIDER_POST` timeout defaults (e.g. 120s) in destination config |
| **Credential sprawl** | **MEDIUM** | Single `ai_providers` credential store; destinations reference by ID |
| **OSS surface creep** | **LOW** | Feature-flag `VITE_AI_GATEWAY_FOUNDATION` default false until ready |

### 8.2 Existing Stream reuse — detailed assessment

| Question | Assessment |
|----------|------------|
| Can Mapping run on AI JSON bodies? | Yes — same JSONPath/JSONata engine on `ai.body` |
| Can Enrichment add model/tenant fields? | Yes — static/advanced rules |
| Can WEBHOOK_RECEIVER ingest AI POST? | Yes — proven ingest pattern |
| Can new destination type send to OpenAI? | Yes — same adapter registry pattern as WEBHOOK_POST |
| Does Replay break on AI payloads? | No — adapter resend only |
| Does Failover work provider → provider? | Yes — if request format compatible |
| Does Dynamic Routing need changes? | No for M21 base routes |

### 8.3 Implementation sequencing risk

Recommended M21 implementation order (future):

1. `ai_providers` CRUD + encryption
2. `AI_PROVIDER_POST` destination adapter (mock + OpenAI)
3. `ai_streams` facade + wizard
4. Ingress (webhook-compatible → AI proxy)
5. Traffic dashboard (delivery_logs aggregation)
6. Failover + replay validation tests

---

## 9. Compatibility & Migration

### 9.1 Legacy `app/ai_gateway`

| Component | M21 disposition |
|-----------|-----------------|
| `/api/v1/ai-gateway/policies` | Frozen — no new features |
| `/api/v1/ai-gateway/evaluate` | Frozen |
| `ai_gateway_requests` table | No new writes from traffic path; historical data retained |
| Governance dashboard AI blocks card | Hidden in OSS; revisit M23 |

### 9.2 Constitution compliance

| Rule | Compliance |
|------|------------|
| Connector ≠ Stream | Preserved — AI provider ≠ AI stream |
| Source ≠ Destination | Preserved |
| Stream = execution unit | Preserved |
| Route-only Stream→Destination | Preserved |
| Mapping before Enrichment | Preserved |
| Checkpoint after delivery | Preserved |
| No AI in transform engine | Preserved — provider call only in destination adapter |

---

## 10. Open Questions (for M21.1 implementation spec)

1. **Ingress default:** `WEBHOOK_RECEIVER` first vs dedicated `AI_PROXY_RECEIVER`?
2. **Sync response:** Return provider response to client synchronously or async 202?
3. **SSE streaming:** In scope for M21 implementation or M21.2?
4. **`destinations.provider_id`:** FK column vs `config_json` reference?
5. **Azure AD auth:** M21 or M22?

---

## 11. References

| Document | Relevance |
|----------|-----------|
| `specs/001-core-architecture/spec.md` | Plugin adapter extension model |
| `specs/002-runtime-pipeline/spec.md` | Pipeline order, checkpoint |
| `specs/004-delivery-routing/spec.md` | Fan-out, failure policies |
| `specs/067-failover-routing/spec.md` | Provider standby |
| `specs/068-replay-engine/spec.md` | Provider failure recovery |
| `specs/048-runtime-reliability/spec.md` | DIRECT mode default |
| `docs/release/release-readiness-audit.md` | OSS surface gating |
| `app/ai_gateway/*` | Legacy MVP (frozen) |

---

## Appendix A — M21 vs M22–M24 roadmap

```text
M21  Foundation: Provider, AI Stream, Destination, Traffic Routing (Stream runtime)
M22  Inspection: Prompt + Response inspection hooks in pipeline (pre/post destination)
M23  Policy: AI policy engine, governance surfaces, block/quarantine actions
M24  Audit: Immutable AI audit trail, compliance exports, advanced analytics
```

---

*Document version: M21.0 — design only. No code, migrations, or APIs created.*
