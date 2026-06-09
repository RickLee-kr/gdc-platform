"""Resolve destination runtime config for send/replay/failover paths."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.ai_providers.destination_config import resolve_ai_provider_destination_config


def resolve_destination_runtime_config(
    db: Session | None,
    destination_type: str,
    destination_config: dict[str, Any],
) -> dict[str, Any]:
    dtype = str(destination_type or "").strip().upper()
    cfg = dict(destination_config or {})
    if dtype == "AI_PROVIDER_POST":
        if db is None:
            raise ValueError("AI_PROVIDER_POST requires database session to resolve provider bundle")
        return resolve_ai_provider_destination_config(db, cfg)
    return cfg
