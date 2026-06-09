"""Resolve ai_providers rows into AI_PROVIDER_POST destination runtime config."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.ai_providers.models import AiProvider
from app.ai_providers.service import provider_runtime_bundle


def resolve_ai_provider_destination_config(
    db: Session,
    destination_config: dict[str, Any],
) -> dict[str, Any]:
    cfg = dict(destination_config or {})
    provider_id = cfg.get("provider_id")
    if provider_id is None:
        raise ValueError("AI_PROVIDER_POST destination requires config_json.provider_id")
    row = db.query(AiProvider).filter(AiProvider.id == int(provider_id)).first()
    if row is None:
        raise ValueError(f"ai provider not found: {provider_id}")
    if not bool(row.enabled):
        raise ValueError(f"ai provider disabled: {provider_id}")
    merged = dict(cfg)
    merged["_provider"] = provider_runtime_bundle(row)
    return merged


def validate_ai_provider_destination_config(config_json: dict[str, Any] | None) -> None:
    cfg = dict(config_json or {})
    provider_id = cfg.get("provider_id")
    if provider_id is None:
        raise ValueError("AI_PROVIDER_POST destination requires provider_id")
    try:
        int(provider_id)
    except (TypeError, ValueError) as exc:
        raise ValueError("provider_id must be an integer") from exc
    retry_count = cfg.get("retry_count", 1)
    try:
        retry_int = int(retry_count)
    except (TypeError, ValueError) as exc:
        raise ValueError("retry_count must be an integer") from exc
    if retry_int < 0 or retry_int > 10:
        raise ValueError("retry_count must be between 0 and 10")
