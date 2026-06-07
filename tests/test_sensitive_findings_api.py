"""M5 sensitive findings — runtime API list, summary, acknowledge."""

from __future__ import annotations

import pytest
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db, get_db_read_bounded
from app.sensitive_detection import service as sensitive_detection_service
from app.sensitive_detection.detection import persist_sensitive_hits
from app.sensitive_detection.operator_workflow import normalize_status_filter
from app.sensitive_detection.schemas import (
    SensitiveFindingAcknowledgeRequest,
    SensitiveFindingAcknowledgeResponse,
    StreamSensitiveFindingsResponse,
    StreamSensitiveFindingsSummaryResponse,
)


def _sensitive_test_app() -> FastAPI:
    from app.audit.service import audit_actor_from_request
    from app.sensitive_detection.operator_workflow import (
        SensitiveFindingNotFoundError,
        SensitiveFindingStateError,
        acknowledge_sensitive_finding,
        build_sensitive_summary,
    )
    from app.streams.repository import get_stream_by_id

    router = APIRouter()

    @router.get("/streams/{stream_id}/sensitive-findings", response_model=StreamSensitiveFindingsResponse)
    async def get_findings(
        stream_id: int,
        status: str | None = Query("open"),
        db: Session = Depends(get_db_read_bounded),
    ) -> StreamSensitiveFindingsResponse:
        if get_stream_by_id(db, stream_id) is None:
            raise HTTPException(status_code=404, detail="stream not found")
        try:
            normalize_status_filter(status)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        payload = sensitive_detection_service.get_sensitive_findings_for_stream(
            db, stream_id, status_filter=status
        )
        return StreamSensitiveFindingsResponse.model_validate(payload)

    @router.get(
        "/streams/{stream_id}/sensitive-findings/summary",
        response_model=StreamSensitiveFindingsSummaryResponse,
    )
    async def get_summary(
        stream_id: int,
        db: Session = Depends(get_db_read_bounded),
    ) -> StreamSensitiveFindingsSummaryResponse:
        if get_stream_by_id(db, stream_id) is None:
            raise HTTPException(status_code=404, detail="stream not found")
        return StreamSensitiveFindingsSummaryResponse.model_validate(build_sensitive_summary(db, stream_id))

    @router.post(
        "/streams/{stream_id}/sensitive-findings/{finding_id}/acknowledge",
        response_model=SensitiveFindingAcknowledgeResponse,
    )
    async def post_ack(
        stream_id: int,
        finding_id: int,
        body: SensitiveFindingAcknowledgeRequest,
        request: Request,
        db: Session = Depends(get_db),
    ) -> SensitiveFindingAcknowledgeResponse:
        if get_stream_by_id(db, stream_id) is None:
            raise HTTPException(status_code=404, detail="stream not found")
        actor = audit_actor_from_request(request)
        try:
            finding = acknowledge_sensitive_finding(
                db,
                stream_id=stream_id,
                finding_id=finding_id,
                actor_username=actor.actor_username or "system",
                note=body.note,
            )
            db.commit()
        except SensitiveFindingNotFoundError:
            db.rollback()
            raise HTTPException(status_code=404, detail="finding not found") from None
        except SensitiveFindingStateError as exc:
            db.rollback()
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return SensitiveFindingAcknowledgeResponse(
            id=finding.id,
            stream_id=finding.stream_id,
            field_path=finding.field_path,
            sensitivity_class=finding.sensitivity_class,
            detection_method=finding.detection_method,
            status=finding.status,
            acknowledged_at=finding.acknowledged_at,  # type: ignore[arg-type]
            acknowledged_by=finding.acknowledged_by or "system",
            operator_note=finding.operator_note,
        )

    app = FastAPI()
    app.include_router(router, prefix="/api/v1/runtime")
    return app


@pytest.fixture
def sensitive_api_client(db_session: Session) -> TestClient:
    app = _sensitive_test_app()

    def _override_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_db_read_bounded] = _override_db
    yield TestClient(app)


@pytest.fixture
def sensitive_api_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.config.settings.GDC_SENSITIVE_DETECTION_ENABLED", True)
    monkeypatch.setattr("app.config.settings.GDC_SENSITIVE_DETECTION_CONFIRM_RUNS", 1)


def _seed_stream(db_session: Session) -> int:
    from app.connectors.models import Connector
    from app.sources.models import Source
    from app.streams.models import Stream

    connector = Connector(name="sens-api-conn", description="", status="STOPPED")
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
        name="sens-api-stream",
        stream_type="HTTP_API_POLLING",
        config_json={},
        enabled=True,
        status="STOPPED",
    )
    db_session.add(stream)
    db_session.commit()
    return stream.id


def test_list_and_summary_after_detection(
    db_session: Session,
    sensitive_api_client: TestClient,
    sensitive_api_settings: None,
) -> None:
    stream_id = _seed_stream(db_session)
    persist_sensitive_hits(db_session, stream_id=stream_id, events=[{"api_key": "redacted"}])
    db_session.commit()

    resp = sensitive_api_client.get(f"/api/v1/runtime/streams/{stream_id}/sensitive-findings")
    assert resp.status_code == 200
    body = resp.json()
    assert body["finding_count"] >= 1
    assert "api_key" in body["findings"][0]["field_path"]
    assert "redacted" not in str(body)

    summary = sensitive_api_client.get(f"/api/v1/runtime/streams/{stream_id}/sensitive-findings/summary")
    assert summary.status_code == 200
    assert summary.json()["open_count"] >= 1


def test_acknowledge_open_finding(
    db_session: Session,
    sensitive_api_client: TestClient,
    sensitive_api_settings: None,
) -> None:
    stream_id = _seed_stream(db_session)
    persist_sensitive_hits(db_session, stream_id=stream_id, events=[{"password": "x"}])
    db_session.commit()

    listing = sensitive_api_client.get(f"/api/v1/runtime/streams/{stream_id}/sensitive-findings")
    finding_id = listing.json()["findings"][0]["id"]

    ack = sensitive_api_client.post(
        f"/api/v1/runtime/streams/{stream_id}/sensitive-findings/{finding_id}/acknowledge",
        json={"note": "reviewed"},
    )
    assert ack.status_code == 200
    assert ack.json()["status"] == "acknowledged"


def test_acknowledge_409_when_unconfirmed(
    db_session: Session,
    sensitive_api_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.config.settings.GDC_SENSITIVE_DETECTION_ENABLED", True)
    monkeypatch.setattr("app.config.settings.GDC_SENSITIVE_DETECTION_CONFIRM_RUNS", 2)

    stream_id = _seed_stream(db_session)
    persist_sensitive_hits(db_session, stream_id=stream_id, events=[{"secret": "x"}])
    db_session.commit()

    from sqlalchemy import select
    from app.sensitive_detection.models import StreamSensitiveFinding

    row = db_session.execute(
        select(StreamSensitiveFinding).where(StreamSensitiveFinding.stream_id == stream_id)
    ).scalar_one()
    finding_id = row.id

    ack = sensitive_api_client.post(
        f"/api/v1/runtime/streams/{stream_id}/sensitive-findings/{finding_id}/acknowledge",
        json={},
    )
    assert ack.status_code == 409
