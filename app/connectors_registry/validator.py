"""Manifest and resource validation rules for Connector Registry."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import ValidationError

from app.connectors_registry.errors import ValidationIssue
from app.connectors_registry.models import ConnectorManifest, ConnectorModuleResources, DocsMetadata


def _is_blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _stream_id_from_dict(data: dict[str, Any]) -> str | None:
    for key in ("id", "stream_id"):
        value = data.get(key)
        if not _is_blank(value):
            return str(value).strip()
    return None


def _stream_name_from_dict(data: dict[str, Any]) -> str | None:
    value = data.get("name")
    if not _is_blank(value):
        return str(value).strip()
    return None


def _stream_has_endpoint(data: dict[str, Any]) -> bool:
    if not _is_blank(data.get("source_path")):
        return True
    if not _is_blank(data.get("endpoint")):
        return True
    config_json = data.get("config_json")
    if isinstance(config_json, dict) and not _is_blank(config_json.get("endpoint")):
        return True
    return False


def validate_manifest_dict(
    raw: dict[str, Any],
    *,
    manifest_path: str,
) -> tuple[ConnectorManifest | None, list[ValidationIssue]]:
    """Apply MAN-001..MAN-004 to a parsed manifest document."""

    issues: list[ValidationIssue] = []
    connector_id = str(raw.get("id") or "").strip() or None

    if _is_blank(raw.get("id")):
        issues.append(
            ValidationIssue(
                rule_id="MAN-001",
                message="manifest id is required",
                connector_id=connector_id,
                path=manifest_path,
            )
        )

    if _is_blank(raw.get("vendor")):
        issues.append(
            ValidationIssue(
                rule_id="MAN-002",
                message="manifest vendor is required",
                connector_id=connector_id,
                path=manifest_path,
            )
        )

    streams = raw.get("streams")
    if not isinstance(streams, list) or len(streams) < 1:
        issues.append(
            ValidationIssue(
                rule_id="MAN-003",
                message="manifest must define at least one stream",
                connector_id=connector_id,
                path=manifest_path,
            )
        )

    auth = raw.get("auth")
    if not isinstance(auth, dict) or _is_blank(auth.get("type")):
        issues.append(
            ValidationIssue(
                rule_id="MAN-004",
                message="manifest auth definition with type is required",
                connector_id=connector_id,
                path=manifest_path,
            )
        )

    manifest: ConnectorManifest | None = None
    if connector_id is not None:
        try:
            manifest = ConnectorManifest.model_validate(raw)
        except ValidationError as exc:
            for err in exc.errors():
                issues.append(
                    ValidationIssue(
                        rule_id="MAN-002",
                        message=err.get("msg", "manifest validation failed"),
                        connector_id=connector_id,
                        path=manifest_path,
                    )
                )

    return manifest, issues


def detect_duplicate_ids(
    candidates: list[tuple[str, str]],
) -> tuple[set[str], list[ValidationIssue]]:
    """Apply MAN-005 across all candidate manifests (first path wins)."""

    seen: dict[str, str] = {}
    reject_paths: set[str] = set()
    issues: list[ValidationIssue] = []
    for connector_id, manifest_path in candidates:
        if connector_id in seen:
            reject_paths.add(manifest_path)
            issues.append(
                ValidationIssue(
                    rule_id="MAN-005",
                    message=f"duplicate connector id: {connector_id}",
                    connector_id=connector_id,
                    path=manifest_path,
                )
            )
            continue
        seen[connector_id] = manifest_path
    return reject_paths, issues


def validate_stream_template(
    stream_id: str,
    data: dict[str, Any],
    *,
    connector_id: str,
    path: str,
) -> list[ValidationIssue]:
    """Apply STR-001..STR-003 to a loaded stream template."""

    issues: list[ValidationIssue] = []

    resolved_id = _stream_id_from_dict(data)
    if resolved_id is None:
        issues.append(
            ValidationIssue(
                rule_id="STR-001",
                message="stream id is required",
                connector_id=connector_id,
                path=path,
            )
        )
    elif resolved_id != stream_id:
        issues.append(
            ValidationIssue(
                rule_id="STR-001",
                message=f"stream id mismatch: expected {stream_id}, got {resolved_id}",
                connector_id=connector_id,
                path=path,
            )
        )

    if _stream_name_from_dict(data) is None:
        issues.append(
            ValidationIssue(
                rule_id="STR-002",
                message="stream name is required",
                connector_id=connector_id,
                path=path,
            )
        )

    if not _stream_has_endpoint(data):
        issues.append(
            ValidationIssue(
                rule_id="STR-003",
                message="stream source_path or endpoint definition is required",
                connector_id=connector_id,
                path=path,
            )
        )

    return issues


def validate_mapping_json(
    mapping_id: str,
    data: Any,
    *,
    connector_id: str,
    path: str,
) -> list[ValidationIssue]:
    """Apply MAP-001 to a loaded mapping preset."""

    if not isinstance(data, dict):
        return [
            ValidationIssue(
                rule_id="MAP-001",
                message=f"mapping must be a JSON object: {mapping_id}",
                connector_id=connector_id,
                path=path,
            )
        ]
    return []


def validate_enrichment_json(
    enrichment_id: str,
    data: Any,
    *,
    connector_id: str,
    path: str,
) -> list[ValidationIssue]:
    """Apply ENR-001 to a loaded enrichment preset."""

    if not isinstance(data, dict):
        return [
            ValidationIssue(
                rule_id="ENR-001",
                message=f"enrichment must be a JSON object: {enrichment_id}",
                connector_id=connector_id,
                path=path,
            )
        ]
    return []


def validate_api_test_yaml(
    data: Any,
    *,
    connector_id: str,
    path: str,
) -> list[ValidationIssue]:
    """Apply API-001 to a loaded api_test.yaml document."""

    if not isinstance(data, dict):
        return [
            ValidationIssue(
                rule_id="API-001",
                message="api_test.yaml root must be an object",
                connector_id=connector_id,
                path=path,
            )
        ]
    return []


def extract_docs_metadata(docs_path: Path, *, relative_path: str) -> DocsMetadata:
    """Build docs metadata without returning full raw markdown."""

    text = docs_path.read_text(encoding="utf-8")
    lines = text.splitlines()
    title: str | None = None
    summary: str | None = None

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("#"):
            title = stripped.lstrip("#").strip()
            break

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        summary = stripped[:200]
        break

    return DocsMetadata(
        path=relative_path,
        title=title,
        summary=summary,
        line_count=len(lines),
    )


def build_resources_summary(resources: ConnectorModuleResources) -> ConnectorModuleResources:
    """Recompute summary counts from loaded resource payloads."""

    resources.summary = resources.summary.model_copy(
        update={
            "streams_count": len(resources.streams),
            "mappings_count": len(resources.mappings),
            "enrichments_count": len(resources.enrichments),
            "has_api_test": resources.api_test is not None,
            "has_docs": resources.docs is not None,
        }
    )
    return resources
