"""M6 protection — runtime API tests."""

from __future__ import annotations

import pytest
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db, get_db_read_bounded
from app.protection.schemas import (
    ProtectionRuleCreateRequest,
    ProtectionRulePatchRequest,
    ProtectionRuleResponse,
    SensitiveFindingResolveRequest,
    SensitiveFindingResolveResponse,
    StreamProtectionRulesResponse,
    StreamProtectionSummaryResponse,
)
from app.sensitive_detection.models import (
    FINDING_STATUS_ACKNOWLEDGED,
    FINDING_STATUS_OPEN,
    StreamSensitiveFinding,
)
from app.sensitive_detection.detection import persist_sensitive_hits


def _protection_test_app() -> FastAPI:
    from app.audit.service import audit_actor_from_request
    from app.protection.operator_workflow import (
        ProtectionRuleConflictError,
        ProtectionRuleNotFoundError,
        ProtectionRuleValidationError,
        SensitiveFindingNotFoundError,
        SensitiveFindingStateError,
        build_protection_summary,
        create_protection_rule,
        list_protection_rules,
        patch_protection_rule,
        resolve_sensitive_finding,
    )
    from app.protection.engine import protection_enabled
    from app.streams.repository import get_stream_by_id

    router = APIRouter()

    @router.get("/streams/{stream_id}/protection-rules", response_model=StreamProtectionRulesResponse)
    async def get_rules(
        stream_id: int,
        enabled_only: bool = Query(False),
        db: Session = Depends(get_db_read_bounded),
    ) -> StreamProtectionRulesResponse:
        if get_stream_by_id(db, stream_id) is None:
            raise HTTPException(status_code=404, detail="stream not found")
        rules = list_protection_rules(db, stream_id, enabled_only=enabled_only)
        return StreamProtectionRulesResponse(
            stream_id=stream_id,
            protection_enabled=protection_enabled(),
            rules=rules,
            rule_count=len(rules),
        )

    @router.get("/streams/{stream_id}/protection/summary", response_model=StreamProtectionSummaryResponse)
    async def get_summary(stream_id: int, db: Session = Depends(get_db_read_bounded)) -> StreamProtectionSummaryResponse:
        if get_stream_by_id(db, stream_id) is None:
            raise HTTPException(status_code=404, detail="stream not found")
        return StreamProtectionSummaryResponse.model_validate(build_protection_summary(db, stream_id))

    @router.post("/streams/{stream_id}/protection-rules", response_model=ProtectionRuleResponse)
    async def post_rule(
        stream_id: int,
        body: ProtectionRuleCreateRequest,
        request: Request,
        db: Session = Depends(get_db),
    ) -> ProtectionRuleResponse:
        if get_stream_by_id(db, stream_id) is None:
            raise HTTPException(status_code=404, detail="stream not found")
        actor = audit_actor_from_request(request)
        try:
            rule = create_protection_rule(
                db,
                stream_id=stream_id,
                field_path=body.field_path,
                sensitivity_class=body.sensitivity_class,
                protection_mode=body.protection_mode,
                source_finding_id=body.source_finding_id,
                enabled=body.enabled,
                actor_username=actor.actor_username or "system",
            )
            db.commit()
        except ProtectionRuleConflictError:
            db.rollback()
            raise HTTPException(status_code=409, detail="conflict") from None
        except (ProtectionRuleValidationError, SensitiveFindingStateError) as exc:
            db.rollback()
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except SensitiveFindingNotFoundError:
            db.rollback()
            raise HTTPException(status_code=404, detail="finding not found") from None
        entries = list_protection_rules(db, stream_id)
        entry = next(e for e in entries if e["id"] == rule.id)
        return ProtectionRuleResponse(rule=entry)  # type: ignore[arg-type]

    @router.patch("/streams/{stream_id}/protection-rules/{rule_id}", response_model=ProtectionRuleResponse)
    async def patch_rule(
        stream_id: int,
        rule_id: int,
        body: ProtectionRulePatchRequest,
        db: Session = Depends(get_db),
    ) -> ProtectionRuleResponse:
        try:
            patch_protection_rule(
                db,
                stream_id=stream_id,
                rule_id=rule_id,
                protection_mode=body.protection_mode,
                enabled=body.enabled,
                sensitivity_class=body.sensitivity_class,
            )
            db.commit()
        except ProtectionRuleNotFoundError:
            db.rollback()
            raise HTTPException(status_code=404, detail="rule not found") from None
        entries = list_protection_rules(db, stream_id)
        entry = next(e for e in entries if e["id"] == rule_id)
        return ProtectionRuleResponse(rule=entry)  # type: ignore[arg-type]

    @router.post(
        "/streams/{stream_id}/sensitive-findings/{finding_id}/resolve",
        response_model=SensitiveFindingResolveResponse,
    )
    async def post_resolve(
        stream_id: int,
        finding_id: int,
        body: SensitiveFindingResolveRequest,
        request: Request,
        db: Session = Depends(get_db),
    ) -> SensitiveFindingResolveResponse:
        actor = audit_actor_from_request(request)
        try:
            finding = resolve_sensitive_finding(
                db,
                stream_id=stream_id,
                finding_id=finding_id,
                resolution=body.resolution,
                actor_username=actor.actor_username or "system",
                note=body.note,
            )
            db.commit()
        except SensitiveFindingNotFoundError:
            db.rollback()
            raise HTTPException(status_code=404, detail="not found") from None
        except SensitiveFindingStateError as exc:
            db.rollback()
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        fj = finding.finding_json if isinstance(finding.finding_json, dict) else None
        return SensitiveFindingResolveResponse(
            id=finding.id,
            stream_id=finding.stream_id,
            field_path=finding.field_path,
            sensitivity_class=finding.sensitivity_class,
            detection_method=finding.detection_method,
            status=finding.status,
            resolution=finding.resolution,
            resolved_at=finding.resolved_at,
            resolved_by=finding.resolved_by,
            operator_note=finding.operator_note,
            finding=fj,
        )

    app = FastAPI()
    app.include_router(router, prefix="/api/v1/runtime")
    return app


@pytest.fixture
def protection_api_client(db_session: Session) -> TestClient:
    app = _protection_test_app()

    def _override_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_db_read_bounded] = _override_db
    yield TestClient(app)


def _seed_stream(db_session: Session) -> int:
    from app.connectors.models import Connector
    from app.sources.models import Source
    from app.streams.models import Stream

    connector = Connector(name="prot-api-conn", description="", status="STOPPED")
    db_session.add(connector)
    db_session.flush()
    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={},
        auth_json={},
        enabled=True,
    )
    db_session.add(source)
    db_session.flush()
    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name="prot-api-stream",
        stream_type="HTTP_API_POLLING",
        config_json={},
        enabled=True,
        status="STOPPED",
    )
    db_session.add(stream)
    db_session.commit()
    return stream.id


@pytest.fixture
def protection_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.config.settings.GDC_SENSITIVE_DETECTION_ENABLED", True)
    monkeypatch.setattr("app.config.settings.GDC_SENSITIVE_DETECTION_CONFIRM_RUNS", 1)
    monkeypatch.setattr("app.config.settings.GDC_PROTECTION_ENABLED", True)


def test_create_rule_requires_acknowledged_finding(
    db_session: Session,
    protection_api_client: TestClient,
    protection_settings: None,
) -> None:
    stream_id = _seed_stream(db_session)
    persist_sensitive_hits(db_session, stream_id=stream_id, events=[{"api_key": "x"}])
    db_session.commit()
    finding = db_session.query(StreamSensitiveFinding).filter_by(stream_id=stream_id).one()
    assert finding.status == FINDING_STATUS_OPEN

    res = protection_api_client.post(
        f"/api/v1/runtime/streams/{stream_id}/protection-rules",
        json={
            "field_path": finding.field_path,
            "sensitivity_class": finding.sensitivity_class,
            "protection_mode": "full_mask",
            "source_finding_id": finding.id,
        },
    )
    assert res.status_code == 400

    finding.status = FINDING_STATUS_ACKNOWLEDGED
    finding.confirm_run_count = 1
    db_session.commit()

    res2 = protection_api_client.post(
        f"/api/v1/runtime/streams/{stream_id}/protection-rules",
        json={
            "field_path": finding.field_path,
            "sensitivity_class": finding.sensitivity_class,
            "protection_mode": "full_mask",
            "source_finding_id": finding.id,
        },
    )
    assert res2.status_code == 200
    assert res2.json()["rule"]["protection_mode"] == "full_mask"


def test_patch_disable_and_false_positive_resolve(
    db_session: Session,
    protection_api_client: TestClient,
    protection_settings: None,
) -> None:
    stream_id = _seed_stream(db_session)
    persist_sensitive_hits(db_session, stream_id=stream_id, events=[{"password": "p"}])
    db_session.commit()
    finding = db_session.query(StreamSensitiveFinding).filter_by(stream_id=stream_id).one()
    finding.status = FINDING_STATUS_ACKNOWLEDGED
    finding.confirm_run_count = 1
    db_session.commit()

    create = protection_api_client.post(
        f"/api/v1/runtime/streams/{stream_id}/protection-rules",
        json={
            "field_path": finding.field_path,
            "sensitivity_class": finding.sensitivity_class,
            "protection_mode": "full_mask",
            "source_finding_id": finding.id,
        },
    )
    rule_id = create.json()["rule"]["id"]

    patch = protection_api_client.patch(
        f"/api/v1/runtime/streams/{stream_id}/protection-rules/{rule_id}",
        json={"enabled": False},
    )
    assert patch.status_code == 200
    assert patch.json()["rule"]["enabled"] is False

    summary = protection_api_client.get(f"/api/v1/runtime/streams/{stream_id}/protection/summary")
    assert summary.status_code == 200
    assert summary.json()["disabled_rule_count"] == 1
