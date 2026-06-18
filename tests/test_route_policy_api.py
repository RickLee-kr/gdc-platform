"""Route policy operator API (M13.5 P2)."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db, get_db_read_bounded
from app.main import app
from app.protection.models import StreamPolicyRule
from app.route_policy.models import RoutePolicyRule
from tests.test_runtime_logs_page_endpoint import _seed_stream_two_routes


@pytest.fixture
def route_policy_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_db_read_bounded] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_db_read_bounded, None)


def _seed_stream_policy(db: Session, stream_id: int) -> None:
    db.add(
        StreamPolicyRule(
            stream_id=stream_id,
            name="pii-audit",
            enabled=True,
            condition_json={"sensitivity_class": "pii"},
            action_type="audit_only",
        )
    )
    db.commit()


def test_route_policy_rules_list_empty_when_no_route_rules(
    route_policy_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    _seed_stream_policy(db_session, h["stream_id"])
    route_id = h["route_a_id"]

    r = route_policy_client.get(f"/api/v1/runtime/routes/{route_id}/policy-rules")
    assert r.status_code == 200
    body = r.json()
    assert body["route_id"] == route_id
    assert body["stream_id"] == h["stream_id"]
    assert body["rule_count"] == 0
    assert body["rules"] == []


def test_route_policy_rules_create_patch_delete(
    route_policy_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    route_id = h["route_a_id"]

    created = route_policy_client.post(
        f"/api/v1/runtime/routes/{route_id}/policy-rules",
        json={
            "name": "secret-quarantine",
            "enabled": True,
            "condition_json": {"sensitivity_class": "secret"},
            "action_type": "quarantine",
        },
    )
    assert created.status_code == 200
    rule_id = created.json()["rule"]["id"]

    listed = route_policy_client.get(f"/api/v1/runtime/routes/{route_id}/policy-rules")
    assert listed.json()["rule_count"] == 1
    assert listed.json()["rules"][0]["name"] == "secret-quarantine"

    patched = route_policy_client.patch(
        f"/api/v1/runtime/routes/{route_id}/policy-rules/{rule_id}",
        json={"action_type": "audit_only"},
    )
    assert patched.status_code == 200
    assert patched.json()["rule"]["action_type"] == "audit_only"

    deleted = route_policy_client.delete(f"/api/v1/runtime/routes/{route_id}/policy-rules/{rule_id}")
    assert deleted.status_code == 204
    assert db_session.query(RoutePolicyRule).filter(RoutePolicyRule.route_id == route_id).count() == 0


def test_route_policy_rules_invalid(route_policy_client: TestClient, db_session: Session) -> None:
    h = _seed_stream_two_routes(db_session)
    route_id = h["route_a_id"]
    r = route_policy_client.post(
        f"/api/v1/runtime/routes/{route_id}/policy-rules",
        json={
            "name": "bad",
            "enabled": True,
            "condition_json": {"sensitivity_class": "invalid"},
            "action_type": "audit_only",
        },
    )
    assert r.status_code == 422


def test_route_policy_rules_not_found(route_policy_client: TestClient) -> None:
    r = route_policy_client.get("/api/v1/runtime/routes/999999999/policy-rules")
    assert r.status_code == 404
