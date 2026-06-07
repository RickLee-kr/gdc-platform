"""Connector template materialization orchestration."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.connector_templates.errors import MaterializationError
from app.connector_templates.materializer import materialize_stream_template
from app.connector_templates.schemas import MaterializeRequest, MaterializeResponse, MaterializedStreamRead
from app.connectors.models import Connector
from app.connectors_registry.service import _require_cache


def _validate_templates_request(templates: list[str]) -> list[str]:
    if not templates:
        raise MaterializationError(
            error_code="TEMPLATE_ID_REQUIRED",
            message="at least one template id is required",
            rule_id="TPL-001",
        )

    normalized: list[str] = []
    seen: set[str] = set()
    for raw in templates:
        template_id = str(raw or "").strip()
        if not template_id:
            raise MaterializationError(
                error_code="TEMPLATE_ID_REQUIRED",
                message="template id must be non-empty",
                rule_id="TPL-001",
            )
        if template_id in seen:
            raise MaterializationError(
                error_code="DUPLICATE_TEMPLATE",
                message=f"duplicate template id: {template_id}",
                rule_id="TPL-002",
            )
        seen.add(template_id)
        normalized.append(template_id)
    return normalized


def materialize_templates(db: Session, body: MaterializeRequest) -> MaterializeResponse:
    """Materialize selected stream templates for an existing connector."""

    template_ids = _validate_templates_request(body.templates)

    connector = db.query(Connector).filter(Connector.id == int(body.connector_id)).first()
    if connector is None:
        raise MaterializationError(
            error_code="CONNECTOR_NOT_FOUND",
            message=f"connector not found: {body.connector_id}",
        )

    module_id = body.module_id.strip()
    cache = _require_cache()
    entry = cache.get(module_id)
    if entry is None:
        raise MaterializationError(
            error_code="INVALID_MODULE",
            message=f"connector module not found: {module_id}",
            rule_id="TPL-005",
        )
    if entry.status != "valid":
        raise MaterializationError(
            error_code="INVALID_MODULE",
            message=f"connector module is invalid: {module_id}",
            rule_id="TPL-005",
        )
    if entry.manifest is None:
        raise MaterializationError(
            error_code="INVALID_MODULE",
            message=f"connector module manifest missing: {module_id}",
            rule_id="TPL-005",
        )

    created: list[MaterializedStreamRead] = []
    for template_id in template_ids:
        row = materialize_stream_template(
            db,
            connector=connector,
            entry=entry,
            template_id=template_id,
        )
        created.append(MaterializedStreamRead.model_validate(row))

    db.commit()
    return MaterializeResponse(
        module_id=module_id,
        connector_id=int(connector.id),
        created_streams=created,
    )
