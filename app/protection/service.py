"""Service entrypoints for protection engine (M6)."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.protection.engine import ProtectBatchResult, protect_batch
from app.protection.operator_workflow import load_enabled_rules


def protect_events_for_delivery(
    db: Session | None,
    *,
    stream_id: int,
    enriched_events: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], ProtectBatchResult]:
    """Return outbound delivery copy; enriched input is not mutated."""

    rules = load_enabled_rules(db, stream_id) if db is not None else []
    result = protect_batch(enriched_events, rules, stream_id=stream_id, db=db)
    return result.events, result


def commit_identity_vault_after_preview(db: Session | None, stream_id: int) -> None:
    """Commit only when preview/debug created vault rows (tokenization rules enabled)."""

    from app.protection.identity_vault import commit_vault_writes_for_preview

    commit_vault_writes_for_preview(db, stream_id)
