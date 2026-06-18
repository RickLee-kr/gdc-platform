"""Route protection effective config API."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db, get_db_read_bounded
from app.main import app
from app.protection.models import PROTECTION_MODE_FULL_MASK, PROTECTION_MODE_PARTIAL_MASK, StreamProtectionRule
from app.route_protection.models import RouteProtectionRule
from app.sensitive_detection.models import SENSITIVITY_CLASS_PII, SENSITIVITY_CLASS_SECRET
from tests.test_runtime_logs_page_endpoint import _seed_stream_two_routes


@pytest.fixture
def route_protection_effective_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_db_read_bounded] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_db_read_bounded, None)


def test_route_protection_effective_inherited(
    route_protection_effective_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    db_session.add(
        StreamProtectionRule(
            stream_id=h["stream_id"],
            field_path="$.email",
            sensitivity_class=SENSITIVITY_CLASS_PII,
            protection_mode=PROTECTION_MODE_PARTIAL_MASK,
            enabled=True,
            created_by="test",
        )
    )
    db_session.commit()

    r = route_protection_effective_client.get(f"/api/v1/runtime/routes/{h['route_a_id']}/protection/effective")
    assert r.status_code == 200
    body = r.json()
    assert body["persisted_source"] == "stream"
    assert body["fallback_used"] is True
    assert body["rule_count"] == 1
    assert body["processing_status"] == "Inherited"


def test_route_protection_effective_overridden(
    route_protection_effective_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    db_session.add(
        StreamProtectionRule(
            stream_id=h["stream_id"],
            field_path="$.email",
            sensitivity_class=SENSITIVITY_CLASS_PII,
            protection_mode=PROTECTION_MODE_PARTIAL_MASK,
            enabled=True,
            created_by="test",
        )
    )
    db_session.add(
        RouteProtectionRule(
            route_id=h["route_a_id"],
            field_path="$.secret",
            sensitivity_class=SENSITIVITY_CLASS_SECRET,
            protection_mode=PROTECTION_MODE_FULL_MASK,
            enabled=True,
            created_by="test",
        )
    )
    db_session.commit()

    r = route_protection_effective_client.get(f"/api/v1/runtime/routes/{h['route_a_id']}/protection/effective")
    body = r.json()
    assert body["persisted_source"] == "route"
    assert body["fallback_used"] is False
    assert body["processing_status"] == "Overridden"
    assert body["rule_count"] == 1


def test_route_protection_effective_mixed_disabled_route_rows(
    route_protection_effective_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    db_session.add(
        StreamProtectionRule(
            stream_id=h["stream_id"],
            field_path="$.email",
            sensitivity_class=SENSITIVITY_CLASS_PII,
            protection_mode=PROTECTION_MODE_PARTIAL_MASK,
            enabled=True,
            created_by="test",
        )
    )
    db_session.add(
        RouteProtectionRule(
            route_id=h["route_a_id"],
            field_path="$.secret",
            sensitivity_class=SENSITIVITY_CLASS_SECRET,
            protection_mode=PROTECTION_MODE_FULL_MASK,
            enabled=False,
            created_by="test",
        )
    )
    db_session.commit()

    r = route_protection_effective_client.get(f"/api/v1/runtime/routes/{h['route_a_id']}/protection/effective")
    body = r.json()
    assert body["persisted_source"] == "stream"
    assert body["fallback_used"] is True
    assert body["processing_status"] == "Mixed"
    assert body["rule_count"] == 1
