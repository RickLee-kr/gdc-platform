# AI Gateway Foundation — Implementation Specification (M21.1)

**Status:** Implementation spec only (no code)  
**Baseline:** M21.0 `docs/architecture/AI_GATEWAY_FOUNDATION_SPEC.md`  
**Authority:** `.specify/memory/constitution.md`, `specs/001-core-architecture/spec.md`, `specs/002-runtime-pipeline/spec.md`, `specs/004-delivery-routing/spec.md`, `specs/067-failover-routing/spec.md`, `specs/068-replay-engine/spec.md`, `specs/035-rbac-lite/spec.md`  
**Scope:** Resolves M21.0 open questions; defines contracts for M21.2–M21.4 implementation

---

## Document purpose

This specification **does not implement** anything. It locks down:

- Ingress, request, adapter, destination, sync, checkpoint, failure, credential, and RBAC models
- M21.2 / M21.3 / M21.4 build sequencing

All AI traffic MUST flow through the existing Stream pipeline (Source → Mapping → Enrichment → Route → Destination → Checkpoint). The legacy standalone `app/ai_gateway` REST path remains frozen.

---

## 1. Ingress Model

### 1.1 Options compared

| Criterion | Option A — `WEBHOOK_RECEIVER` reuse | Option B — `AI_PROXY_RECEIVER` (new) |
|-----------|-------------------------------------|--------------------------------------|
| **Description** | Clients POST to `/api/v1/ingest/webhook/{receiver_key}`; payload stored in `__gdc_webhook_payload`; `WebhookReceiver.dispatch()` runs StreamRunner | Dedicated ingest at `/api/v1/ingest/ai/{stream_slug}/…` with OpenAI-compatible paths; normalizes to `ai.*` envelope before StreamRunner |
| **Pros** | Zero new source type; proven auth, size limits, ingest logging; fastest bootstrap | Operator-native AI endpoint; sync client response path; path/method validation per AI profile; clean separation from generic webhook UX |
| **Cons** | Clients must use webhook URL shape, not OpenAI SDK defaults; sync provider response requires ad-hoc webhook handler changes; mapping must reconstruct `ai.*` from raw body | New source adapter, router, auth contract, and observability hooks; higher initial implementation cost |
| **Implementation difficulty** | **LOW** | **MEDIUM** |
| **OSS suitability** | Acceptable for internal/dev bootstrap only | **Required** for OSS AI Gateway operator promise (traffic endpoint, wizard step 2) |

Reference implementations: `app/runners/webhook_receiver.py`, `app/sources/adapters/webhook_receiver.py`, `app/ingest/router.py`.

### 1.2 Final ingress decision

**Selected: Option B — `AI_PROXY_RECEIVER`**

Rationale:

1. M21 operator UX (AI Stream wizard “Configure Traffic”) requires a **dedicated AI traffic URL**, not a generic webhook receiver key.
2. **Sync response** (Section 5) requires an ingest handler that holds the client connection until StreamRunner completes; this belongs on an AI-specific handler, not an extension of generic webhook `{ accepted: true, summary }` semantics.
3. Option A remains a **documented dev shortcut** for M21.2 integration tests only; it is **not** the GA ingress surface.

### 1.3 `AI_PROXY_RECEIVER` contract (implementation target)

| Field | Value |
|-------|-------|
| `source_type` | `AI_PROXY_RECEIVER` |
| Public paths (M21) | `POST /api/v1/ingest/ai/{stream_slug}/v1/chat/completions` |
| Auth | Bearer token **or** shared-secret header (same patterns as webhook receiver) |
| Max body | Reuse webhook default `1_048_576` bytes unless overridden in `ingress_config_json.max_request_bytes` |
| Stream binding | `ai_streams.ingress_config_json.stream_slug` → resolve Source → Stream |
| Pre-mapping event shape | Section 2 (`AiIngressEvent`) |
| StreamRunner entry | Same as webhook: inject payload into runtime `source_config`, set `source_type`, call `StreamRunner.run()` |
| Checkpoint on ingest | `persist_checkpoint=False` during handler dispatch (Section 6) |

Post-M21 path expansion (not M21 GA): `/v1/embeddings`, `/v1/responses`, provider-native Anthropic paths — registry in `ingress_config_json.allowed_paths`.

---

## 2. Request Model

### 2.1 Canonical model: `AiTrafficRequest`

Provider-agnostic logical request. Produced by ingress normalization **before** Mapping. Mapping reads from `ai.body` and may reshape for provider adapters.

```json
{
  "ai": {
    "request_id": "550e8400-e29b-41d4-a716-446655440000",
    "stream_slug": "prod-chat-east",
    "provider_hint": null,
    "method": "POST",
    "path": "/v1/chat/completions",
    "headers": {
      "content-type": "application/json",
      "authorization": "[REDACTED]"
    },
    "body": {
      "model": "gpt-4o-mini",
      "messages": [
        { "role": "user", "content": "Hello" }
      ],
      "temperature": 0.7,
      "max_tokens": 1024,
      "stream": false
    },
    "client_ip": "10.0.0.1",
    "received_at": "2026-06-08T12:00:00.000Z",
    "metadata": {
      "client_request_id": "req-abc-123",
      "tenant_id": null,
      "trace_id": "trace-xyz"
    }
  }
}
```

### 2.2 Field contract

| Field | Location | Required | Description |
|-------|----------|----------|-------------|
| `request_id` | `ai.request_id` | **Yes** | Platform-generated UUID; primary correlation ID across `delivery_logs`, replay, client error bodies |
| `stream_slug` | `ai.stream_slug` | **Yes** | Public ingress identifier |
| `provider_hint` | `ai.provider_hint` | No | Optional override; Enrichment may set; Destination resolves provider via route binding |
| `method` | `ai.method` | **Yes** | HTTP method (M21: `POST` only) |
| `path` | `ai.path` | **Yes** | Matched ingest path suffix |
| `headers` | `ai.headers` | **Yes** | Sanitized copy; secrets masked before logging |
| `body` | `ai.body` | **Yes** | Parsed JSON object (M21); reject non-JSON |
| `body.model` | `ai.body.model` | **Yes** for chat completions | Model id; may be overridden by Enrichment |
| `body.messages` | `ai.body.messages` | **Yes** for chat completions | OpenAI-style message array |
| `body.temperature` | `ai.body.temperature` | No | Float 0–2 |
| `body.max_tokens` | `ai.body.max_tokens` | No | Integer |
| `body.stream` | `ai.body.stream` | No | M21: MUST be `false` or omitted; `true` → HTTP 400 |
| `client_ip` | `ai.client_ip` | **Yes** | From reverse proxy / request |
| `received_at` | `ai.received_at` | **Yes** | ISO-8601 UTC |
| `metadata.client_request_id` | `ai.metadata` | No | Echo of client `X-Request-Id` if present |
| `metadata.tenant_id` | `ai.metadata` | No | Set by Enrichment |
| `metadata.trace_id` | `ai.metadata` | No | Set by ingress or Enrichment |

### 2.3 Post-enrichment provider send envelope

After Mapping + Enrichment, the event passed to `AI_PROVIDER_POST` MUST contain:

```json
{
  "ai": { "...": "AiTrafficRequest fields" },
  "provider_request": {
    "model": "gpt-4o-mini",
    "messages": [],
    "temperature": 0.7,
    "max_tokens": 1024
  }
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `provider_request` | **Yes** at destination send | Built by Mapping (default pass-through of `ai.body`) or Enrichment; vendor adapter reads this object |

Provider adapters MUST NOT read arbitrary unmapped fields from `ai.body` at send time; they read `provider_request` only.

### 2.4 Validation rules (ingress)

- Reject `stream: true` with `400` + `error_code: AI_STREAMING_NOT_SUPPORTED`.
- Reject unknown `stream_slug` with `404`.
- Reject disabled stream/source with `503`.
- Reject payload over max bytes with `413`.
- Require `Content-Type: application/json`.

---

## 3. Provider Adapter Contract

### 3.1 Registry

```text
AiProviderAdapterRegistry.get(provider_kind: str) -> AiProviderAdapter
```

Registered at import time alongside `DestinationAdapterRegistry` pattern (`specs/001-core-architecture/spec.md`).

### 3.2 Interface: `AiProviderAdapter`

| Method | Signature | Purpose |
|--------|-----------|---------|
| `provider_kind` | `str` property | e.g. `openai`, `azure_openai`, `anthropic`, `google_gemini`, `ollama`, `vllm` |
| `validate_config` | `(config_json: dict, auth_json: dict) -> None` | Raises `ValueError` on invalid endpoint/model/auth combination |
| `validate_credentials` | `(config_json: dict, auth_json: dict, *, timeout_seconds: float) -> CredentialProbeResult` | Lightweight HTTP probe (models/list or minimal completion); no full traffic |
| `list_models` | `(config_json: dict, auth_json: dict, *, timeout_seconds: float) -> list[str]` | Optional UI helper; may call provider models API |
| `build_http_request` | `(provider_request: dict, destination_config: dict, provider_config: dict, auth_json: dict) -> ProviderHttpRequest` | Deterministic wire request assembly |
| `send_request` | `(request: ProviderHttpRequest, *, timeout_seconds: float) -> ProviderSendResult` | Outbound HTTP; only network boundary for AI providers |
| `normalize_response` | `(raw_response: httpx.Response) -> dict` | Sanitized response for client return + `delivery_logs` |
| `health_check` | `(config_json: dict, auth_json: dict, *, timeout_seconds: float) -> HealthCheckResult` | Alias semantics of `validate_credentials` for operator “Test connection” button |

### 3.3 Supporting types

```python
# Conceptual — not implemented in M21.1

@dataclass
class ProviderHttpRequest:
    method: str           # "POST"
    url: str
    headers: dict[str, str]
    json_body: dict[str, Any]
    timeout_seconds: float

@dataclass
class ProviderSendResult:
    success: bool
    status_code: int
    latency_ms: int
    provider_response_id: str | None   # e.g. OpenAI id, Anthropic message id
    normalized_response: dict[str, Any]
    error_code: str | None
    error_message: str | None

@dataclass
class CredentialProbeResult:
    ok: bool
    latency_ms: int
    message: str
    http_status: int | None

@dataclass
class HealthCheckResult:
    ok: bool
    message: str
```

### 3.4 Provider matrix (M21)

| `provider_kind` | Auth (M21) | Wire endpoint style | `build_http_request` notes |
|-----------------|------------|---------------------|----------------------------|
| `openai` | API key (`Authorization: Bearer`) | `{base_url}/v1/chat/completions` | Pass-through OpenAI JSON |
| `azure_openai` | API key header `api-key` | `{endpoint}/openai/deployments/{deployment}/chat/completions?api-version={v}` | `deployment_name`, `api_version` from `config_json` |
| `anthropic` | `x-api-key` + `anthropic-version` | `{base_url}/v1/messages` | Map `messages` → Anthropic messages schema |
| `google_gemini` | `x-goog-api-key` or query key | `{base_url}/v1beta/models/{model}:generateContent` | Map messages → Gemini `contents` |
| `ollama` | None (optional bearer) | `{base_url}/api/chat` | Ollama chat schema |
| `vllm` | Optional bearer | `{base_url}/v1/chat/completions` | OpenAI-compatible |

**Post-M21:** Azure AD OAuth, Vertex AI — not in M21 adapter scope.

### 3.5 Mock adapter (required for CI)

| `provider_kind` | `mock` |
|-----------------|--------|
| Behavior | Returns deterministic JSON completion; no outbound network |
| Registration | Default in test/dev when `AI_GATEWAY_MOCK_PROVIDERS=1` |

### 3.6 Error mapping (adapter layer)

Adapters MUST raise `DestinationSendError(message, http_status=...)` on failure so existing failover/replay eligibility applies (`app/failover_routing/failover_eligibility.py`, `app/replay/eligibility.py`).

---

## 4. Destination Contract — `AI_PROVIDER_POST`

### 4.1 Identity

| Property | Value |
|----------|-------|
| `destination_type` | `AI_PROVIDER_POST` |
| Adapter class | `AiProviderPostDestinationAdapter` |
| Delegates to | `AiProviderAdapterRegistry.get(provider_kind)` |

### 4.2 Destination row shape

| Field | Storage | Required | Description |
|-------|---------|----------|-------------|
| `destination_type` | column | **Yes** | `AI_PROVIDER_POST` |
| `name` | column | **Yes** | Operator label |
| `config_json.provider_kind` | jsonb | **Yes** | One of Section 3.4 kinds |
| `config_json.provider_id` | jsonb | **Yes** (preferred) | FK reference to `ai_providers.id` |
| `config_json.endpoint_override` | jsonb | No | Override `ai_providers.config_json.base_url` |
| `config_json.model_override` | jsonb | No | Override model per destination |
| `config_json.timeout_seconds` | jsonb | No | Default **120** (AI latency >> webhook 10s) |
| `config_json.retry_count` | jsonb | No | Default **1** (single retry) |
| `config_json.retry_backoff_seconds` | jsonb | No | Default **2.0** exponential base |
| `config_json.verify_ssl` | jsonb | No | Default `true` |
| `config_json.http_proxy` | jsonb | No | Optional outbound proxy |
| `auth_json` | jsonb | No | **Empty when `provider_id` set** — credentials loaded from `ai_providers.auth_json` at send time |

**Schema choice (M21.0 open question #4):** Use `config_json.provider_id` reference; **no** new `destinations.provider_id` column in M21.

### 4.3 Input (adapter `send()`)

| Input | Source |
|-------|--------|
| `events` | Single-event list from StreamRunner fan-out |
| `destination_config` | Merged destination `config_json` + resolved provider config |
| `formatter_override` | Route-level override (ignored for AI in M21 unless `provider_request` nested in formatter output — default: pass enriched event as-is) |

Each event MUST include `provider_request` (Section 2.3).

### 4.4 Output (success)

| Output | Behavior |
|--------|----------|
| Return | `None` (adapter raises nothing) |
| Side effect | Attach `ProviderSendResult.normalized_response` to runtime context for sync ingress handler to return to client |
| `delivery_logs` | Stage `route_send`; fields: `request_id`, `provider_kind`, `model`, `status_code`, `latency_ms`, `provider_response_id`; **no** raw API keys or full prompt text |

### 4.5 Retry

| Parameter | Default | Behavior |
|-----------|---------|----------|
| `retry_count` | 1 | Total attempts = `retry_count + 1` |
| `retry_backoff_seconds` | 2.0 | Exponential: `backoff * 2^(attempt-1)` |
| Retry on | Connect errors, timeouts, HTTP **5xx** | Same as `WebhookSender` |
| No retry on | HTTP **4xx** (except optional future 408) | Fail immediately after first response |
| No retry on | HTTP **429** | Surface rate limit; route failure policy only |

### 4.6 Failover

| Rule | Value |
|------|-------|
| Mechanism | Existing `stream_failover_routes` (primary AI destination → secondary AI destination) |
| Eligible errors | Connect, timeout, **5xx** per `is_failover_eligible_error()` |
| Not eligible | **429**, 4xx auth/validation errors |
| Request shape | Operator MUST ensure Mapping produces provider-compatible `provider_request` for **both** primary and secondary, or configure provider-specific routes (document limitation in UI) |
| Success semantics | Secondary success → route success → checkpoint eligibility (Section 6) |

### 4.7 Timeout

| Layer | Default | Max |
|-------|---------|-----|
| Destination `timeout_seconds` | 120 | 300 |
| Ingress client wait | `timeout_seconds + 15` | Must exceed destination timeout |
| Connect timeout | Use `outbound_httpx_timeout()` pattern | Same as webhook |

### 4.8 Failure output

Raise `DestinationSendError` with:

- `http_status` when provider returned HTTP error
- Message sanitized (no secrets)
- Triggers route failure policy (`LOG_AND_CONTINUE` / `PAUSE_STREAM_ON_FAILURE` unchanged)

---

## 5. Sync vs Async

### 5.1 Options compared

| Criterion | A — Sync only | B — Sync + Async | C — Sync + Async + SSE |
|-----------|---------------|------------------|------------------------|
| Client behavior | Hold connection; return provider JSON on success | Sync path + optional `202 Accepted` fire-and-log | Adds streaming token delivery |
| StreamRunner changes | Ingest handler captures send result | Async needs job id + polling/logs | Requires streaming bridge outside StreamRunner |
| Checkpoint | Per-request success via delivery path | Async complicates client correlation | Streaming checkpoint undefined in M21 |
| Operator expectation | Matches OpenAI SDK proxy usage | Useful for batch/logging-only lanes | Required for `stream: true` clients |
| Implementation difficulty | **MEDIUM** | **MEDIUM–HIGH** | **HIGH** |
| M21.0 risk | LOW | MEDIUM | HIGH (explicitly deferred) |

### 5.2 Final sync model decision

**Selected: Option A — Sync only (non-streaming chat completions)**

M21 GA behavior:

1. Client `POST` with `stream: false` (or omitted).
2. Ingress waits for StreamRunner completion.
3. On success: HTTP **200** + provider-normalized JSON body.
4. On pipeline failure: HTTP **502** / **504** with `{ error_code, request_id, message }` (no provider secrets).
5. **`stream: true` rejected at ingress** (Section 2.4).

Deferred post-M21:

- Async `202` + log-only lane → M22+
- SSE / streaming → M22+ (requires separate spec amendment)

---

## 6. Checkpoint Model

### 6.1 AI traffic characteristics

AI proxy ingress is **push/stateless**: there is no polling cursor like `EVENT_ID` or S3 object key. Checkpoint semantics follow webhook push precedent (`app/runners/webhook_receiver.py`: `persist_checkpoint=False` on dispatch).

### 6.2 Final checkpoint decision

| Aspect | Decision |
|--------|----------|
| Ingest dispatch | `context.persist_checkpoint = False` (default for all AI proxy requests) |
| Checkpoint type (when observability write enabled) | `AI_PROXY_PUSH` |
| Checkpoint value shape | `{ "last_request_id": "<uuid>", "last_success_at": "<ISO8601>", "last_provider_response_id": "<string|null>" }` |
| Update trigger | Only after **all required routes** succeed (constitution unchanged) |
| Replay | Checkpoint **never** updated on replay (`specs/068-replay-engine/spec.md`) |
| Primary audit trail | `delivery_logs` keyed by `request_id` — not checkpoint cursor |

Optional operator setting (M21.4): `ai_streams.traffic_profile_json.persist_last_success_checkpoint` (default `false`). When `true`, ingest sets `persist_checkpoint=True` after successful sync response so Traffic dashboard can show “last successful request.”

**Not used as checkpoint cursor:** `event_time`, offset, provider pagination tokens.

---

## 7. Failure Model

### 7.1 Provider error classification

| Class | HTTP / condition | Failover eligible | Replay record eligible | Route failure policy | Client response (sync ingress) |
|-------|------------------|-------------------|------------------------|----------------------|--------------------------------|
| **4xx client** | 400–499 except 408, 429 | No | Yes (except 429) | Applies | Map to 4xx proxy body where safe; auth errors → 401/403 without leaking provider key state |
| **5xx server** | 500–599 | **Yes** | **Yes** | Applies | 502 Bad Gateway |
| **Timeout** | `httpx.TimeoutException`, connect timeout | **Yes** | **Yes** | Applies | 504 Gateway Timeout |
| **Rate limit** | HTTP **429** | **No** | **No** | Applies (pause/log per stream policy) | 429 with `Retry-After` if provider supplied |
| **Mapping/Enrichment** | Pipeline stage errors | No | No | Applies | 400 / 422 with `request_id` |
| **Ingress validation** | Before StreamRunner | No | No | N/A | 400 / 413 / 404 |

### 7.2 Failover integration

Flow (unchanged engine hook in `StreamRunner._fan_out`):

```text
Primary AI_PROVIDER_POST send fails (eligible)
  → attempt secondary AI_PROVIDER_POST
  → secondary success: route recovered; sync handler returns secondary provider response
  → secondary fail: route failure policy + replay eligibility evaluation
```

Log stages: `failover_route_attempt`, `failover_route_send_success`, `failover_route_send_failed`.

### 7.3 Replay integration

Per `specs/068-replay-engine/spec.md`:

| When | Action |
|------|--------|
| Final send failure (after failover exhausted) | Insert `stream_replay_events` with `protected_payload_json` = masked event list containing `provider_request` |
| `delivery_context_json` | `{ "destination_type": "AI_PROVIDER_POST", "provider_kind", "formatter_override": null }` |
| Operator replay | Resend via `AI_PROVIDER_POST` adapter only — **no** mapping/enrichment re-run |
| Checkpoint on replay | Never updated |
| Excluded | 429, rate-limited skips, dry-run, preview |

Protection engine MUST mask API keys in stored replay payloads (existing pipeline — M21.0 risk mitigation).

### 7.4 Sync ingress error body (canonical)

```json
{
  "error_code": "AI_PROVIDER_TIMEOUT",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Provider request timed out",
  "provider_kind": "openai",
  "http_status": 504
}
```

---

## 8. Credential Model

### 8.1 Storage

| Entity | Field | Content |
|--------|-------|---------|
| `ai_providers` | `config_json` | Non-secret: `base_url`, `default_model`, `api_version`, `deployment_name`, `organization_id`, `timeout_seconds` |
| `ai_providers` | `auth_json` | Secret credentials (write-only on API read — masked) |
| `destinations` (`AI_PROVIDER_POST`) | `config_json.provider_id` | Reference to `ai_providers.id` |
| `destinations` | `auth_json` | Empty `{}` when using `provider_id` |

### 8.2 Reuse of existing secret patterns

**Yes — reuse connector/source secret handling:**

- `_merge_secret()` / partial update semantics from `app/connectors/router.py`
- `mask_secrets()` on all API reads (`app/security/secrets.py`)
- Never log raw credentials in `delivery_logs`

**No application-level encryption at rest beyond DB access controls** (matches current connector `auth_json` — not encrypted column-level in OSS v1).

### 8.3 Auth types by provider (`ai_providers.auth_json`)

| `auth_type` | Providers | Required fields |
|-------------|-----------|-----------------|
| `api_key` | `openai`, `anthropic`, `google_gemini` | `api_key` |
| `azure_api_key` | `azure_openai` | `api_key` |
| `bearer` | `vllm`, optional `ollama` | `bearer_token` |
| `no_auth` | `ollama` (default) | — |
| `oauth2_client_credentials` | — | **Post-M21** (Azure AD) |

### 8.4 Endpoint and model resolution order

1. `ai.body.model` (client)
2. Enrichment override on `provider_request.model`
3. `destinations.config_json.model_override`
4. `ai_providers.config_json.default_model`

Endpoint:

1. `destinations.config_json.endpoint_override`
2. `ai_providers.config_json.base_url`
3. Provider adapter default for `provider_kind`

### 8.5 Ingress auth (AI proxy)

Stored in `ai_streams.ingress_config_json` + `sources.auth_json`:

| Mode | Fields |
|------|--------|
| `bearer_token` | `auth_json.bearer_token` (hashed compare at ingest) |
| `shared_secret_header` | `auth_json.shared_secret`, `auth_json.header_name` (default `Authorization: Bearer`) |

Separate from provider credentials — client-to-platform auth only.

---

## 9. RBAC Model

### 9.1 Reuse existing RBAC

**Yes — extend `app/auth/route_access.py` and capabilities payload; no new platform roles.**

M21 endpoints live under `/api/v1/ai-gateway/` (foundation resources) and public ingest under `/api/v1/ingest/ai/` (auth via stream token, not JWT).

### 9.2 Permission matrix

| Action | ADMINISTRATOR | CONNECTOR_OPERATOR | VIEWER | Governance roles |
|--------|---------------|-------------------|--------|------------------|
| AI Provider CRUD | ✅ | ✅ | ❌ | ❌ (out of scope) |
| AI Stream CRUD / wizard | ✅ | ✅ | ❌ | ❌ |
| Test provider connection | ✅ | ✅ | ❌ | ❌ |
| Traffic dashboard read | ✅ | ✅ | ✅ | ❌ |
| Failover route config | ✅ | ✅ | ❌ | ❌ |
| Replay AI delivery events | ✅ | ✅ (`can_replay_action` if unified) | ❌ | ❌ |
| Ingest POST | N/A (stream token) | N/A | N/A | N/A |

### 9.3 New capability flags (SPA)

Add to `build_capabilities()`:

| Capability | Roles |
|------------|-------|
| `ai_gateway_read` | All authenticated except unauthenticated |
| `ai_gateway_operate` | ADMINISTRATOR, CONNECTOR_OPERATOR |
| `ai_gateway_admin` | ADMINISTRATOR only (delete provider, disable stream) |

### 9.4 RBAC decision summary

| Question | Answer |
|----------|--------|
| New roles required? | **No** |
| Reuse connector operate? | **Yes** — `can_connector_operate()` for mutations |
| Reuse viewer read? | **Yes** — traffic/metrics GET endpoints |
| Feature flag | `VITE_AI_GATEWAY_FOUNDATION` default `false` until M21.4 GA |

---

## 10. M21 Build Plan

### 10.1 Phase overview

```text
M21.2  Core egress + provider registry + data model
M21.3  Ingress + AI Stream facade + sync proxy + operator API/UI
M21.4  Hardening — multi-provider, failover/replay E2E, traffic dashboard, GA flag
```

### 10.2 M21.2 — Core backend (egress first)

| # | Deliverable | Acceptance |
|---|-------------|------------|
| 1 | Alembic: `ai_providers` table | CRUD API with masked `auth_json` |
| 2 | `AiProviderAdapter` ABC + registry | Unit tests with mock adapter |
| 3 | Provider adapters: `mock`, `openai` | `validate_credentials`, `send_request`, `normalize_response` |
| 4 | `AI_PROVIDER_POST` destination adapter | Registered in `DestinationAdapterRegistry` |
| 5 | Destination schema validation | `config_json` contract Section 4.2 |
| 6 | WireMock E2E: manual Stream + `AI_PROVIDER_POST` | StreamRunner sends to mock OpenAI; `delivery_logs` populated |
| 7 | Extend `DestinationTypeLiteral` + preview allowlist | Preview send for `AI_PROVIDER_POST` (mock only in CI) |

**Exit criteria:** Provider-bound destination can deliver enriched event through full pipeline without new ingress.

### 10.3 M21.3 — Ingress + operator surface

| # | Deliverable | Acceptance |
|---|-------------|------------|
| 1 | Alembic: `ai_streams` facade table | 1:1 `stream_id` FK |
| 2 | `AI_PROXY_RECEIVER` source adapter | Normalizes to Section 2 event |
| 3 | `AiProxyReceiver` service + ingest router | Sync response Section 5 |
| 4 | AI Stream wizard (frontend) | Creates connector/source/stream/mapping/enrichment/destination/route bundle |
| 5 | Provider management UI | List/create/test providers |
| 6 | API routes under `/api/v1/ai-gateway/` | RBAC Section 9 |
| 7 | Reject `stream: true` | Ingress validation tests |

**Exit criteria:** Operator creates AI Stream end-to-end; client calls traffic URL; receives sync JSON completion.

### 10.4 M21.4 — Hardening + GA

| # | Deliverable | Acceptance |
|---|-------------|------------|
| 1 | Provider adapters: `azure_openai`, `anthropic`, `google_gemini`, `ollama`, `vllm` | Contract tests per provider |
| 2 | Failover E2E | Primary 5xx → secondary success; checkpoint semantics |
| 3 | Replay E2E | Failure → `stream_replay_events` → manual replay success |
| 4 | Traffic dashboard | Aggregates from `delivery_logs` by `request_id` / stream |
| 5 | Optional `persist_last_success_checkpoint` | Traffic widget |
| 6 | Feature flag enable path | `VITE_AI_GATEWAY_FOUNDATION=true` |
| 7 | Documentation | Operator guide: traffic URL, provider setup, failover limitation |
| 8 | Legacy `app/ai_gateway` nav | Remains hidden; no new traffic writes |

**Exit criteria:** Full M21 scope demonstrable on WireMock + mock providers; OSS flag ready.

### 10.5 Explicitly not in M21.x

- SSE / `stream: true`
- Async 202 ingress
- Azure AD / Vertex OAuth
- Prompt/response inspection (M22)
- AI policy / governance (M23)
- Dedicated AI audit export (M24)
- `destinations.provider_id` column migration

---

## 11. Implementation readiness

### 11.1 Decision summary

| Decision | Choice |
|----------|--------|
| **Ingress** | **`AI_PROXY_RECEIVER`** (Option B) |
| **Sync model** | **Sync only** — non-streaming chat completions (Option A) |
| **Checkpoint** | **`AI_PROXY_PUSH` + default `persist_checkpoint=False`; optional last-success write |
| **RBAC** | **Reuse** RBAC-lite + `can_connector_operate`; new capability flags only |

### 11.2 Implementation risk

| Area | Level | Notes |
|------|-------|-------|
| Stream reuse / constitution | **LOW** | Adapter-only extension |
| Sync proxy latency | **MEDIUM** | 120s timeouts; nginx/proxy read timeout alignment required |
| Heterogeneous failover | **MEDIUM** | Mapping must emit compatible `provider_request` |
| Multi-provider adapter parity | **MEDIUM** | Anthropic/Gemini schema mapping |
| SSE deferral | **LOW** (mitigated by explicit rejection) | Clients using `stream: true` must wait for M22 |
| Dual architecture (legacy ai_gateway) | **LOW** | Frozen; documented |
| Credential / replay masking | **MEDIUM** | Reuse protection engine — verify in M21.4 E2E |

**Overall implementation risk: MEDIUM**

### 11.3 Implementation ready

| Gate | Status |
|------|--------|
| Architecture Ready (M21.0) | YES |
| Ingress model locked | YES |
| Request + adapter contracts locked | YES |
| Destination + failure semantics locked | YES |
| Build plan M21.2–M21.4 | YES |
| **Implementation Ready** | **YES** |

M21.2 implementation MAY begin after review approval of this document.

---

## 12. References

| Document | Relevance |
|----------|-----------|
| `docs/architecture/AI_GATEWAY_FOUNDATION_SPEC.md` | M21.0 baseline |
| `specs/001-core-architecture/spec.md` | Adapter registry pattern |
| `specs/002-runtime-pipeline/spec.md` | Pipeline order, checkpoint |
| `specs/004-delivery-routing/spec.md` | Fan-out, failure policies |
| `specs/067-failover-routing/spec.md` | Active/standby |
| `specs/068-replay-engine/spec.md` | Replay storage/resend |
| `specs/035-rbac-lite/spec.md` | Operational roles |
| `app/runners/webhook_receiver.py` | Push ingress precedent |
| `app/failover_routing/failover_eligibility.py` | Eligible errors |
| `app/replay/eligibility.py` | Replay eligibility |

---

*Document version: M21.1 — implementation spec only. No code, migrations, APIs, UI, SDK installs, or tests created.*

---

## 13. M21.2 Implementation Results

**Status:** COMPLETE

| Area | Deliverable | Result |
|------|-------------|--------|
| Migration | `ai_providers` | `alembic/versions/20260608_0045_ai_providers_foundation.py` |
| API | `/api/v1/ai-providers` CRUD + health/models | `app/ai_providers/router.py` |
| Adapter registry | MOCK, OPENAI | `app/ai_providers/adapters/` |
| Destination | `AI_PROVIDER_POST` | `app/destinations/adapters/ai_provider_post.py` |
| Runtime | StreamRunner egress integration | `app/runners/stream_loader.py` resolves provider bundle |
| Tests | 27 tests PASS | `tests/test_ai_provider_*.py`, `tests/test_ai_providers_api.py` |

---

## 14. M21.3 Implementation Results

**Status:** COMPLETE

### 14.1 Migration — `ai_streams`

| Column | Type | Notes |
|--------|------|-------|
| `id` | integer PK | autoincrement |
| `stream_id` | FK → `streams.id` | UNIQUE, CASCADE delete |
| `provider_id` | FK → `ai_providers.id` | RESTRICT delete |
| `slug` | varchar(128) | UNIQUE, lowercase ingress identifier |
| `model` | varchar(128) | default model when client omits `model` |
| `enabled` | boolean | default `true` |
| `created_at` / `updated_at` | timestamptz | server default `now()` |

File: `alembic/versions/20260608_0046_ai_streams_foundation.py`

### 14.2 AI Streams API

| Method | Path | RBAC |
|--------|------|------|
| GET | `/api/v1/ai-streams` | VIEWER+ read |
| GET | `/api/v1/ai-streams/{id}` | VIEWER+ read |
| POST | `/api/v1/ai-streams` | CONNECTOR_OPERATOR / ADMINISTRATOR |
| PATCH | `/api/v1/ai-streams/{id}` | CONNECTOR_OPERATOR / ADMINISTRATOR |
| DELETE | `/api/v1/ai-streams/{id}` | CONNECTOR_OPERATOR / ADMINISTRATOR |

Files: `app/ai_streams/{models,schemas,service,router}.py`, RBAC in `app/auth/route_access.py`.

### 14.3 Ingress — `AI_PROXY_RECEIVER`

| Property | Value |
|----------|-------|
| Public path | `POST /api/v1/ingest/ai/{stream_slug}/v1/chat/completions` |
| Source adapter | `app/sources/adapters/ai_proxy_receiver.py` |
| Runtime service | `app/runners/ai_proxy_receiver.py` |
| Auth bypass | JWT not required — `app/auth/role_guard.py` prefix `/api/v1/ingest/ai` |
| Supported body fields | `model`, `messages`, `temperature`, `metadata`, `stream: false` or omitted |
| Rejections | `stream: true` → 400; unknown slug → 404; disabled → 409; invalid payload → 422 |

Normalization produces Section 2 `ai.*` envelope before Mapping.

### 14.4 Runtime integration

- No new AI runtime — reuses `StreamRunner.run()` via `AiProxyReceiver.dispatch()`.
- `source_type` overridden to `AI_PROXY_RECEIVER`; payload injected as `__gdc_ai_proxy_payload`.
- `persist_checkpoint=False` (M21.1 decision preserved).
- Checkpoint type `AI_PROXY_PUSH` set on dispatch context.
- `AI_PROVIDER_POST` captures provider response into `_ai_sync_holder` for sync return.
- Ingress returns **raw provider JSON** when adapter supplies `normalized_response.raw`; otherwise normalized dict.

Files: `app/runners/ai_proxy_receiver.py`, `app/destinations/adapters/ai_provider_post.py`, `app/runners/stream_runner.py` (sync holder propagation).

### 14.5 Timeout decision

| Layer | Source | Default |
|-------|--------|---------|
| Provider outbound | `ai_providers.timeout_seconds` | **120s** |
| Destination override | `destinations.config_json.timeout_seconds` | optional (M21.2) |
| Ingress client wait | provider timeout + **15s buffer** | 135s default |

**Reverse proxy note:** nginx / platform proxy `proxy_read_timeout` must be ≥ ingress wait (provider timeout + 15s). For default 120s provider timeout, set `proxy_read_timeout` ≥ **135s** (recommend **150s** margin).

### 14.6 Tests

| Suite | File | Coverage |
|-------|------|----------|
| Unit | `tests/test_ai_streams_service.py` | CRUD validation, slug/stream uniqueness, disabled flag |
| API | `tests/test_ai_streams_api.py` | CRUD, VIEWER read, operator mutate |
| Ingress | `tests/test_ai_proxy_receiver.py` | success, stream:true, 404, 409, 422, metadata |
| Integration | `tests/test_ai_proxy_e2e.py` | AI_PROXY_RECEIVER → StreamRunner → AI_PROVIDER_POST → MOCK |

M21.2 regression tests remain required on each M21.3 change.

### 14.7 Known limitations (M21.3)

- Sync only — `stream: true` explicitly rejected (SSE deferred to M22+).
- No async `202` ingress.
- AI Stream CRUD does not auto-provision connector/source/mapping/route bundle (wizard → M21.4 UI).
- Ingress auth reuses source `auth_json` patterns (`no_auth`, `bearer_token`, `shared_secret_header`).
- Failover sync response returns whichever provider succeeds (primary or secondary).

### 14.8 Next step — M21.4

- Additional provider adapters (Azure, Anthropic, Gemini, Ollama, vLLM)
- Failover / Replay E2E
- AI Traffic Dashboard
- GA feature flag `VITE_AI_GATEWAY_FOUNDATION`

---

## 15. M21.4 Implementation Results

**Status:** COMPLETE

### 15.1 Additional Providers

| DB `provider_type` | Adapter file | Wire style |
|--------------------|--------------|------------|
| `AZURE_OPENAI` | `app/ai_providers/adapters/azure_openai.py` | Azure deployment chat completions |
| `CLAUDE` | `app/ai_providers/adapters/claude.py` | Anthropic `/v1/messages` |
| `GEMINI` | `app/ai_providers/adapters/gemini.py` | Gemini `generateContent` |
| `OLLAMA` | `app/ai_providers/adapters/ollama.py` | Ollama `/api/chat` |
| `VLLM` | `app/ai_providers/adapters/vllm.py` | OpenAI-compatible `/v1/chat/completions` |

All adapters registered in `app/ai_providers/adapters/registry.py` and implement:
`validate_credentials`, `health_check`, `list_models`, `build_http_request`, `send_request`.

Shared HTTP helpers: `app/ai_providers/adapters/http_common.py`.

### 15.2 Provider Validation API

| Method | Path | Result |
|--------|------|--------|
| POST | `/api/v1/ai-providers/{id}/validate-credentials` | `{ status: "VALID" \| "INVALID", message, latency_ms, http_status }` |

Validates endpoint connectivity and API key via adapter `validate_credentials()`.

### 15.3 Failover Matrix (AI_PROVIDER_POST)

| Primary error | Failover eligible | Secondary resolves provider bundle |
|---------------|-------------------|-------------------------------------|
| HTTP 5xx | Yes | Yes (`resolve_destination_runtime_config`) |
| Timeout | Yes | Yes |
| HTTP 429 | No | N/A |
| HTTP 4xx auth | No | N/A |

Runtime fix: `app/runners/stream_runner.py` resolves secondary `AI_PROVIDER_POST` config before send.
E2E: `tests/test_ai_failover_e2e.py` (OPENAI 500 → MOCK secondary).

### 15.4 Replay Matrix (AI_PROVIDER_POST)

| Step | Behavior |
|------|----------|
| Final send failure | `stream_replay_events` recorded with `provider_request` payload |
| Manual replay | `execute_replay_event()` resolves `AI_PROVIDER_POST` provider bundle |
| Checkpoint | Never updated on replay |

Runtime fix: `app/replay/service.py` uses `resolve_destination_runtime_config()`.
E2E: `tests/test_ai_replay_e2e.py`.

### 15.5 AI Traffic Dashboard

| Surface | Path | RBAC |
|---------|------|------|
| API | `GET /api/v1/ai-providers/traffic/summary` | VIEWER+ read |
| UI shell | `/ai-gateway` (Providers / AI Streams / Traffic tabs) | `VITE_AI_GATEWAY_FOUNDATION=true` |

P0 metrics: Requests, Success Rate, Error Rate, Avg Latency.
P1 metrics: Top Providers, Failover Count, Replay Count.

Aggregation: `app/ai_providers/traffic_metrics.py` from `delivery_logs` + provider destination map.
Operator vocabulary only — no StreamRunner/engine terms in UI.

### 15.6 Provider Metrics (per provider)

Collected in traffic summary `top_providers[]`:

- `request_count`
- `success_count`
- `failure_count`
- `avg_latency_ms`

### 15.7 Feature Flag

| Flag | Default (OSS) | Behavior |
|------|---------------|----------|
| `VITE_AI_GATEWAY_FOUNDATION` | `false` | Hidden — no `/ai-gateway` routes, no Streams entry link |
| `VITE_AI_GATEWAY_FOUNDATION=true` | build-time | AI Gateway shell visible; entry from Streams console |

Docker: `docker/Dockerfile.frontend` ARG default `false`.

### 15.8 Tests (M21.4)

| Suite | File |
|-------|------|
| Provider adapters | `tests/test_ai_provider_adapters_m21_4.py` |
| Failover E2E | `tests/test_ai_failover_e2e.py` |
| Replay E2E | `tests/test_ai_replay_e2e.py` |
| Traffic + validation API | `tests/test_ai_traffic_metrics.py` |
| Frontend flag | `frontend/src/lib/feature-flags.test.ts` |

M21.2/M21.3 regression tests remain required.

### 15.9 M21 Status

**M21 AI Gateway Foundation: COMPLETE**

Deferred to M22+: Prompt/Response Inspection, AI Policy, AI Governance, AI Audit, SSE, Async processing.

### 15.10 Next step — M22

AI Policy Enforcement (inspection surfaces, policy engine integration).
