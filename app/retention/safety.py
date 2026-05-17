"""Safety gates for destructive retention work.

Retention preview and dry-run paths must remain available by default. Any path
that can delete rows, files, or partitions must pass through these guards.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.config import settings


AUTOMATIC_RETENTION_TRIGGERS = frozenset({"scheduler", "supplement_scheduler"})


@dataclass(frozen=True)
class RetentionExecutionDecision:
    allowed: bool
    reason: str
    notes: dict[str, object]


def retention_execution_decision(*, trigger: str) -> RetentionExecutionDecision:
    """Return whether a non-dry-run retention action may delete data."""

    app_env = str(settings.APP_ENV or "").strip().lower()
    destructive_enabled = bool(settings.GDC_RETENTION_DESTRUCTIVE_ACTIONS_ENABLED)
    production_deletes_enabled = bool(settings.GDC_RETENTION_PRODUCTION_DELETES_ENABLED)
    automatic_deletes_enabled = bool(settings.GDC_RETENTION_AUTOMATIC_DELETES_ENABLED)
    is_production = app_env == "production"
    is_automatic = str(trigger) in AUTOMATIC_RETENTION_TRIGGERS
    notes = {
        "app_env": app_env or "unknown",
        "trigger": trigger,
        "destructive_actions_enabled": destructive_enabled,
        "production_deletes_enabled": production_deletes_enabled,
        "automatic_deletes_enabled": automatic_deletes_enabled,
    }

    if not destructive_enabled:
        return RetentionExecutionDecision(
            allowed=False,
            reason="retention destructive actions are disabled by default.",
            notes=notes,
        )
    if is_production and not production_deletes_enabled:
        return RetentionExecutionDecision(
            allowed=False,
            reason="production retention deletes require explicit production enablement.",
            notes=notes,
        )
    if is_automatic and is_production:
        return RetentionExecutionDecision(
            allowed=False,
            reason="automatic retention deletes are forbidden in production; use manual dry-run and explicit execution.",
            notes=notes,
        )
    if is_automatic and not automatic_deletes_enabled:
        return RetentionExecutionDecision(
            allowed=False,
            reason="automatic retention deletes require explicit scheduler enablement.",
            notes=notes,
        )
    return RetentionExecutionDecision(allowed=True, reason="retention destructive actions enabled.", notes=notes)


__all__ = ["AUTOMATIC_RETENTION_TRIGGERS", "RetentionExecutionDecision", "retention_execution_decision"]
