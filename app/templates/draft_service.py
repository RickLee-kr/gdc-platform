"""Template Draft CRUD — PostgreSQL index + filesystem artifacts."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.templates.draft_schemas import (
    TemplateDraftCreateRequest,
    TemplateDraftDetail,
    TemplateDraftRequestStructure,
    TemplateDraftSummary,
    TemplateDraftWizardPayload,
)
from app.templates.draft_storage import (
    delete_draft_artifacts,
    new_draft_id,
    read_draft_artifacts,
    write_draft_artifacts,
)
from app.templates.inference.engine import run_sample_inference
from app.templates.models import TemplateDraft


def _infer_vendor_product_from_url(base_url: str | None) -> tuple[str | None, str | None]:
    if not base_url:
        return None, None
    try:
        from urllib.parse import urlparse

        host = urlparse(base_url).hostname or ""
        parts = [p for p in host.split(".") if p and p not in ("www", "api")]
        if len(parts) >= 2:
            return parts[-2], parts[-1]
        if parts:
            return parts[0], None
    except Exception:
        pass
    return None, None


def preview_inference(body: dict[str, Any]) -> dict[str, Any]:
    return run_sample_inference(
        body.get("sample_payload"),
        event_array_hint=body.get("event_array_hint"),
        vendor=body.get("vendor"),
        product=body.get("product"),
        source_type=str(body.get("source_type") or "HTTP_API_POLLING"),
        approved_event_array_path=body.get("approved_event_array_path"),
        approved_mapping_candidates=body.get("approved_mapping_candidates"),
    )


def create_draft(db: Session, req: TemplateDraftCreateRequest) -> TemplateDraftDetail:
    draft_id = new_draft_id()
    inference = dict(req.approved_inference or {})
    if not inference and req.sample_payload is not None:
        inference = run_sample_inference(
            req.sample_payload,
            vendor=req.vendor,
            product=req.product,
            source_type=req.source_type,
            approved_event_array_path=inference.get("event_array_path"),
            approved_mapping_candidates=inference.get("mapping_candidates"),
        )

    vendor = req.vendor
    product = req.product
    if not vendor and req.request_structure.base_url:
        v, p = _infer_vendor_product_from_url(req.request_structure.base_url)
        vendor = vendor or v
        product = product or p

    mapping_candidate = list(inference.get("mapping_candidates") or [])
    enrichment_candidate = list(inference.get("enrichment_candidates") or [])
    checkpoint_candidate = inference.get("checkpoint_recommendation")

    manifest = {
        "template_id": draft_id,
        "status": "draft",
        "display_name": req.display_name,
        "description": req.description,
        "vendor": vendor,
        "product": product,
        "use_case": req.use_case,
        "source_type": req.source_type,
        "api_family": req.api_family,
        "api_version": req.api_version,
        "auth_type": req.auth_type,
        "import_source": req.import_source,
        "event_array_path": inference.get("event_array_path"),
        "metadata": dict(req.metadata or {}),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    mapping_doc = {
        "event_array_path": inference.get("event_array_path"),
        "field_mappings_json": {
            row["output_field"]: row["source_json_path"]
            for row in mapping_candidate
            if row.get("output_field") and row.get("source_json_path")
        },
        "candidates": mapping_candidate,
    }
    enrichment_doc = {
        "enrichment_json": {
            row["field_name"]: row.get("suggested_value")
            for row in enrichment_candidate
            if row.get("field_name")
        },
        "candidates": enrichment_candidate,
    }

    storage_path = write_draft_artifacts(
        draft_id,
        manifest=manifest,
        request=req.request_structure.model_dump(),
        mapping=mapping_doc,
        enrichment=enrichment_doc,
        sample_raw=req.sample_payload,
        sample_normalized=inference.get("normalized_event_preview"),
    )

    meta = {
        "inference": inference,
        "connector_draft": req.connector_draft,
        "stream_draft": req.stream_draft,
    }

    row = TemplateDraft(
        id=draft_id,
        display_name=req.display_name.strip(),
        description=req.description,
        vendor=vendor,
        product=product,
        use_case=req.use_case,
        source_type=req.source_type,
        api_family=req.api_family,
        api_version=req.api_version,
        auth_type=req.auth_type,
        import_source=req.import_source,
        storage_path=storage_path,
        metadata_json=meta,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _row_to_detail(row)


def list_drafts(db: Session) -> list[TemplateDraftSummary]:
    rows = db.query(TemplateDraft).order_by(TemplateDraft.created_at.desc()).all()
    return [_row_to_summary(r) for r in rows]


def get_draft(db: Session, draft_id: str) -> TemplateDraftDetail | None:
    row = db.get(TemplateDraft, draft_id)
    if row is None:
        return None
    return _row_to_detail(row)


def delete_draft(db: Session, draft_id: str) -> bool:
    row = db.get(TemplateDraft, draft_id)
    if row is None:
        return False
    delete_draft_artifacts(draft_id)
    db.delete(row)
    db.commit()
    return True


def clone_draft(db: Session, draft_id: str) -> TemplateDraftDetail | None:
    existing = get_draft(db, draft_id)
    if existing is None:
        return None
    artifacts = read_draft_artifacts(draft_id)
    req = TemplateDraftCreateRequest(
        display_name=f"{existing.display_name} (copy)",
        description=existing.description,
        vendor=existing.vendor,
        product=existing.product,
        use_case=existing.use_case,
        source_type=existing.source_type,
        api_family=existing.api_family,
        api_version=existing.api_version,
        auth_type=existing.auth_type,
        import_source=existing.import_source,  # type: ignore[arg-type]
        request_structure=TemplateDraftRequestStructure.model_validate(artifacts["request"]),
        sample_payload=artifacts.get("sample_raw"),
        approved_inference=existing.inference,
        connector_draft=existing.connector_draft,
        stream_draft=existing.stream_draft,
        metadata=dict(existing.metadata or {}),
    )
    return create_draft(db, req)


def wizard_payload(db: Session, draft_id: str) -> TemplateDraftWizardPayload | None:
    detail = get_draft(db, draft_id)
    if detail is None:
        return None
    connector = detail.connector_draft
    if not connector:
        connector = {
            "name": detail.display_name,
            "description": detail.description or f"From template draft {draft_id}",
            "status": "STOPPED",
            "source_type": detail.source_type,
            "connector_type": "generic_http",
            "base_url": (detail.request_structure or {}).get("base_url") or "",
            "verify_ssl": True,
            "common_headers": {},
            "auth_type": detail.auth_type or "no_auth",
        }
        req = detail.request_structure or {}
        headers = req.get("headers_masked") or {}
        if isinstance(headers, dict):
            connector["common_headers"] = {str(k): str(v) for k, v in headers.items()}

    stream = detail.stream_draft
    if not stream:
        req = detail.request_structure or {}
        stream = {
            "name": f"{detail.display_name} stream",
            "stream_type": detail.source_type,
            "enabled": False,
            "status": "STOPPED",
            "config_json": {
                "endpoint": req.get("endpoint") or "/",
                "method": req.get("method") or "GET",
                "params": req.get("query_params") or {},
            },
            "polling_interval": 60,
        }
        if req.get("body") is not None:
            stream["config_json"]["body"] = req["body"]

    return TemplateDraftWizardPayload(connector_draft=connector, stream_draft=stream)


def build_inference_from_import(
    *,
    sample_payload: Any | None,
    request_base_url: str | None,
    vendor: str | None = None,
    product: str | None = None,
) -> dict[str, Any]:
    if sample_payload is None:
        return run_sample_inference({}, vendor=vendor, product=product)
    return run_sample_inference(sample_payload, vendor=vendor, product=product)


def _row_to_summary(row: TemplateDraft) -> TemplateDraftSummary:
    return TemplateDraftSummary(
        id=row.id,
        display_name=row.display_name,
        vendor=row.vendor,
        product=row.product,
        use_case=row.use_case,
        source_type=row.source_type,
        api_version=row.api_version,
        auth_type=row.auth_type,
        import_source=row.import_source,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _row_to_detail(row: TemplateDraft) -> TemplateDraftDetail:
    meta = dict(row.metadata_json or {})
    inference = dict(meta.get("inference") or {})
    try:
        artifacts = read_draft_artifacts(row.id)
    except FileNotFoundError:
        artifacts = {}

    mapping_doc = artifacts.get("mapping") or {}
    enrichment_doc = artifacts.get("enrichment") or {}
    manifest = artifacts.get("manifest") or {}

    return TemplateDraftDetail(
        id=row.id,
        display_name=row.display_name,
        description=row.description,
        vendor=row.vendor or manifest.get("vendor"),
        product=row.product or manifest.get("product"),
        use_case=row.use_case or manifest.get("use_case"),
        source_type=row.source_type,
        api_family=row.api_family,
        api_version=row.api_version,
        auth_type=row.auth_type,
        import_source=row.import_source,
        created_at=row.created_at,
        updated_at=row.updated_at,
        request_structure=artifacts.get("request") or {},
        inference=inference,
        mapping_candidate=list(mapping_doc.get("candidates") or inference.get("mapping_candidates") or []),
        enrichment_candidate=list(enrichment_doc.get("candidates") or inference.get("enrichment_candidates") or []),
        checkpoint_candidate=inference.get("checkpoint_recommendation"),
        sample_payload=artifacts.get("sample_raw"),
        metadata=dict(manifest.get("metadata") or {}),
        connector_draft=meta.get("connector_draft"),
        stream_draft=meta.get("stream_draft"),
        normalized_event_preview=artifacts.get("sample_normalized") or inference.get("normalized_event_preview"),
    )
