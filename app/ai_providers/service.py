"""AI Provider CRUD and credential merge helpers."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.ai_providers.models import AI_PROVIDER_TYPES, AiProvider
from app.ai_providers.schemas import AiProviderCreate, AiProviderUpdate, OPENAI_MODELS
from app.security.secrets import mask_secrets


def _normalize_provider_type(value: str) -> str:
    normalized = str(value or "").strip().upper()
    if normalized not in AI_PROVIDER_TYPES:
        raise ValueError(f"unsupported provider_type: {value}")
    return normalized


def _merge_auth_json(
    incoming: dict[str, Any] | None,
    existing: dict[str, Any] | None,
    *,
    partial: bool,
) -> dict[str, Any]:
    if partial and incoming is None:
        return dict(existing or {})
    from app.security.secrets import merge_preserving_masked_secrets

    return merge_preserving_masked_secrets(dict(incoming or {}), dict(existing or {}))


def _validate_openai_model(default_model: str | None) -> None:
    if default_model is None:
        return
    model = str(default_model).strip()
    if model and model not in OPENAI_MODELS:
        raise ValueError(f"unsupported default_model for OPENAI: {model}")


def validate_ai_provider_fields(
    *,
    provider_type: str,
    endpoint_url: str,
    default_model: str | None,
    timeout_seconds: int,
    auth_json: dict[str, Any],
) -> None:
    if not str(endpoint_url or "").strip():
        raise ValueError("endpoint_url is required")
    if timeout_seconds < 1 or timeout_seconds > 300:
        raise ValueError("timeout_seconds must be between 1 and 300")
    ptype = _normalize_provider_type(provider_type)
    if ptype == "OPENAI":
        _validate_openai_model(default_model)
        api_key = str((auth_json or {}).get("api_key") or "").strip()
        if not api_key:
            raise ValueError("OPENAI provider requires auth_json.api_key")
    elif ptype in {"AZURE_OPENAI", "CLAUDE", "GEMINI"}:
        api_key = str((auth_json or {}).get("api_key") or "").strip()
        if not api_key:
            raise ValueError(f"{ptype} provider requires auth_json.api_key")
        if ptype == "AZURE_OPENAI" and not str(default_model or "").strip():
            raise ValueError("AZURE_OPENAI provider requires default_model (deployment name)")
    elif ptype == "MOCK":
        return
    elif ptype in {"OLLAMA", "VLLM"}:
        return


def create_ai_provider(db: Session, payload: AiProviderCreate) -> AiProvider:
    auth_json = dict(payload.auth_json or {})
    timeout_seconds = int(payload.timeout_seconds or 120)
    validate_ai_provider_fields(
        provider_type=payload.provider_type,
        endpoint_url=payload.endpoint_url,
        default_model=payload.default_model,
        timeout_seconds=timeout_seconds,
        auth_json=auth_json,
    )
    row = AiProvider(
        name=str(payload.name).strip(),
        provider_type=_normalize_provider_type(payload.provider_type),
        enabled=bool(payload.enabled),
        endpoint_url=str(payload.endpoint_url).strip().rstrip("/"),
        auth_json=auth_json,
        default_model=str(payload.default_model).strip() if payload.default_model else None,
        timeout_seconds=timeout_seconds,
    )
    db.add(row)
    db.flush()
    return row


def update_ai_provider(db: Session, row: AiProvider, payload: AiProviderUpdate) -> AiProvider:
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        row.name = str(data["name"]).strip()
    if "provider_type" in data and data["provider_type"] is not None:
        row.provider_type = _normalize_provider_type(str(data["provider_type"]))
    if "enabled" in data and data["enabled"] is not None:
        row.enabled = bool(data["enabled"])
    if "endpoint_url" in data and data["endpoint_url"] is not None:
        row.endpoint_url = str(data["endpoint_url"]).strip().rstrip("/")
    if "default_model" in data:
        row.default_model = str(data["default_model"]).strip() if data["default_model"] else None
    if "timeout_seconds" in data and data["timeout_seconds"] is not None:
        row.timeout_seconds = int(data["timeout_seconds"])
    if "auth_json" in data:
        row.auth_json = _merge_auth_json(data.get("auth_json"), row.auth_json, partial=True)
    validate_ai_provider_fields(
        provider_type=str(row.provider_type),
        endpoint_url=str(row.endpoint_url),
        default_model=row.default_model,
        timeout_seconds=int(row.timeout_seconds),
        auth_json=dict(row.auth_json or {}),
    )
    return row


def serialize_ai_provider_read(row: AiProvider) -> dict[str, Any]:
    item = {
        "id": int(row.id),
        "name": str(row.name),
        "provider_type": str(row.provider_type),
        "enabled": bool(row.enabled),
        "endpoint_url": str(row.endpoint_url),
        "default_model": row.default_model,
        "timeout_seconds": int(row.timeout_seconds),
        "auth_json": mask_secrets(dict(row.auth_json or {})),
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }
    return item


def get_ai_provider_by_id(db: Session, provider_id: int) -> AiProvider | None:
    return db.query(AiProvider).filter(AiProvider.id == int(provider_id)).first()


def provider_runtime_bundle(row: AiProvider) -> dict[str, Any]:
    """Resolved provider fields embedded into AI_PROVIDER_POST destination config."""

    return {
        "provider_id": int(row.id),
        "provider_type": str(row.provider_type),
        "endpoint_url": str(row.endpoint_url),
        "default_model": row.default_model,
        "timeout_seconds": int(row.timeout_seconds or 120),
        "auth_json": dict(row.auth_json or {}),
    }
