"""Load and cache static JSON templates from the repository ``templates/`` tree."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from app.templates.schemas import TemplateDefinition, TemplateSummary

logger = logging.getLogger(__name__)

_templates_cache: dict[str, TemplateDefinition] | None = None


def templates_root() -> Path:
    """Return absolute path to ``templates/`` at repository root."""

    return Path(__file__).resolve().parent.parent.parent / "templates"


def clear_template_cache() -> None:
    """Reset in-process template cache (tests)."""

    global _templates_cache
    _templates_cache = None


def _read_json(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    return json.loads(text)


def load_template_definitions(*, force_reload: bool = False) -> dict[str, TemplateDefinition]:
    """Discover ``*.json`` files under ``templates/`` and validate."""

    global _templates_cache
    if _templates_cache is not None and not force_reload:
        return _templates_cache

    root = templates_root()
    out: dict[str, TemplateDefinition] = {}
    if not root.is_dir():
        logger.warning("%s", {"stage": "templates_root_missing", "path": str(root)})
        _templates_cache = {}
        return _templates_cache

    for path in sorted(root.rglob("*.json")):
        try:
            raw = _read_json(path)
            item = TemplateDefinition.model_validate(raw)
        except (OSError, json.JSONDecodeError, ValidationError) as exc:
            logger.error("%s", {"stage": "template_file_invalid", "path": str(path), "error": str(exc)})
            continue
        if item.template_id in out:
            logger.error(
                "%s",
                {"stage": "template_id_duplicate", "template_id": item.template_id, "path": str(path)},
            )
            continue
        out[item.template_id] = item

    _templates_cache = out
    return _templates_cache


def list_template_summaries() -> list[TemplateSummary]:
    """Return stable-sorted summaries for library listing."""

    defs = load_template_definitions().values()
    rows = [
        TemplateSummary(
            template_id=d.template_id,
            name=d.name,
            category=d.category,
            description=d.description,
            source_type=d.source_type,
            auth_type=d.auth_type,
            tags=list(d.tags),
            included_components=list(d.included_components),
            recommended_destinations=list(d.recommended_destinations),
        )
        for d in sorted(defs, key=lambda x: x.template_id)
    ]
    return rows


def get_template(template_id: str) -> TemplateDefinition | None:
    """Return a template definition or None if unknown."""

    return load_template_definitions().get(template_id)


def get_template_or_404(template_id: str) -> TemplateDefinition:
    """Return template or raise KeyError for HTTP layer mapping."""

    found = get_template(template_id)
    if found is None:
        raise KeyError(template_id)
    return found


def template_detail_public_dict(template_id: str) -> dict[str, Any]:
    """Full template document for preview (JSON-serializable)."""

    return get_template_or_404(template_id).model_dump()
