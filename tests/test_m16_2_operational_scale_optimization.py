"""M16.2 Operational Scale Optimization — summary cache, bounded queries, platform helper."""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.ai_gateway.service import build_gateway_summary
from app.classification.metrics import (
    CLASSIFICATION_COMPLETE_STAGE,
    build_platform_classification_summary,
    load_classification_runtime_metrics,
)
from app.database import get_db_read_bounded
from app.dynamic_routing.dynamic_routing_metrics import (
    DYNAMIC_ROUTING_COMPLETE_STAGE,
    build_platform_dynamic_routing_summary,
    load_dynamic_routing_runtime_metrics,
)
from app.failover_routing.failover_metrics import (
    FAILOVER_ROUTING_COMPLETE_STAGE,
    build_platform_failover_routing_summary,
    load_failover_routing_runtime_metrics,
)
from app.governance.cache import clear_governance_summary_cache, get_governance_summary_cached
from app.governance.service import build_governance_summary
from app.logs.models import DeliveryLog
from app.platform_summary.stage_metrics import load_latest_stage_metrics
from app.protection.policy_metrics import (
    POLICY_EVALUATION_COMPLETE_STAGE,
    load_policy_runtime_metrics,
)
from tests.test_stream_runner_e2e import _seed_stream_runtime


@pytest.fixture(autouse=True)
def _clear_governance_cache() -> None:
    clear_governance_summary_cache()
    yield
    clear_governance_summary_cache()


def _governance_app() -> FastAPI:
    from app.governance.router import router

    app = FastAPI()
    app.include_router(router, prefix="/api/v1/governance")
    return app


@pytest.fixture
def governance_client(db_session: Session) -> TestClient:
    app = _governance_app()

    def _override_db():
        yield db_session

    app.dependency_overrides[get_db_read_bounded] = _override_db
    return TestClient(app)


def _insert_stage_row(
    db: Session,
    *,
    stream_id: int,
    stage: str,
    payload: dict,
    created_at: datetime | None = None,
) -> DeliveryLog:
    row = DeliveryLog(
        stream_id=stream_id,
        stage=stage,
        level="INFO",
        status="OK",
        message=f"{stage} test row",
        payload_sample=payload,
        created_at=created_at or datetime.now(timezone.utc),
    )
    db.add(row)
    db.flush()
    return row


def test_load_latest_stage_metrics_returns_one_row_per_stream(db_session: Session) -> None:
    db = db_session
    first = _seed_stream_runtime(db)
    second = _seed_stream_runtime(db)
    sid_a = int(first["stream_id"])
    sid_b = int(second["stream_id"])

    _insert_stage_row(
        db,
        stream_id=sid_a,
        stage=CLASSIFICATION_COMPLETE_STAGE,
        payload={"total_restricted_count": 1, "classification_level": "RESTRICTED"},
    )
    _insert_stage_row(
        db,
        stream_id=sid_a,
        stage=CLASSIFICATION_COMPLETE_STAGE,
        payload={"total_restricted_count": 3, "classification_level": "RESTRICTED"},
    )
    _insert_stage_row(
        db,
        stream_id=sid_b,
        stage=CLASSIFICATION_COMPLETE_STAGE,
        payload={"total_confidential_count": 2, "classification_level": "CONFIDENTIAL"},
    )
    db.commit()

    rows = load_latest_stage_metrics(db, stage=CLASSIFICATION_COMPLETE_STAGE)
    by_stream = {int(r.stream_id): r for r in rows}
    assert len(by_stream) == 2
    assert by_stream[sid_a].payload_sample["total_restricted_count"] == 3
    assert by_stream[sid_b].payload_sample["total_confidential_count"] == 2


def test_classification_summary_latest_row_first(db_session: Session) -> None:
    db = db_session
    seeded = _seed_stream_runtime(db)
    stream_id = int(seeded["stream_id"])
    _insert_stage_row(
        db,
        stream_id=stream_id,
        stage=CLASSIFICATION_COMPLETE_STAGE,
        payload={
            "total_public_count": 10,
            "total_internal_count": 5,
            "total_confidential_count": 2,
            "total_restricted_count": 7,
            "classification_level": "RESTRICTED",
        },
    )
    db.commit()

    metrics = load_classification_runtime_metrics(db, stream_id)
    assert metrics["restricted_count"] == 7
    assert metrics["confidential_count"] == 2
    assert metrics["last_classification_level"] == "RESTRICTED"


def test_classification_summary_bounded_fallback(db_session: Session) -> None:
    db = db_session
    seeded = _seed_stream_runtime(db)
    stream_id = int(seeded["stream_id"])
    for level in ("PUBLIC", "RESTRICTED", "RESTRICTED"):
        _insert_stage_row(
            db,
            stream_id=stream_id,
            stage=CLASSIFICATION_COMPLETE_STAGE,
            payload={"classification_level": level},
        )
    db.commit()

    metrics = load_classification_runtime_metrics(db, stream_id, recent_log_limit=3)
    assert metrics["public_count"] == 1
    assert metrics["restricted_count"] == 2


def test_policy_summary_latest_row_first(db_session: Session) -> None:
    db = db_session
    seeded = _seed_stream_runtime(db)
    stream_id = int(seeded["stream_id"])
    _insert_stage_row(
        db,
        stream_id=stream_id,
        stage=POLICY_EVALUATION_COMPLETE_STAGE,
        payload={"total_audit_events": 4, "total_matched_policies": 9},
    )
    db.commit()

    metrics = load_policy_runtime_metrics(db, stream_id, total_policies=2)
    assert metrics["audit_events"] == 4
    assert metrics["matched_policies"] == 9


def test_policy_summary_bounded_fallback(db_session: Session) -> None:
    db = db_session
    seeded = _seed_stream_runtime(db)
    stream_id = int(seeded["stream_id"])
    for matched in (1, 0, 2):
        _insert_stage_row(
            db,
            stream_id=stream_id,
            stage=POLICY_EVALUATION_COMPLETE_STAGE,
            payload={"matched_policy_count": matched},
        )
    db.commit()

    metrics = load_policy_runtime_metrics(db, stream_id, total_policies=1, recent_log_limit=3)
    assert metrics["matched_policies"] == 3
    assert metrics["audit_events"] == 2


def test_dynamic_summary_latest_row_first(db_session: Session) -> None:
    db = db_session
    seeded = _seed_stream_runtime(db)
    stream_id = int(seeded["stream_id"])
    _insert_stage_row(
        db,
        stream_id=stream_id,
        stage=DYNAMIC_ROUTING_COMPLETE_STAGE,
        payload={"total_dynamic_deliveries": 11, "total_matched_dynamic_routes": 4},
    )
    db.commit()

    metrics = load_dynamic_routing_runtime_metrics(db, stream_id, total_dynamic_routes=1)
    assert metrics["dynamic_deliveries"] == 11
    assert metrics["matched_dynamic_routes"] == 4


def test_dynamic_summary_bounded_fallback(db_session: Session) -> None:
    db = db_session
    seeded = _seed_stream_runtime(db)
    stream_id = int(seeded["stream_id"])
    for matched in (1, 2):
        _insert_stage_row(
            db,
            stream_id=stream_id,
            stage=DYNAMIC_ROUTING_COMPLETE_STAGE,
            payload={"matched_dynamic_route_count": matched},
        )
    db.commit()

    metrics = load_dynamic_routing_runtime_metrics(
        db, stream_id, total_dynamic_routes=1, recent_log_limit=2
    )
    assert metrics["matched_dynamic_routes"] == 3
    assert metrics["dynamic_deliveries"] == 3


def test_failover_summary_latest_row_first(db_session: Session) -> None:
    db = db_session
    seeded = _seed_stream_runtime(db)
    stream_id = int(seeded["stream_id"])
    _insert_stage_row(
        db,
        stream_id=stream_id,
        stage=FAILOVER_ROUTING_COMPLETE_STAGE,
        payload={
            "total_failover_attempts": 8,
            "total_failover_successes": 5,
            "total_failover_failures": 3,
        },
    )
    db.commit()

    metrics = load_failover_routing_runtime_metrics(db, stream_id, total_failover_routes=1)
    assert metrics["failover_attempts"] == 8
    assert metrics["failover_successes"] == 5
    assert metrics["failover_failures"] == 3


def test_failover_summary_bounded_fallback(db_session: Session) -> None:
    db = db_session
    seeded = _seed_stream_runtime(db)
    stream_id = int(seeded["stream_id"])
    _insert_stage_row(
        db,
        stream_id=stream_id,
        stage=FAILOVER_ROUTING_COMPLETE_STAGE,
        payload={"attempt_count": 2, "success_count": 1, "failure_count": 1},
    )
    _insert_stage_row(
        db,
        stream_id=stream_id,
        stage=FAILOVER_ROUTING_COMPLETE_STAGE,
        payload={"attempt_count": 1, "success_count": 1, "failure_count": 0},
    )
    db.commit()

    metrics = load_failover_routing_runtime_metrics(
        db, stream_id, total_failover_routes=1, recent_log_limit=2
    )
    assert metrics["failover_attempts"] == 3
    assert metrics["failover_successes"] == 2
    assert metrics["failover_failures"] == 1


def test_ai_gateway_summary_bounded_24h(db_session: Session) -> None:
    from app.ai_gateway.models import AiGatewayRequest

    db = db_session
    seeded = _seed_stream_runtime(db)
    stream_id = int(seeded["stream_id"])
    now = datetime.now(timezone.utc)
    db.add(
        AiGatewayRequest(
            request_id="recent-allow",
            stream_id=stream_id,
            classification_level="INTERNAL",
            decision="allow",
            provider="mock",
            processing_time_ms=100,
            matched_policy_count=0,
            created_at=now - timedelta(hours=1),
        )
    )
    db.add(
        AiGatewayRequest(
            request_id="old-block",
            stream_id=stream_id,
            classification_level="RESTRICTED",
            decision="block",
            provider="mock",
            processing_time_ms=50,
            matched_policy_count=1,
            created_at=now - timedelta(hours=48),
        )
    )
    db.commit()

    summary = build_gateway_summary(db)
    assert summary.allow_count == 1
    assert summary.block_count == 0
    assert summary.avg_processing_time_ms == pytest.approx(100.0)


def test_governance_cache_hit_skips_recompute(db_session: Session) -> None:
    db = db_session
    with patch("app.governance.cache.build_governance_summary") as mock_build:
        mock_build.return_value = build_governance_summary(db)
        first = get_governance_summary_cached(db)
        second = get_governance_summary_cached(db)
        assert mock_build.call_count == 1
        assert first.classification_rules == second.classification_rules


def test_governance_cache_expire_recomputes(db_session: Session) -> None:
    db = db_session
    with patch("app.governance.cache._TTL_SEC", 0.05):
        with patch("app.governance.cache.build_governance_summary") as mock_build:
            mock_build.side_effect = lambda _db: build_governance_summary(_db)
            get_governance_summary_cached(db)
            time.sleep(0.06)
            get_governance_summary_cached(db)
            assert mock_build.call_count == 2


def test_governance_endpoint_uses_cache(governance_client: TestClient, db_session: Session) -> None:
    db_session.commit()
    with patch("app.governance.cache.build_governance_summary") as mock_build:
        mock_build.side_effect = lambda db: build_governance_summary(db)
        first = governance_client.get("/api/v1/governance/summary")
        second = governance_client.get("/api/v1/governance/summary")
        assert first.status_code == 200
        assert second.status_code == 200
        assert mock_build.call_count == 1


def test_platform_summaries_use_shared_helper(db_session: Session) -> None:
    db = db_session
    seeded = _seed_stream_runtime(db)
    stream_id = int(seeded["stream_id"])
    _insert_stage_row(
        db,
        stream_id=stream_id,
        stage=CLASSIFICATION_COMPLETE_STAGE,
        payload={"total_restricted_count": 2, "classification_level": "RESTRICTED"},
    )
    _insert_stage_row(
        db,
        stream_id=stream_id,
        stage=DYNAMIC_ROUTING_COMPLETE_STAGE,
        payload={"total_dynamic_deliveries": 5, "total_matched_dynamic_routes": 2},
    )
    _insert_stage_row(
        db,
        stream_id=stream_id,
        stage=FAILOVER_ROUTING_COMPLETE_STAGE,
        payload={
            "total_failover_attempts": 4,
            "total_failover_successes": 3,
            "total_failover_failures": 1,
        },
    )
    db.commit()

    classification = build_platform_classification_summary(db)
    dynamic = build_platform_dynamic_routing_summary(db)
    failover = build_platform_failover_routing_summary(db)
    assert classification["restricted_count"] == 2
    assert dynamic["dynamic_deliveries"] == 5
    assert failover["failover_attempts"] == 4


def test_synthetic_many_streams_query_count(db_session: Session) -> None:
    db = db_session
    stream_ids: list[int] = []
    for i in range(20):
        seeded = _seed_stream_runtime(db)
        stream_id = int(seeded["stream_id"])
        stream_ids.append(stream_id)
        _insert_stage_row(
            db,
            stream_id=stream_id,
            stage=CLASSIFICATION_COMPLETE_STAGE,
            payload={
                "total_public_count": i,
                "total_restricted_count": 1,
                "classification_level": "RESTRICTED",
            },
        )
    db.commit()

    query_count = {"n": 0}

    def _count_queries(_conn, _cursor, statement, *_args, **_kwargs) -> None:
        sql = str(statement).lower()
        if "delivery_logs" in sql:
            query_count["n"] += 1

    event.listen(db_session.bind, "before_cursor_execute", _count_queries)
    try:
        summary = build_platform_classification_summary(db_session)
    finally:
        event.remove(db_session.bind, "before_cursor_execute", _count_queries)

    assert summary["restricted_count"] == len(stream_ids)
    assert query_count["n"] <= 2


def test_governance_regression_smoke(governance_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    _insert_stage_row(
        db_session,
        stream_id=stream_id,
        stage=CLASSIFICATION_COMPLETE_STAGE,
        payload={"total_restricted_count": 1, "classification_level": "RESTRICTED"},
    )
    db_session.commit()

    resp = governance_client.get("/api/v1/governance/summary")
    assert resp.status_code == 200
    body = resp.json()
    assert "cards" in body
    assert "health" in body
    assert body["risk_overview"]["restricted_events"] >= 1
