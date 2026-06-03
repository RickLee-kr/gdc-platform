"""Schema drift M4 — operator workflow API, baseline reset, migration."""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from app.database import get_db, get_db_read_bounded
from app.schema_observation import service as schema_observation_service
from app.schema_observation.models import (
    DRIFT_RESOLUTION_BASELINE_RESET,
    DRIFT_STATUS_ACKNOWLEDGED,
    DRIFT_STATUS_OPEN,
    DRIFT_STATUS_RESOLVED,
    StreamObservedSchema,
    StreamSchemaFieldDrift,
)
from app.schema_observation.operator_workflow import normalize_status_filter
from app.schema_observation.schemas import (
    SchemaBaselineResetRequest,
    SchemaBaselineResetResponse,
    SchemaFieldDriftAcknowledgeRequest,
    SchemaFieldDriftAcknowledgeResponse,
    StreamSchemaFieldDriftsResponse,
    StreamSchemaFieldDriftsSummaryResponse,
)
from app.schema_observation.service import observe_extracted_events


def _m4_test_app() -> FastAPI:
    from app.audit.service import audit_actor_from_request
    from app.schema_observation.operator_workflow import (
        DriftFindingNotFoundError,
        DriftFindingStateError,
        ObservedSchemaNotFoundError,
        acknowledge_field_drift,
        build_baseline_reset_response,
        build_drift_summary,
        reset_schema_baseline,
    )
    from app.streams.repository import get_stream_by_id

    router = APIRouter()

    @router.get("/streams/{stream_id}/schema-field-drifts", response_model=StreamSchemaFieldDriftsResponse)
    async def get_drifts(
        stream_id: int,
        status: str | None = Query("open"),
        db: Session = Depends(get_db_read_bounded),
    ) -> StreamSchemaFieldDriftsResponse:
        if get_stream_by_id(db, stream_id) is None:
            raise HTTPException(status_code=404, detail="stream not found")
        try:
            normalize_status_filter(status)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        payload = schema_observation_service.get_field_drifts_for_stream(db, stream_id, status_filter=status)
        return StreamSchemaFieldDriftsResponse.model_validate(payload)

    @router.get(
        "/streams/{stream_id}/schema-field-drifts/summary",
        response_model=StreamSchemaFieldDriftsSummaryResponse,
    )
    async def get_summary(
        stream_id: int,
        db: Session = Depends(get_db_read_bounded),
    ) -> StreamSchemaFieldDriftsSummaryResponse:
        if get_stream_by_id(db, stream_id) is None:
            raise HTTPException(status_code=404, detail="stream not found")
        return StreamSchemaFieldDriftsSummaryResponse.model_validate(build_drift_summary(db, stream_id))

    @router.post(
        "/streams/{stream_id}/schema-field-drifts/{finding_id}/acknowledge",
        response_model=SchemaFieldDriftAcknowledgeResponse,
    )
    async def post_ack(
        stream_id: int,
        finding_id: int,
        body: SchemaFieldDriftAcknowledgeRequest,
        request: Request,
        db: Session = Depends(get_db),
    ) -> SchemaFieldDriftAcknowledgeResponse:
        if get_stream_by_id(db, stream_id) is None:
            raise HTTPException(status_code=404, detail="stream not found")
        actor = audit_actor_from_request(request)
        try:
            finding = acknowledge_field_drift(
                db,
                stream_id=stream_id,
                finding_id=finding_id,
                actor_username=actor.actor_username or "system",
                note=body.note,
            )
            db.commit()
        except DriftFindingNotFoundError:
            db.rollback()
            raise HTTPException(status_code=404, detail="finding not found") from None
        except DriftFindingStateError as exc:
            db.rollback()
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return SchemaFieldDriftAcknowledgeResponse(
            id=finding.id,
            stream_id=finding.stream_id,
            field_path=finding.field_path,
            category=finding.category,
            status=finding.status,
            acknowledged_at=finding.acknowledged_at,  # type: ignore[arg-type]
            acknowledged_by=finding.acknowledged_by or "system",
            operator_note=finding.operator_note,
        )

    @router.post(
        "/streams/{stream_id}/schema-baseline/reset",
        response_model=SchemaBaselineResetResponse,
    )
    async def post_reset(
        stream_id: int,
        body: SchemaBaselineResetRequest,
        request: Request,
        db: Session = Depends(get_db),
    ) -> SchemaBaselineResetResponse:
        if get_stream_by_id(db, stream_id) is None:
            raise HTTPException(status_code=404, detail="stream not found")
        actor = audit_actor_from_request(request)
        try:
            row, resolved_count = reset_schema_baseline(
                db,
                stream_id=stream_id,
                actor_username=actor.actor_username or "system",
                reason=body.reason,
            )
            db.commit()
        except ObservedSchemaNotFoundError:
            db.rollback()
            raise HTTPException(status_code=404, detail="observed schema not found") from None
        except DriftFindingStateError as exc:
            db.rollback()
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        payload = build_baseline_reset_response(
            stream_id,
            row,
            resolved_open_finding_count=resolved_count,
        )
        return SchemaBaselineResetResponse.model_validate(payload)

    app = FastAPI()
    app.include_router(router, prefix="/api/v1/runtime")
    return app


@pytest.fixture
def m4_client(db_session: Session) -> TestClient:
    def _read():
        yield db_session

    def _write():
        yield db_session

    app = _m4_test_app()
    app.dependency_overrides[get_db_read_bounded] = _read
    app.dependency_overrides[get_db] = _write
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db_read_bounded, None)
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def fast_drift(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_OBSERVATION_ENABLED", True)
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_DRIFT_DETECTION_ENABLED", True)
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_BASELINE_MIN_RUNS", 1)
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_BASELINE_MIN_EVENTS", 1)
    monkeypatch.setattr("app.config.settings.GDC_SCHEMA_DRIFT_ADDED_CONFIRM_RUNS", 1)


def _seed_stream(db_session: Session) -> int:
    from app.connectors.models import Connector
    from app.sources.models import Source
    from app.streams.models import Stream

    connector = Connector(name="m4-conn", description="", status="STOPPED")
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
        name="m4-stream",
        stream_type="HTTP_API_POLLING",
        config_json={},
        enabled=True,
        status="STOPPED",
    )
    db_session.add(stream)
    db_session.commit()
    return stream.id


def _open_finding_id(db_session: Session, stream_id: int) -> int:
    row = db_session.execute(
        select(StreamSchemaFieldDrift).where(
            StreamSchemaFieldDrift.stream_id == stream_id,
            StreamSchemaFieldDrift.status == DRIFT_STATUS_OPEN,
        )
    ).scalar_one()
    return row.id


def test_acknowledge_api(
    db_session: Session,
    m4_client: TestClient,
    fast_drift: None,
) -> None:
    stream_id = _seed_stream(db_session)
    observe_extracted_events(db_session, stream_id, [{"base": 1}])
    db_session.commit()
    observe_extracted_events(db_session, stream_id, [{"base": 1, "extra": "y"}])
    db_session.commit()

    finding_id = _open_finding_id(db_session, stream_id)
    resp = m4_client.post(
        f"/api/v1/runtime/streams/{stream_id}/schema-field-drifts/{finding_id}/acknowledge",
        json={"note": "reviewed vendor change"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == DRIFT_STATUS_ACKNOWLEDGED
    assert body["operator_note"] == "reviewed vendor change"

    db_session.expire_all()
    row = db_session.get(StreamSchemaFieldDrift, finding_id)
    assert row is not None
    assert row.status == DRIFT_STATUS_ACKNOWLEDGED
    assert row.acknowledged_at is not None
    assert row.acknowledged_by is not None


def test_status_filter_acknowledged_and_all(
    db_session: Session,
    m4_client: TestClient,
    fast_drift: None,
) -> None:
    stream_id = _seed_stream(db_session)
    observe_extracted_events(db_session, stream_id, [{"a": 1}])
    db_session.commit()
    observe_extracted_events(db_session, stream_id, [{"a": 1, "b": 2}])
    db_session.commit()
    finding_id = _open_finding_id(db_session, stream_id)
    m4_client.post(
        f"/api/v1/runtime/streams/{stream_id}/schema-field-drifts/{finding_id}/acknowledge",
        json={},
    )

    open_resp = m4_client.get(f"/api/v1/runtime/streams/{stream_id}/schema-field-drifts")
    assert open_resp.status_code == 200
    assert open_resp.json()["finding_count"] == 0

    ack_resp = m4_client.get(
        f"/api/v1/runtime/streams/{stream_id}/schema-field-drifts?status=acknowledged"
    )
    assert ack_resp.status_code == 200
    assert ack_resp.json()["finding_count"] == 1
    assert ack_resp.json()["status_filter"] == "acknowledged"

    all_resp = m4_client.get(f"/api/v1/runtime/streams/{stream_id}/schema-field-drifts?status=all")
    assert all_resp.status_code == 200
    assert all_resp.json()["finding_count"] >= 1


def test_summary_api(
    db_session: Session,
    m4_client: TestClient,
    fast_drift: None,
) -> None:
    stream_id = _seed_stream(db_session)
    observe_extracted_events(db_session, stream_id, [{"x": 1}])
    db_session.commit()
    observe_extracted_events(db_session, stream_id, [{"x": 1, "y": 2}])
    db_session.commit()

    resp = m4_client.get(f"/api/v1/runtime/streams/{stream_id}/schema-field-drifts/summary")
    assert resp.status_code == 200
    body = resp.json()
    assert body["open_count"] >= 1
    assert body["baseline_version"] == 1
    assert body["baseline_established_at"] is not None
    assert body["by_category"]["field_added"] >= 1


def test_baseline_reset_resolves_open_and_increments_version(
    db_session: Session,
    m4_client: TestClient,
    fast_drift: None,
) -> None:
    stream_id = _seed_stream(db_session)
    observe_extracted_events(db_session, stream_id, [{"k": 1}])
    db_session.commit()
    observe_extracted_events(db_session, stream_id, [{"k": 1, "new_k": 2}])
    db_session.commit()
    finding_id = _open_finding_id(db_session, stream_id)

    resp = m4_client.post(
        f"/api/v1/runtime/streams/{stream_id}/schema-baseline/reset",
        json={"reason": "vendor upgrade"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["baseline_version"] == 2
    assert body["resolved_open_finding_count"] >= 1
    assert body["baseline_reset_reason"] == "vendor upgrade"

    db_session.expire_all()
    obs = db_session.get(StreamObservedSchema, stream_id)
    assert obs is not None
    assert int(obs.baseline_version) == 2
    assert obs.baseline_reset_at is not None

    finding = db_session.get(StreamSchemaFieldDrift, finding_id)
    assert finding is not None
    assert finding.status == DRIFT_STATUS_RESOLVED
    assert finding.resolution == DRIFT_RESOLUTION_BASELINE_RESET

    summary = m4_client.get(f"/api/v1/runtime/streams/{stream_id}/schema-field-drifts/summary")
    assert summary.json()["open_count"] == 0
    assert summary.json()["resolved_count"] >= 1


def test_m4_migration_upgrade_downgrade(
    reset_db_schema: None,
    test_db_url: str,
    db_engine,
) -> None:
    root = Path(__file__).resolve().parents[1]
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "alembic"))
    cfg.set_main_option("sqlalchemy.url", test_db_url)

    command.upgrade(cfg, "20260603_0029_schema_drift_m4")
    inspector = inspect(db_engine)
    drift_cols = {c["name"] for c in inspector.get_columns("stream_schema_field_drifts")}
    assert "acknowledged_at" in drift_cols
    assert "resolved_at" in drift_cols
    assert "operator_note" in drift_cols
    obs_cols = {c["name"] for c in inspector.get_columns("stream_observed_schemas")}
    assert "baseline_version" in obs_cols
    assert "baseline_reset_at" in obs_cols

    command.downgrade(cfg, "20260603_0028_schema_field_drift")
    inspector = inspect(db_engine)
    drift_cols = {c["name"] for c in inspector.get_columns("stream_schema_field_drifts")}
    assert "acknowledged_at" not in drift_cols
    obs_cols = {c["name"] for c in inspector.get_columns("stream_observed_schemas")}
    assert "baseline_version" not in obs_cols

    command.upgrade(cfg, "head")
