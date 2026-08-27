"""P0 Replay Center expansion — route/destination context, eligibility, filters, checkpoint safety."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.jwt_service import issue_access_token
from app.checkpoints.models import Checkpoint
from app.database import get_db, get_db_read_bounded
from app.destinations.models import Destination
from app.replay.models import (
    REPLAY_STATUS_DISCARDED,
    REPLAY_STATUS_FAILED,
    REPLAY_STATUS_PENDING,
    REPLAY_STATUS_REPLAYED,
)
from app.replay.service import checkpoint_unchanged, execute_replay_event
from tests.test_governance_replay_m20_1 import (
    _create_policy,
    _create_quarantine,
    _create_replay_event,
    _governance_app,
)
from tests.test_stream_runner_e2e import _seed_stream_runtime


@pytest.fixture
def governance_read_client(db_session: Session) -> TestClient:
    app = _governance_app()

    def _override_db():
        yield db_session

    app.dependency_overrides[get_db_read_bounded] = _override_db
    return TestClient(app)


@pytest.fixture
def governance_write_client(db_session: Session) -> TestClient:
    app = _governance_app()

    def _override_db():
        yield db_session

    app.dependency_overrides[get_db_read_bounded] = _override_db
    app.dependency_overrides[get_db] = _override_db
    return TestClient(app)


@pytest.fixture
def governance_rbac_client(db_session: Session) -> TestClient:
    app = _governance_app(with_rbac=True)

    def _override_db():
        yield db_session

    app.dependency_overrides[get_db_read_bounded] = _override_db
    app.dependency_overrides[get_db] = _override_db
    return TestClient(app)


def _bearer(role: str) -> dict[str, str]:
    token, _ = issue_access_token(username="replay-expansion", user_id=99, role=role, token_version=1)
    return {"Authorization": f"Bearer {token}"}


def test_replay_center_list_includes_route_destination_context(
    governance_read_client: TestClient,
    db_session: Session,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    destination_id = int(seeded["destination_ids"][0])
    route_id = int(seeded["route_ids"][0])
    _create_policy(db_session, name="Policy", stream_id=stream_id)
    replay_row = _create_replay_event(
        db_session,
        stream_id=stream_id,
        destination_id=destination_id,
        route_id=route_id,
        status=REPLAY_STATUS_FAILED,
    )

    resp = governance_read_client.get("/api/v1/governance/replay?window=24h")
    assert resp.status_code == 200
    row = resp.json()["replay_events"][0]
    assert row["id"] == replay_row.id
    assert row["route_id"] == route_id
    assert row["destination_id"] == destination_id
    assert row["destination_name"]
    assert row["route_label"]
    assert "Route #" in row["route_label"]
    assert row["failure_reason"] == "destination unreachable"
    assert row["can_replay"] is True
    assert row["blocking_reason"] is None


def test_replay_center_blocked_already_replayed(
    governance_read_client: TestClient,
    db_session: Session,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    destination_id = int(seeded["destination_ids"][0])
    _create_policy(db_session, name="Policy", stream_id=stream_id)
    replay_row = _create_replay_event(
        db_session,
        stream_id=stream_id,
        destination_id=destination_id,
        status=REPLAY_STATUS_REPLAYED,
    )

    resp = governance_read_client.get(f"/api/v1/governance/replay/{replay_row.id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["can_execute"] is False
    assert body["blocking_reason"]
    assert "Already replayed" in body["blocking_reason"]
    assert body["checkpoint_safe"] is True
    assert body["route_context"]["destination_id"] == destination_id


def test_replay_center_blocked_discarded(
    governance_read_client: TestClient,
    db_session: Session,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    destination_id = int(seeded["destination_ids"][0])
    _create_policy(db_session, name="Policy", stream_id=stream_id)
    replay_row = _create_replay_event(
        db_session,
        stream_id=stream_id,
        destination_id=destination_id,
        status=REPLAY_STATUS_DISCARDED,
    )

    detail = governance_read_client.get(f"/api/v1/governance/replay/{replay_row.id}").json()
    assert detail["can_execute"] is False
    assert "discarded" in detail["blocking_reason"].lower()


def test_replay_center_blocked_disabled_destination(
    governance_read_client: TestClient,
    db_session: Session,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    destination_id = int(seeded["destination_ids"][0])
    _create_policy(db_session, name="Policy", stream_id=stream_id)
    replay_row = _create_replay_event(
        db_session,
        stream_id=stream_id,
        destination_id=destination_id,
        status=REPLAY_STATUS_PENDING,
    )
    dest = db_session.get(Destination, destination_id)
    assert dest is not None
    dest.enabled = False
    db_session.commit()

    detail = governance_read_client.get(f"/api/v1/governance/replay/{replay_row.id}").json()
    assert detail["can_execute"] is False
    assert "disabled" in detail["blocking_reason"].lower()


def test_replay_center_filter_by_destination(
    governance_read_client: TestClient,
    db_session: Session,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    destination_id = int(seeded["destination_ids"][0])
    _create_policy(db_session, name="Policy", stream_id=stream_id)
    _create_replay_event(db_session, stream_id=stream_id, destination_id=destination_id)

    resp = governance_read_client.get(f"/api/v1/governance/replay?destination_id={destination_id}")
    assert resp.status_code == 200
    assert resp.json()["total"] == 1

    resp_other = governance_read_client.get("/api/v1/governance/replay?destination_id=99999")
    assert resp_other.status_code == 200
    assert resp_other.json()["total"] == 0


def test_replay_center_filter_by_failure_reason(
    governance_read_client: TestClient,
    db_session: Session,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    destination_id = int(seeded["destination_ids"][0])
    _create_policy(db_session, name="Policy", stream_id=stream_id)
    _create_replay_event(
        db_session,
        stream_id=stream_id,
        destination_id=destination_id,
        status=REPLAY_STATUS_FAILED,
    )

    resp = governance_read_client.get("/api/v1/governance/replay?failure_reason=unreachable")
    assert resp.status_code == 200
    assert resp.json()["total"] == 1
    assert "unreachable" in resp.json()["replay_events"][0]["failure_reason"].lower()


def test_replay_center_quarantine_failure_reason(
    governance_read_client: TestClient,
    db_session: Session,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    destination_id = int(seeded["destination_ids"][0])
    _create_policy(db_session, name="Customer PII Policy", stream_id=stream_id)
    _create_quarantine(db_session, stream_id=stream_id)
    replay_row = _create_replay_event(
        db_session,
        stream_id=stream_id,
        destination_id=destination_id,
        status=REPLAY_STATUS_PENDING,
    )

    detail = governance_read_client.get(f"/api/v1/governance/replay/{replay_row.id}").json()
    assert detail["source"]["origin"] == "Quarantine recovery"
    assert detail["entry"]["failure_reason"]


def test_replay_center_execute_preserves_checkpoint(
    governance_write_client: TestClient,
    db_session: Session,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    destination_id = int(seeded["destination_ids"][0])
    route_id = int(seeded["route_ids"][0])
    _create_policy(db_session, name="Policy", stream_id=stream_id)
    replay_row = _create_replay_event(
        db_session,
        stream_id=stream_id,
        destination_id=destination_id,
        route_id=route_id,
        status=REPLAY_STATUS_PENDING,
    )
    cp = db_session.query(Checkpoint).filter(Checkpoint.stream_id == stream_id).first()
    before = dict(cp.checkpoint_value_json or {}) if cp is not None else {}

    resp = governance_write_client.post(f"/api/v1/governance/replay/{replay_row.id}/execute")
    assert resp.status_code == 200
    assert checkpoint_unchanged(db_session, stream_id, before)


def test_replay_center_execute_uses_existing_replay_runtime(db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    destination_id = int(seeded["destination_ids"][0])
    route_id = int(seeded["route_ids"][0])
    replay_row = _create_replay_event(
        db_session,
        stream_id=stream_id,
        destination_id=destination_id,
        route_id=route_id,
        status=REPLAY_STATUS_PENDING,
    )

    result = execute_replay_event(db_session, int(replay_row.id))
    assert result["outcome"] in {"replayed", "failed"}
    db_session.refresh(replay_row)
    assert replay_row.status in {REPLAY_STATUS_REPLAYED, REPLAY_STATUS_FAILED, REPLAY_STATUS_PENDING}


def test_replay_center_concurrent_replay_protection(db_session: Session) -> None:
    from app.governance_replay.service import _assess_replay_eligibility

    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    destination_id = int(seeded["destination_ids"][0])
    route_id = int(seeded["route_ids"][0])
    replay_row = _create_replay_event(
        db_session,
        stream_id=stream_id,
        destination_id=destination_id,
        route_id=route_id,
        status=REPLAY_STATUS_PENDING,
    )
    replay_row.status = "in_progress"
    replay_row.updated_at = datetime.now(timezone.utc)
    db_session.commit()

    can_replay, blocking = _assess_replay_eligibility(db_session, replay_row)
    assert can_replay is False
    assert blocking and "in progress" in blocking.lower()


def test_replay_center_rbac_reviewer_cannot_execute(
    governance_rbac_client: TestClient,
    db_session: Session,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    destination_id = int(seeded["destination_ids"][0])
    _create_policy(db_session, name="Policy", stream_id=stream_id)
    replay_row = _create_replay_event(
        db_session,
        stream_id=stream_id,
        destination_id=destination_id,
        status=REPLAY_STATUS_PENDING,
    )

    read_resp = governance_rbac_client.get(
        "/api/v1/governance/replay",
        headers=_bearer("GOVERNANCE_REVIEWER"),
    )
    assert read_resp.status_code == 200
    assert read_resp.json()["replay_events"][0]["can_replay"] is True

    exec_resp = governance_rbac_client.post(
        f"/api/v1/governance/replay/{replay_row.id}/execute",
        headers=_bearer("GOVERNANCE_REVIEWER"),
    )
    assert exec_resp.status_code == 403
