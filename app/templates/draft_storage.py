"""Filesystem layout for Template Draft artifacts under ``templates/drafts/``."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from app.templates.registry import templates_root

DRAFTS_SUBDIR = "drafts"


def drafts_root() -> Path:
    root = templates_root() / DRAFTS_SUBDIR
    root.mkdir(parents=True, exist_ok=True)
    return root


def new_draft_id() -> str:
    return f"draft-{uuid.uuid4().hex[:12]}"


def draft_dir(draft_id: str) -> Path:
    safe = draft_id.replace("/", "_").replace("..", "_")
    path = drafts_root() / safe
    path.mkdir(parents=True, exist_ok=True)
    return path


def _write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def write_draft_artifacts(
    draft_id: str,
    *,
    manifest: dict[str, Any],
    request: dict[str, Any],
    mapping: dict[str, Any],
    enrichment: dict[str, Any],
    sample_raw: Any,
    sample_normalized: Any | None,
) -> str:
    """Persist sidecar files; return relative storage path from templates root."""

    d = draft_dir(draft_id)
    _write_json(d / "manifest.json", manifest)
    _write_json(d / "request.json", request)
    _write_json(d / "mapping.json", mapping)
    _write_json(d / "enrichment.json", enrichment)
    _write_json(d / "sample.raw.json", sample_raw)
    _write_json(d / "sample.normalized.json", sample_normalized if sample_normalized is not None else {})
    return f"{DRAFTS_SUBDIR}/{draft_id}"


def read_draft_artifacts(draft_id: str) -> dict[str, Any]:
    d = drafts_root() / draft_id.replace("/", "_").replace("..", "_")
    if not d.is_dir():
        raise FileNotFoundError(draft_id)

    def _read(name: str) -> Any:
        path = d / name
        if not path.is_file():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    return {
        "manifest": _read("manifest.json") or {},
        "request": _read("request.json") or {},
        "mapping": _read("mapping.json") or {},
        "enrichment": _read("enrichment.json") or {},
        "sample_raw": _read("sample.raw.json"),
        "sample_normalized": _read("sample.normalized.json"),
    }


def delete_draft_artifacts(draft_id: str) -> None:
    d = drafts_root() / draft_id.replace("/", "_").replace("..", "_")
    if not d.is_dir():
        return
    for child in sorted(d.iterdir(), reverse=True):
        if child.is_file():
            child.unlink()
    d.rmdir()
