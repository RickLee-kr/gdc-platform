"""Governance Workspace snapshot — bulk effective read without N+1 amplification."""

from __future__ import annotations

import time
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.classification.models import StreamClassificationRule
from app.connectors.models import Connector
from app.database import get_db, get_db_read_bounded
from app.destinations.models import Destination
from app.main import app
from app.protection.models import (
    PROTECTION_MODE_FULL_MASK,
    PROTECTION_MODE_PARTIAL_MASK,
    StreamPolicyRule,
    StreamProtectionRule,
)
from app.route_protection.models import RouteProtectionRule
from app.routes.models import Route
from app.runtime.governance_workspace_snapshot_service import build_governance_workspace_snapshot
from app.runtime.route_classification_service import get_route_classification_effective
from app.runtime.route_policy_service import get_route_policy_effective
from app.runtime.route_protection_service import get_route_protection_effective
from app.runtime.route_transform_service import get_route_transform_effective
from app.sensitive_detection.models import SENSITIVITY_CLASS_PII, SENSITIVITY_CLASS_SECRET
from app.sources.models import Source
from app.streams.models import Stream


@pytest.fixture
def gw_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_db_read_bounded] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_db_read_bounded, None)


def _seed_stream_with_routes(db: Session, route_count: int, *, name_prefix: str = "gw") -> dict[str, Any]:
    connector = Connector(name=f"{name_prefix}-connector-{route_count}", description=None, status="RUNNING")
    db.add(connector)
    db.flush()
    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={},
        auth_json={},
        enabled=True,
    )
    db.add(source)
    db.flush()
    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name=f"{name_prefix}-stream-{route_count}",
        stream_type="HTTP_API_POLLING",
        config_json={},
        polling_interval=60,
        enabled=True,
        status="RUNNING",
        rate_limit_json={},
    )
    db.add(stream)
    db.flush()

    db.add(
        StreamProtectionRule(
            stream_id=stream.id,
            field_path="$.email",
            sensitivity_class=SENSITIVITY_CLASS_PII,
            protection_mode=PROTECTION_MODE_PARTIAL_MASK,
            enabled=True,
            created_by="test",
        )
    )
    db.add(
        StreamClassificationRule(
            stream_id=stream.id,
            name="stream-class",
            enabled=True,
            condition_json={"sensitivity_class": "pii"},
            classification_level="INTERNAL",
        )
    )
    db.add(
        StreamPolicyRule(
            stream_id=stream.id,
            name="stream-policy",
            enabled=True,
            condition_json={"sensitivity_class": "pii"},
            action_type="audit_only",
        )
    )

    route_ids: list[int] = []
    for i in range(route_count):
        dest = Destination(
            name=f"{name_prefix}-d-{route_count}-{i}",
            destination_type="WEBHOOK_POST",
            config_json={"url": f"https://example.test/{i}"},
            rate_limit_json={},
            enabled=True,
        )
        db.add(dest)
        db.flush()
        route = Route(
            stream_id=stream.id,
            destination_id=dest.id,
            enabled=True,
            failure_policy="LOG_AND_CONTINUE",
            formatter_config_json={},
            rate_limit_json={},
            status="ENABLED",
        )
        db.add(route)
        db.flush()
        route_ids.append(int(route.id))

    # Override first route protection to create Mixed/Overridden diversity.
    if route_ids:
        db.add(
            RouteProtectionRule(
                route_id=route_ids[0],
                field_path="$.secret",
                sensitivity_class=SENSITIVITY_CLASS_SECRET,
                protection_mode=PROTECTION_MODE_FULL_MASK,
                enabled=True,
                created_by="test",
            )
        )

    db.add(Checkpoint(stream_id=stream.id, checkpoint_type="offset", checkpoint_value_json={}))
    db.commit()
    return {"stream_id": int(stream.id), "route_ids": route_ids}


def _count_selects(db: Session, fn: Any) -> int:
    query_count = 0

    def _before(_conn: Any, _cursor: Any, statement: Any, _parameters: Any, _context: Any, _executemany: Any) -> None:
        nonlocal query_count
        sql = str(statement).strip().upper()
        if sql.startswith("SELECT") or sql.startswith("WITH"):
            query_count += 1

    event.listen(db.bind, "before_cursor_execute", _before)  # type: ignore[arg-type]
    try:
        fn()
    finally:
        event.remove(db.bind, "before_cursor_execute", _before)  # type: ignore[arg-type]
    return query_count


def _measure_fanout_queries(db: Session, route_ids: list[int]) -> int:
    def _run() -> None:
        for rid in route_ids:
            get_route_transform_effective(db, rid)
            get_route_protection_effective(db, rid)
            get_route_classification_effective(db, rid)
            get_route_policy_effective(db, rid)

    return _count_selects(db, _run)


def test_governance_workspace_snapshot_empty_stream(gw_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_with_routes(db_session, 0, name_prefix="gw-empty")
    resp = gw_client.get(f"/api/v1/runtime/streams/{seeded['stream_id']}/governance/workspace-snapshot")
    assert resp.status_code == 200
    body = resp.json()
    assert body["stream_id"] == seeded["stream_id"]
    assert body["route_count"] == 0
    assert body["routes"] == []


def test_governance_workspace_snapshot_not_found(gw_client: TestClient) -> None:
    resp = gw_client.get("/api/v1/runtime/streams/999999/governance/workspace-snapshot")
    assert resp.status_code == 404
    assert resp.json()["detail"]["error_code"] == "STREAM_NOT_FOUND"


def test_governance_workspace_snapshot_matches_per_route_effective(
    gw_client: TestClient,
    db_session: Session,
) -> None:
    seeded = _seed_stream_with_routes(db_session, 3, name_prefix="gw-parity")
    stream_id = seeded["stream_id"]
    route_ids = seeded["route_ids"]

    snap = gw_client.get(f"/api/v1/runtime/streams/{stream_id}/governance/workspace-snapshot").json()
    assert snap["route_count"] == 3
    assert {row["route_id"] for row in snap["routes"]} == set(route_ids)

    for row in snap["routes"]:
        rid = row["route_id"]
        for dim, path in (
            ("transform", f"/api/v1/runtime/routes/{rid}/transform/effective"),
            ("protection", f"/api/v1/runtime/routes/{rid}/protection/effective"),
            ("classification", f"/api/v1/runtime/routes/{rid}/classification/effective"),
            ("policy", f"/api/v1/runtime/routes/{rid}/policy/effective"),
        ):
            single = gw_client.get(path).json()
            assert row[dim] == single, f"mismatch {dim} route={rid}"


def test_governance_workspace_snapshot_query_scaling_bounded(db_session: Session) -> None:
    seeded_10 = _seed_stream_with_routes(db_session, 10, name_prefix="gw-scale-10")
    seeded_100 = _seed_stream_with_routes(db_session, 100, name_prefix="gw-scale-100")

    before_10 = _measure_fanout_queries(db_session, seeded_10["route_ids"])
    before_100 = _measure_fanout_queries(db_session, seeded_100["route_ids"])

    after_10 = _count_selects(
        db_session,
        lambda: build_governance_workspace_snapshot(db_session, seeded_10["stream_id"]),
    )
    after_100 = _count_selects(
        db_session,
        lambda: build_governance_workspace_snapshot(db_session, seeded_100["stream_id"]),
    )

    # Evidence numbers for PR / completion report.
    print(
        f"MEASUREMENT routes=10 BEFORE_QUERIES={before_10} AFTER_QUERIES={after_10} "
        f"HTTP_BEFORE={2 + 4 * 10} HTTP_AFTER=3"
    )
    print(
        f"MEASUREMENT routes=100 BEFORE_QUERIES={before_100} AFTER_QUERIES={after_100} "
        f"HTTP_BEFORE={2 + 4 * 100} HTTP_AFTER=3"
    )

    assert before_10 > 40, f"expected amplified before path for 10 routes, got {before_10}"
    assert before_100 > before_10 * 5, "fan-out query count must scale with routes"
    assert after_10 <= 20, f"snapshot queries must be bounded for 10 routes, got {after_10}"
    assert after_100 <= 20, f"snapshot queries must be bounded for 100 routes, got {after_100}"
    assert after_100 <= after_10 + 5, "query growth from 10→100 routes must stay near-constant"
    assert after_100 < before_100
    assert after_10 < before_10


def test_governance_workspace_snapshot_http_and_timing(gw_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_with_routes(db_session, 100, name_prefix="gw-timing")
    stream_id = seeded["stream_id"]
    route_ids = seeded["route_ids"]

    t0 = time.perf_counter()
    for rid in route_ids:
        assert gw_client.get(f"/api/v1/runtime/routes/{rid}/transform/effective").status_code == 200
        assert gw_client.get(f"/api/v1/runtime/routes/{rid}/protection/effective").status_code == 200
        assert gw_client.get(f"/api/v1/runtime/routes/{rid}/classification/effective").status_code == 200
        assert gw_client.get(f"/api/v1/runtime/routes/{rid}/policy/effective").status_code == 200
    before_ms = (time.perf_counter() - t0) * 1000.0
    before_bytes = 0  # approximate via one sample later

    t1 = time.perf_counter()
    snap_resp = gw_client.get(f"/api/v1/runtime/streams/{stream_id}/governance/workspace-snapshot")
    after_ms = (time.perf_counter() - t1) * 1000.0
    assert snap_resp.status_code == 200
    after_bytes = len(snap_resp.content)

    # Sample transfer for fan-out (one route ×4 ×100).
    sample = 0
    for path in (
        f"/api/v1/runtime/routes/{route_ids[0]}/transform/effective",
        f"/api/v1/runtime/routes/{route_ids[0]}/protection/effective",
        f"/api/v1/runtime/routes/{route_ids[0]}/classification/effective",
        f"/api/v1/runtime/routes/{route_ids[0]}/policy/effective",
    ):
        sample += len(gw_client.get(path).content)
    before_bytes = sample * len(route_ids)

    print(
        f"TIMING routes=100 PAGE_LOAD_MS_BEFORE={before_ms:.1f} PAGE_LOAD_MS_AFTER={after_ms:.1f} "
        f"TRANSFER_BYTES_BEFORE≈{before_bytes} TRANSFER_BYTES_AFTER={after_bytes} "
        f"HTTP_BEFORE={2 + 4 * 100} HTTP_AFTER=3"
    )
    assert after_ms < before_ms
    assert snap_resp.json()["route_count"] == 100
