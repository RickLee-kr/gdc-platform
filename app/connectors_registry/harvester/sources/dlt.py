"""dlt RESTAPIConfig static harvester (M29.6 / W7).

Reads declarative RESTAPIConfig evidence from YAML/JSON fixtures or Python
AST dict literals. Does NOT import or execute dlt.
"""

from __future__ import annotations

import ast
import json
from pathlib import Path
from typing import Any, Mapping

import yaml

from app.connectors_registry.harvester.models import (
    AuthKnowledge,
    CheckpointKnowledge,
    EvidenceRef,
    HarvestInputMode,
    HarvestedIntegrationKnowledge,
    LicenseKnowledge,
    MappingStatus,
    PaginationKnowledge,
    ProvenanceKnowledge,
    StreamKnowledge,
)
from app.connectors_registry.harvester.normalizer import normalize_harvested_dict
from app.connectors_registry.harvester.sources.base import HarvesterSourceAdapter

_STRUCTURED_NAMES = (
    "harvester.json",
    "harvester.yaml",
    "harvester.yml",
    "rest_api.yaml",
    "rest_api.yml",
    "rest_api.json",
    "dlt_rest.yaml",
    "dlt_rest.yml",
    "dlt_rest.json",
    "metadata.json",
    "metadata.yaml",
    "metadata.yml",
)

_PAGINATOR_STYLE: dict[str, str] = {
    "json_link": "next_link",
    "header_link": "next_link",
    "header_cursor": "cursor",
    "cursor": "cursor",
    "offset": "offset",
    "page_number": "page",
    "single_page": "single_page",
    "auto": "auto",
}

_AUTH_MAP: dict[str, str] = {
    "bearer": "bearer",
    "api_key": "api_key",
    "http_basic": "basic",
    "basic": "basic",
    "oauth2_client_credentials": "oauth2_client_credentials",
}


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _load_yaml(path: Path) -> Any:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _load_structured(path: Path) -> Any:
    suffix = path.suffix.lower()
    if suffix == ".json":
        return _load_json(path)
    if suffix in {".yaml", ".yml"}:
        return _load_yaml(path)
    raise ValueError(f"unsupported structured metadata format: {path}")


def _find_first(root: Path, names: tuple[str, ...]) -> Path | None:
    for name in names:
        candidate = root / name
        if candidate.is_file():
            return candidate
    if root.is_dir():
        for child in sorted(root.iterdir()):
            if not child.is_dir() or child.name.startswith("."):
                continue
            for name in names:
                candidate = child / name
                if candidate.is_file():
                    return candidate
    return None


def _as_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _literal_to_python(node: ast.AST) -> Any:
    """Convert a subset of AST nodes to Python literals (no eval/exec)."""

    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Dict):
        out: dict[Any, Any] = {}
        for k, v in zip(node.keys, node.values):
            if k is None:
                continue
            out[_literal_to_python(k)] = _literal_to_python(v)
        return out
    if isinstance(node, ast.List):
        return [_literal_to_python(elt) for elt in node.elts]
    if isinstance(node, ast.Tuple):
        return [_literal_to_python(elt) for elt in node.elts]
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub) and isinstance(node.operand, ast.Constant):
        if isinstance(node.operand.value, (int, float)):
            return -node.operand.value
    if isinstance(node, ast.Name):
        # Dynamic name reference — unsupported for static harvest.
        return {"__dynamic__": node.id}
    if isinstance(node, (ast.Call, ast.Attribute, ast.Subscript, ast.BinOp, ast.JoinedStr)):
        return {"__unsupported__": type(node).__name__}
    return {"__unsupported__": type(node).__name__}


def _extract_rest_api_dicts_from_python(source: str) -> list[dict[str, Any]]:
    """Find dict literals passed to rest_api_source(...) via AST only."""

    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []
    found: list[dict[str, Any]] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        name = None
        if isinstance(func, ast.Name):
            name = func.id
        elif isinstance(func, ast.Attribute):
            name = func.attr
        if name != "rest_api_source":
            continue
        if not node.args:
            continue
        literal = _literal_to_python(node.args[0])
        if isinstance(literal, dict) and "__unsupported__" not in literal and "__dynamic__" not in literal:
            found.append(literal)
    return found


def _auth_from_client(client: Mapping[str, Any], evidence_path: str) -> AuthKnowledge:
    auth_raw = client.get("auth")
    auth_type = None
    required: list[str] = []
    if isinstance(auth_raw, str):
        auth_type = _AUTH_MAP.get(auth_raw.lower().strip())
    elif isinstance(auth_raw, Mapping):
        kind = _as_str(auth_raw.get("type") or auth_raw.get("auth_type"))
        if kind:
            auth_type = _AUTH_MAP.get(kind.lower())
        for key in ("name", "api_key", "token", "username", "password", "client_id", "client_secret"):
            if key in auth_raw:
                required.append(key)
    base_url = _as_str(client.get("base_url"))
    return AuthKnowledge(
        auth_type=auth_type,
        api_base_url_hint=base_url,
        required_fields=required,
        evidence=[EvidenceRef(source_path=evidence_path, confidence="medium")],
    )


def _pagination_from(raw: Any, evidence_path: str) -> PaginationKnowledge | None:
    if raw is None:
        return None
    style = None
    param = None
    if isinstance(raw, str):
        style = _PAGINATOR_STYLE.get(raw.lower().strip(), raw.lower().strip())
    elif isinstance(raw, Mapping):
        kind = _as_str(raw.get("type") or raw.get("paginator_type") or raw.get("style"))
        if kind:
            style = _PAGINATOR_STYLE.get(kind.lower(), kind.lower())
        param = _as_str(
            raw.get("param_name")
            or raw.get("cursor_path")
            or raw.get("offset_param")
            or raw.get("page_param")
        )
    if not style and not param:
        return None
    return PaginationKnowledge(
        style=style,
        param_name=param,
        evidence=[EvidenceRef(source_path=evidence_path, confidence="medium")],
    )


def _checkpoint_from_incremental(raw: Any, evidence_path: str) -> CheckpointKnowledge | None:
    if not isinstance(raw, Mapping):
        return None
    # Fetch-watermark hints only — never ACK-after-extract semantics.
    cursor = _as_str(raw.get("cursor_path") or raw.get("cursor_field") or raw.get("start_param"))
    time_field = _as_str(raw.get("end_param") or raw.get("time_field"))
    if not cursor and not time_field:
        return None
    return CheckpointKnowledge(
        cursor_field=cursor,
        time_field=time_field,
        evidence=[EvidenceRef(source_path=evidence_path, confidence="medium")],
    )


def _streams_from_rest_config(config: Mapping[str, Any], evidence_path: str) -> tuple[list[StreamKnowledge], list[str]]:
    notes: list[str] = []
    client = config.get("client") if isinstance(config.get("client"), Mapping) else {}
    client_paginator = _pagination_from(client.get("paginator") if isinstance(client, Mapping) else None, evidence_path)

    resources = config.get("resources")
    if not isinstance(resources, list):
        return [], notes

    streams: list[StreamKnowledge] = []
    for entry in resources:
        if isinstance(entry, str):
            notes.append(f"resource {entry!r} is a string reference only; no static endpoint")
            continue
        if not isinstance(entry, Mapping):
            notes.append("skipped non-mapping resource entry")
            continue
        # Detect dynamic / unsupported markers from AST conversion.
        if any(isinstance(v, dict) and ("__unsupported__" in v or "__dynamic__" in v) for v in entry.values()):
            notes.append(f"resource {entry.get('name')!r} has dynamic configuration; left unsupported")
            continue

        name = _as_str(entry.get("name")) or _as_str(entry.get("resource_name"))
        endpoint = entry.get("endpoint") if isinstance(entry.get("endpoint"), Mapping) else entry
        if not isinstance(endpoint, Mapping):
            continue
        path = _as_str(endpoint.get("path") or entry.get("path"))
        method = _as_str(endpoint.get("method") or entry.get("http_method") or entry.get("method"))
        if method:
            method = method.upper()
        params = endpoint.get("params") if isinstance(endpoint.get("params"), Mapping) else {}
        data_selector = _as_str(endpoint.get("data_selector") or entry.get("data_selector"))
        paginator = _pagination_from(endpoint.get("paginator") or entry.get("paginator"), evidence_path) or client_paginator
        checkpoint = _checkpoint_from_incremental(
            endpoint.get("incremental") or entry.get("incremental"),
            evidence_path,
        )
        depends = entry.get("depends_on") or entry.get("parent") or entry.get("resource_dependencies")
        if depends:
            notes.append(f"resource {name}: dependency/parent hint {depends!r} (knowledge only)")

        if not name:
            name = path or "unnamed_resource"

        streams.append(
            StreamKnowledge(
                name=name,
                http_method=method,
                path=path,
                query_parameters=dict(params) if isinstance(params, Mapping) else {},
                event_array_path_hint=data_selector,
                pagination=paginator,
                checkpoint=checkpoint,
                evidence=[EvidenceRef(source_path=evidence_path, confidence="medium")],
            )
        )

    return streams, notes


def _license_from_root(root: Path) -> LicenseKnowledge:
    for lic_name in ("LICENSE", "LICENSE.md", "LICENSE.txt"):
        lic_path = root / lic_name if root.is_dir() else None
        if lic_path is None or not lic_path.is_file():
            continue
        text = lic_path.read_text(encoding="utf-8", errors="replace")[:2000]
        upper = text.upper()
        identifier = None
        if "MIT LICENSE" in upper or upper.strip().startswith("MIT"):
            identifier = "MIT"
        elif "APACHE LICENSE" in upper and "2.0" in upper:
            identifier = "Apache-2.0"
        return LicenseKnowledge(identifier=identifier, source="static_file" if identifier else None)
    return LicenseKnowledge()


def _from_rest_api_config(
    config: Mapping[str, Any],
    *,
    evidence_path: str,
    input_mode: HarvestInputMode,
    root_name: str,
    license: LicenseKnowledge | None = None,
) -> HarvestedIntegrationKnowledge:
    client = config.get("client") if isinstance(config.get("client"), Mapping) else {}
    auth = _auth_from_client(client if isinstance(client, Mapping) else {}, evidence_path)
    streams, notes = _streams_from_rest_config(config, evidence_path)
    notes.insert(0, "Harvested from static dlt RESTAPIConfig evidence only; dlt was not executed.")

    http_streams = [s for s in streams if s.path and s.http_method]
    if http_streams:
        mapping_status = MappingStatus.MAPPED
        proposed = "HTTP_API_POLLING"
        mapping_reason = "dlt resources include explicit REST path+method evidence"
        streams = http_streams
    elif streams:
        mapping_status = MappingStatus.UNSUPPORTED
        proposed = None
        mapping_reason = (
            "dlt resources present but missing explicit REST path+method; "
            "knowledge retained without executable Source Pack mapping"
        )
    else:
        mapping_status = MappingStatus.UNSUPPORTED
        proposed = None
        mapping_reason = "no dlt REST resources found"

    project = _as_str(config.get("name")) or root_name
    return HarvestedIntegrationKnowledge(
        provenance=ProvenanceKnowledge(
            ecosystem="dlt",
            upstream_project=project,
            vendor="dlt",
            product=project,
            integration_name=project,
            upstream_path=root_name,
            import_method=input_mode.value,
            evidence=[EvidenceRef(source_path=evidence_path, confidence="medium")],
        ),
        license=license or LicenseKnowledge(),
        auth=auth,
        streams=streams,
        proposed_source_type=proposed,
        mapping_status=mapping_status,
        mapping_reason=mapping_reason,
        notes=notes,
        raw_metadata={"rest_api_config_keys": sorted(str(k) for k in config.keys())},
    )


class DltHarvesterAdapter(HarvesterSourceAdapter):
    """Static dlt RESTAPIConfig knowledge adapter."""

    ecosystem = "dlt"

    def harvest(
        self,
        *,
        path: Path,
        input_mode: HarvestInputMode,
        fixture_overrides: Mapping[str, Any] | None = None,
    ) -> HarvestedIntegrationKnowledge:
        root = Path(path)

        if input_mode == HarvestInputMode.STRUCTURED_METADATA_FIXTURE:
            if root.is_file():
                data = _load_structured(root)
                evidence_path = root.name
            else:
                structured = _find_first(root, _STRUCTURED_NAMES)
                if structured is None:
                    raise ValueError(f"no structured dlt metadata found under {root}")
                data = _load_structured(structured)
                evidence_path = structured.name
            if not isinstance(data, Mapping):
                raise ValueError("dlt structured metadata must be a mapping")
            # Pre-normalized harvester knowledge (identity/streams) vs raw RESTAPIConfig.
            if "identity" in data or "provenance" in data or "mapping_status" in data:
                merged = dict(data)
                if fixture_overrides:
                    merged.update(dict(fixture_overrides))
                if "ecosystem" not in merged and "identity" not in merged:
                    merged["ecosystem"] = "dlt"
                return normalize_harvested_dict(
                    merged,
                    default_ecosystem="dlt",
                    default_import_method=input_mode.value,
                )
            # Raw RESTAPIConfig shape
            rest = data.get("rest_api") if isinstance(data.get("rest_api"), Mapping) else data
            if not isinstance(rest, Mapping):
                raise ValueError("dlt RESTAPIConfig must be a mapping")
            lic = LicenseKnowledge()
            if isinstance(data.get("license"), Mapping):
                lic = LicenseKnowledge(
                    identifier=_as_str(data["license"].get("identifier")),
                    source=_as_str(data["license"].get("source")),
                    notice_required=bool(data["license"]["notice_required"])
                    if "notice_required" in data["license"]
                    else None,
                )
            return _from_rest_api_config(
                rest,
                evidence_path=evidence_path,
                input_mode=input_mode,
                root_name=root.stem if root.is_file() else root.name,
                license=lic,
            )

        if not root.is_dir():
            raise ValueError(f"dlt harvest path must be a directory for {input_mode.value}: {root}")

        structured = _find_first(root, _STRUCTURED_NAMES)
        if structured is not None:
            data = _load_structured(structured)
            if isinstance(data, Mapping):
                if "identity" in data or "provenance" in data or "mapping_status" in data:
                    merged = dict(data)
                    if fixture_overrides:
                        merged.update(dict(fixture_overrides))
                    return normalize_harvested_dict(
                        merged,
                        default_ecosystem="dlt",
                        default_import_method=input_mode.value,
                    )
                rest = data.get("rest_api") if isinstance(data.get("rest_api"), Mapping) else data
                if isinstance(rest, Mapping) and ("client" in rest or "resources" in rest):
                    return _from_rest_api_config(
                        rest,
                        evidence_path=structured.name,
                        input_mode=input_mode,
                        root_name=root.name,
                        license=_license_from_root(root),
                    )

        # Python AST: look for rest_api_source({...}) dict literals.
        py_files = sorted(root.rglob("*.py"))
        for py in py_files:
            if py.name.startswith("."):
                continue
            text = py.read_text(encoding="utf-8", errors="replace")
            configs = _extract_rest_api_dicts_from_python(text)
            for cfg in configs:
                if isinstance(cfg, Mapping) and ("client" in cfg or "resources" in cfg):
                    return _from_rest_api_config(
                        cfg,
                        evidence_path=str(py.relative_to(root)),
                        input_mode=input_mode,
                        root_name=root.name,
                        license=_license_from_root(root),
                    )

        return HarvestedIntegrationKnowledge(
            provenance=ProvenanceKnowledge(
                ecosystem="dlt",
                upstream_project=root.name,
                vendor="dlt",
                product=root.name,
                integration_name=root.name,
                upstream_path=str(root.name),
                import_method=input_mode.value,
            ),
            license=_license_from_root(root),
            mapping_status=MappingStatus.UNSUPPORTED,
            mapping_reason="no static dlt RESTAPIConfig evidence found",
            notes=[
                "Harvested from static dlt files only; dlt was not executed.",
                "No RESTAPIConfig YAML/JSON or rest_api_source dict literal found.",
            ],
        )
