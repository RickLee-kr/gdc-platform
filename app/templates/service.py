"""Template instantiation — creates normal ORM rows (no runtime template engine)."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.connectors.router import _build_auth_json, _build_config_json
from app.connectors.schemas import ConnectorCreate
from app.destinations.models import Destination
from app.enrichments.models import Enrichment
from app.mappings.models import Mapping
from app.routes.models import Route
from app.sources.models import Source
from app.streams.models import Stream
from app.templates.registry import get_template_or_404
from app.templates.schemas import TemplateDefinition, TemplateInstantiateRequest, TemplateInstantiateResponse


def _shallow_merge_dict(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, value in (overlay or {}).items():
        out[key] = value
    return out


def _connector_create_from_template(template: TemplateDefinition, body: TemplateInstantiateRequest) -> ConnectorCreate:
    merged: dict[str, Any] = dict(template.connector_defaults or {})
    creds = dict(body.credentials or {})

    merged["name"] = body.connector_name.strip()
    if body.description is not None:
        merged["description"] = body.description

    host = body.host or creds.pop("host", None) or creds.pop("base_url", None)
    if not host:
        host = merged.pop("host", None) or merged.pop("base_url", None)
    if host:
        merged["host"] = str(host).strip()

    if "auth_type" not in merged or not merged.get("auth_type"):
        merged["auth_type"] = template.auth_type

    for key, value in creds.items():
        if value is not None:
            merged[key] = value

    try:
        return ConnectorCreate.model_validate(merged)
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error_code": "TEMPLATE_INSTANTIATE_VALIDATION", "message": str(exc)},
        ) from exc


def instantiate_template(db: Session, template_id: str, body: TemplateInstantiateRequest) -> TemplateInstantiateResponse:
    """Create connector/source/stream/mapping/enrichment/checkpoint and optional route in one transaction."""

    template = get_template_or_404(template_id)
    payload = _connector_create_from_template(template, body)

    connector = Connector(
        name=payload.name.strip(),
        description=payload.description,
        status=payload.status or "STOPPED",
    )
    db.add(connector)
    db.flush()

    source = Source(
        connector_id=connector.id,
        source_type=template.source_type or "HTTP_API_POLLING",
        config_json=_build_config_json(payload, partial=False),
        auth_json=_build_auth_json(payload, partial=False),
        enabled=True,
    )
    db.add(source)
    db.flush()

    cfg = _shallow_merge_dict(dict(source.config_json or {}), dict(template.source_config_overlay or {}))
    source.config_json = cfg
    db.add(source)

    sd = dict(template.stream_defaults or {})
    stream_name = (body.stream_name or sd.pop("name", None) or f"{template.name} stream").strip()
    stream_type = str(sd.pop("stream_type", None) or "HTTP_API_POLLING")
    polling_interval = int(sd.pop("polling_interval", None) or 60)
    stream_cfg = dict(sd.pop("config_json", None) or {})
    rate_limit = dict(sd.pop("rate_limit_json", None) or {})
    for extra_key, extra_val in sd.items():
        stream_cfg[extra_key] = extra_val

    stream_row = Stream(
        name=stream_name,
        connector_id=connector.id,
        source_id=source.id,
        stream_type=stream_type,
        config_json=stream_cfg,
        polling_interval=polling_interval,
        enabled=False,
        status="STOPPED",
        rate_limit_json=rate_limit,
    )
    db.add(stream_row)
    db.flush()

    md = dict(template.mapping_defaults or {})
    mapping_row = Mapping(
        stream_id=stream_row.id,
        event_array_path=md.get("event_array_path"),
        event_root_path=md.get("event_root_path"),
        field_mappings_json=dict(md.get("field_mappings_json") or {}),
        raw_payload_mode=md.get("raw_payload_mode"),
    )
    db.add(mapping_row)
    db.flush()

    ed = dict(template.enrichment_defaults or {})
    enrichment_row = Enrichment(
        stream_id=stream_row.id,
        enrichment_json=dict(ed.get("enrichment_json") or {}),
        override_policy=str(ed.get("override_policy") or "KEEP_EXISTING"),
        enabled=bool(ed.get("enabled", True)),
    )
    db.add(enrichment_row)
    db.flush()

    cd = dict(template.checkpoint_defaults or {})
    checkpoint_row = Checkpoint(
        stream_id=stream_row.id,
        checkpoint_type=str(cd.get("checkpoint_type") or "CUSTOM_FIELD"),
        checkpoint_value_json=dict(cd.get("checkpoint_value_json") or {}),
    )
    db.add(checkpoint_row)
    db.flush()

    route_id: int | None = None
    if body.destination_id is not None and body.create_route:
        dest = db.query(Destination).filter(Destination.id == int(body.destination_id)).first()
        if dest is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "error_code": "DESTINATION_NOT_FOUND",
                    "message": f"destination not found: {body.destination_id}",
                },
            )
        sugg: dict[str, Any] = {}
        if template.route_suggestions:
            sugg = dict(template.route_suggestions[0] or {})
        route_row = Route(
            stream_id=stream_row.id,
            destination_id=int(body.destination_id),
            enabled=bool(sugg.get("enabled", True)),
            failure_policy=str(sugg.get("failure_policy") or "LOG_AND_CONTINUE"),
            formatter_config_json=dict(sugg.get("formatter_config_json") or {}),
            rate_limit_json=dict(sugg.get("rate_limit_json") or {}),
            status="ENABLED" if bool(sugg.get("enabled", True)) else "DISABLED",
        )
        db.add(route_row)
        db.flush()
        route_id = int(route_row.id)

    db.commit()
    db.refresh(connector)
    db.refresh(source)
    db.refresh(stream_row)
    db.refresh(mapping_row)
    db.refresh(enrichment_row)
    db.refresh(checkpoint_row)

    if body.redirect_to == "connector_detail":
        redirect_path = f"/connectors/{connector.id}"
    else:
        redirect_path = f"/streams/{stream_row.id}/runtime"

    return TemplateInstantiateResponse(
        template_id=template.template_id,
        connector_id=int(connector.id),
        source_id=int(source.id),
        stream_id=int(stream_row.id),
        mapping_id=int(mapping_row.id),
        enrichment_id=int(enrichment_row.id),
        checkpoint_id=int(checkpoint_row.id),
        route_id=route_id,
        redirect_path=redirect_path,
    )
