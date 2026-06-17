"""Adapter from route classification config entries to engine input (M13.4)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.route_classification.config import RouteClassificationRuleEntry


@dataclass(frozen=True, slots=True)
class EngineClassificationRule:
    """Duck-type compatible with StreamClassificationRule for classify_batch()."""

    enabled: bool
    condition_json: dict[str, Any]
    classification_level: str
    name: str = ""
    id: int | None = None


def adapt_rules_for_engine(rules: tuple[RouteClassificationRuleEntry, ...]) -> list[EngineClassificationRule]:
    return [
        EngineClassificationRule(
            enabled=rule.enabled,
            condition_json=dict(rule.condition_json),
            classification_level=rule.classification_level,
            name=rule.name,
            id=rule.id,
        )
        for rule in rules
    ]


def adapt_orm_rows(rows: list[Any], *, source: str) -> list[EngineClassificationRule]:
    adapted: list[EngineClassificationRule] = []
    for row in rows:
        if not bool(getattr(row, "enabled", True)):
            continue
        adapted.append(
            EngineClassificationRule(
                enabled=True,
                condition_json=dict(getattr(row, "condition_json", {}) or {}),
                classification_level=str(getattr(row, "classification_level", "INTERNAL")),
                name=str(getattr(row, "name", "")),
                id=int(row.id) if getattr(row, "id", None) is not None else None,
            )
        )
    return adapted
