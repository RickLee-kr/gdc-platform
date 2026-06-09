"""AI proxy receiver runtime service.

Inbound OpenAI-compatible HTTP concerns stay here; the pipeline remains StreamRunner:
source adapter -> extraction -> mapping -> enrichment -> route fan-out -> delivery.
"""

from __future__ import annotations

import hmac
import json
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping

from sqlalchemy.orm import Session

from app.ai_providers.models import AiProvider
from app.ai_streams.models import AiStream
from app.runners.stream_loader import load_stream_context
from app.runners.stream_runner import StreamRunner
from app.sources.adapters.ai_proxy_receiver import AI_PROXY_PAYLOAD_CONFIG_KEY
from app.sources.models import Source
from app.streams.models import Stream

logger = logging.getLogger(__name__)

DEFAULT_MAX_REQUEST_BYTES = 1_048_576
DEFAULT_INGRESS_TIMEOUT_BUFFER_SECONDS = 15
AI_PROXY_SOURCE_TYPES = {"AI_PROXY_RECEIVER"}


class AiProxyReceiverError(Exception):
    status_code = 400
    error_code = "AI_PROXY_RECEIVER_ERROR"


class AiProxyStreamNotFound(AiProxyReceiverError):
    status_code = 404
    error_code = "AI_STREAM_NOT_FOUND"


class AiProxyStreamDisabled(AiProxyReceiverError):
    status_code = 409
    error_code = "AI_STREAM_DISABLED"


class AiProxyAuthFailed(AiProxyReceiverError):
    status_code = 401
    error_code = "AI_PROXY_AUTH_FAILED"


class AiProxyPayloadTooLarge(AiProxyReceiverError):
    status_code = 413
    error_code = "AI_PROXY_PAYLOAD_TOO_LARGE"


class AiProxyInvalidPayload(AiProxyReceiverError):
    status_code = 422
    error_code = "AI_PROXY_INVALID_PAYLOAD"


class AiProxyStreamingNotSupported(AiProxyReceiverError):
    status_code = 400
    error_code = "AI_STREAMING_NOT_SUPPORTED"


class AiProxyPipelineFailed(AiProxyReceiverError):
    status_code = 502
    error_code = "AI_PROXY_PIPELINE_FAILED"

    def __init__(self, message: str, *, request_id: str | None = None) -> None:
        super().__init__(message)
        self.request_id = request_id


class AiProxyPolicyBlocked(AiProxyReceiverError):
    status_code = 403
    error_code = "AI_POLICY_BLOCKED"

    def __init__(
        self,
        message: str,
        *,
        request_id: str | None = None,
        stage: str = "",
        policy_name: str = "",
    ) -> None:
        super().__init__(message)
        self.request_id = request_id
        self.stage = stage
        self.policy_name = policy_name


class AiProxyProviderTimeout(AiProxyReceiverError):
    status_code = 504
    error_code = "AI_PROVIDER_TIMEOUT"


@dataclass(frozen=True)
class ResolvedAiProxyStream:
    ai_stream: AiStream
    stream: Stream
    source: Source
    provider: AiProvider


def _norm_slug(value: str) -> str:
    return str(value or "").strip().lower()


def _header_get(headers: Mapping[str, str], name: str) -> str:
    target = name.lower()
    for key, value in headers.items():
        if key.lower() == target:
            return str(value)
    return ""


def _extract_bearer(headers: Mapping[str, str]) -> str:
    raw = _header_get(headers, "Authorization")
    prefix = "bearer "
    if raw.lower().startswith(prefix):
        return raw[len(prefix) :].strip()
    return ""


def _sanitize_headers(headers: Mapping[str, str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in headers.items():
        lowered = key.lower()
        if lowered in {"authorization", "x-api-key", "api-key"}:
            out[key] = "[REDACTED]"
        else:
            out[key] = str(value)
    return out


def _validate_chat_completions_body(body: dict[str, Any]) -> None:
    if body.get("stream") is True:
        raise AiProxyStreamingNotSupported("stream: true is not supported in M21")
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        raise AiProxyInvalidPayload("messages must be a non-empty array")
    for idx, message in enumerate(messages):
        if not isinstance(message, dict):
            raise AiProxyInvalidPayload(f"messages[{idx}] must be an object")
        role = str(message.get("role") or "").strip()
        if not role:
            raise AiProxyInvalidPayload(f"messages[{idx}].role is required")
        if "content" not in message:
            raise AiProxyInvalidPayload(f"messages[{idx}].content is required")
    temperature = body.get("temperature")
    if temperature is not None:
        try:
            temp_value = float(temperature)
        except (TypeError, ValueError) as exc:
            raise AiProxyInvalidPayload("temperature must be a number") from exc
        if temp_value < 0 or temp_value > 2:
            raise AiProxyInvalidPayload("temperature must be between 0 and 2")


def parse_chat_completions_payload(body: bytes, content_type: str | None) -> dict[str, Any]:
    ctype = str(content_type or "").split(";", maxsplit=1)[0].strip().lower()
    if ctype and ctype != "application/json":
        raise AiProxyInvalidPayload("Content-Type must be application/json")
    if not body.strip():
        raise AiProxyInvalidPayload("Request body is empty")
    try:
        value = json.loads(body)
    except json.JSONDecodeError as exc:
        raise AiProxyInvalidPayload(f"Invalid JSON payload: {exc.msg}") from exc
    if not isinstance(value, dict):
        raise AiProxyInvalidPayload("Request body must be a JSON object")
    _validate_chat_completions_body(value)
    return value


def build_ai_ingress_event(
    *,
    stream_slug: str,
    headers: Mapping[str, str],
    body: dict[str, Any],
    client_ip: str,
    configured_model: str,
) -> dict[str, Any]:
    request_body = dict(body)
    if not str(request_body.get("model") or "").strip():
        request_body["model"] = configured_model
    request_body["stream"] = False
    request_id = str(uuid.uuid4())
    client_request_id = _header_get(headers, "X-Request-Id") or None
    metadata = body.get("metadata")
    meta: dict[str, Any] = {}
    if isinstance(metadata, dict):
        meta.update(metadata)
    if client_request_id:
        meta.setdefault("client_request_id", client_request_id)
    return {
        "ai": {
            "request_id": request_id,
            "stream_slug": stream_slug,
            "provider_hint": None,
            "method": "POST",
            "path": "/v1/chat/completions",
            "headers": _sanitize_headers(headers),
            "body": request_body,
            "client_ip": client_ip,
            "received_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "metadata": meta,
        }
    }


class AiProxyReceiver:
    """Validate inbound AI proxy requests and feed the standard StreamRunner pipeline."""

    def __init__(self, *, runner: StreamRunner | None = None) -> None:
        self.runner = runner or StreamRunner()

    def dispatch(
        self,
        db: Session,
        *,
        stream_slug: str,
        headers: Mapping[str, str],
        body: bytes,
        content_type: str | None,
        client_ip: str = "",
    ) -> dict[str, Any]:
        resolved = self._resolve(db, stream_slug)
        self._validate_enabled(resolved)
        max_bytes = self._max_request_bytes(resolved.source)
        if len(body) > max_bytes:
            raise AiProxyPayloadTooLarge(f"Request payload exceeds {max_bytes} bytes")
        self._authenticate(resolved, headers)
        try:
            request_body = parse_chat_completions_payload(body, content_type)
        except AiProxyReceiverError:
            raise
        except Exception as exc:
            raise AiProxyInvalidPayload(str(exc)) from exc

        ingress_event = build_ai_ingress_event(
            stream_slug=_norm_slug(stream_slug),
            headers=headers,
            body=request_body,
            client_ip=client_ip or "",
            configured_model=str(resolved.ai_stream.model),
        )
        request_id = str((ingress_event.get("ai") or {}).get("request_id") or "")

        context = load_stream_context(
            db,
            int(resolved.stream.id),
            require_enabled_stream=True,
            preloaded_stream=resolved.stream,
            preloaded_source=resolved.source,
            preloaded_ai_provider=resolved.provider,
            ai_stream_id=int(resolved.ai_stream.id),
        )
        context.persist_checkpoint = False
        context.checkpoint = {"type": "AI_PROXY_PUSH", "value": {}}
        source_config = dict(context.stream.get("source_config") or {})
        source_config[AI_PROXY_PAYLOAD_CONFIG_KEY] = ingress_event
        sync_holder: dict[str, Any] = {"request_id": request_id}
        source_config["_ai_sync_holder"] = sync_holder
        context.stream["source_config"] = source_config
        context.stream["source_type"] = "AI_PROXY_RECEIVER"

        summary = self.runner.run(context, db=db)
        policy_block = sync_holder.get("policy_blocked")
        if isinstance(policy_block, dict):
            raise AiProxyPolicyBlocked(
                str(policy_block.get("message") or "AI policy blocked request"),
                request_id=request_id,
                stage=str(policy_block.get("stage") or ""),
                policy_name=str(policy_block.get("policy_name") or ""),
            )
        if summary.get("outcome") != "completed":
            raise AiProxyPipelineFailed(
                str(summary.get("message") or "AI proxy pipeline did not complete"),
                request_id=request_id,
            )

        provider_response = sync_holder.get("provider_response")
        if provider_response is None:
            raise AiProxyPipelineFailed(
                "Provider response missing after successful pipeline run",
                request_id=request_id,
            )

        return {
            "request_id": request_id,
            "provider_response": provider_response,
            "summary": summary,
            "checkpoint_updated": False,
        }

    def ingress_timeout_seconds(self, resolved: ResolvedAiProxyStream) -> float:
        return float(resolved.provider.timeout_seconds or 120) + DEFAULT_INGRESS_TIMEOUT_BUFFER_SECONDS

    def _resolve(self, db: Session, stream_slug: str) -> ResolvedAiProxyStream:
        slug = _norm_slug(stream_slug)
        if not slug:
            raise AiProxyStreamNotFound("stream_slug is required")
        ai_stream = db.query(AiStream).filter(AiStream.slug == slug).first()
        if ai_stream is None:
            raise AiProxyStreamNotFound(f"AI stream not found: {slug}")
        stream = db.query(Stream).filter(Stream.id == int(ai_stream.stream_id)).first()
        if stream is None:
            raise AiProxyStreamNotFound(f"stream not found for slug: {slug}")
        source = db.query(Source).filter(Source.id == int(stream.source_id)).first()
        if source is None:
            raise AiProxyStreamNotFound(f"source not found for slug: {slug}")
        provider = db.query(AiProvider).filter(AiProvider.id == int(ai_stream.provider_id)).first()
        if provider is None:
            raise AiProxyStreamNotFound(f"provider not found for slug: {slug}")
        return ResolvedAiProxyStream(ai_stream=ai_stream, stream=stream, source=source, provider=provider)

    def _validate_enabled(self, resolved: ResolvedAiProxyStream) -> None:
        if not bool(resolved.ai_stream.enabled):
            raise AiProxyStreamDisabled("AI stream is disabled")
        if not bool(resolved.source.enabled):
            raise AiProxyStreamDisabled("AI proxy source is disabled")
        if not bool(resolved.stream.enabled):
            raise AiProxyStreamDisabled("AI proxy stream is disabled")
        if not bool(resolved.provider.enabled):
            raise AiProxyStreamDisabled("AI provider is disabled")

    def _authenticate(self, resolved: ResolvedAiProxyStream, headers: Mapping[str, str]) -> None:
        cfg = resolved.source.config_json or {}
        auth = resolved.source.auth_json or {}
        mode = str(auth.get("auth_mode") or cfg.get("auth_mode") or "no_auth").strip().lower().replace("-", "_")
        if mode in {"none", "off", ""}:
            mode = "no_auth"
        if mode == "no_auth":
            return
        if mode in {"shared_secret", "shared_secret_header", "secret", "header"}:
            header_name = str(auth.get("header_name") or cfg.get("shared_secret_header_name") or "X-GDC-AI-Secret").strip()
            expected = str(auth.get("shared_secret") or cfg.get("shared_secret") or "")
            actual = _header_get(headers, header_name)
            if expected and hmac.compare_digest(actual, expected):
                return
        elif mode in {"bearer", "bearer_token", "token"}:
            expected = str(auth.get("bearer_token") or cfg.get("bearer_token") or "")
            actual = _extract_bearer(headers)
            if expected and hmac.compare_digest(actual, expected):
                return
        else:
            raise AiProxyAuthFailed(f"Unsupported AI proxy auth mode: {mode}")
        raise AiProxyAuthFailed("AI proxy authentication failed")

    def _max_request_bytes(self, source: Source) -> int:
        raw = (source.config_json or {}).get("max_request_bytes", DEFAULT_MAX_REQUEST_BYTES)
        try:
            value = int(raw)
        except (TypeError, ValueError):
            return DEFAULT_MAX_REQUEST_BYTES
        return max(1024, min(value, 10 * 1024 * 1024))
