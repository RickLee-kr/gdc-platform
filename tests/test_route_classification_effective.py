"""Route classification effective config API."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.classification.models import StreamClassificationRule
from app.database import get_db, get_db_read_bounded
from app.main import app
from app.route_classification.models import RouteClassificationRule
from tests.test_runtime_logs_page_endpoint import _seed_stream_two_routes


@pytest.fixture
def route_classification_effective_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_db_read_bounded] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_db_read_bounded, None)


def test_route_classification_effective_inherited(
    route_classification_effective_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    db_session.add(
        StreamClassificationRule(
            stream_id=h["stream_id"],
            name="pii-internal",
            enabled=True,
            condition_json={"sensitivity_class": "pii"},
            classification_level="INTERNAL",
        )
    )
    db_session.commit()

    r = route_classification_effective_client.get(
        f"/api/v1/runtime/routes/{h['route_a_id']}/classification/effective"
    )
    assert r.status_code == 200
    body = r.json()
    assert body["persisted_source"] == "stream"
    assert body["fallback_used"] is True
    assert body["rule_count"] == 1
    assert body["processing_status"] == "Inherited"


def test_route_classification_effective_overridden(
    route_classification_effective_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    db_session.add(
        StreamClassificationRule(
            stream_id=h["stream_id"],
            name="pii-internal",
            enabled=True,
            condition_json={"sensitivity_class": "pii"},
            classification_level="INTERNAL",
        )
    )
    db_session.add(
        RouteClassificationRule(
            route_id=h["route_a_id"],
            name="secret-restricted",
            enabled=True,
            condition_json={"sensitivity_class": "secret"},
            classification_level="RESTRICTED",
        )
    )
    db_session.commit()

    r = route_classification_effective_client.get(
        f"/api/v1/runtime/routes/{h['route_a_id']}/classification/effective"
    )
    body = r.json()
    assert body["persisted_source"] == "route"
    assert body["fallback_used"] is False
    assert body["processing_status"] == "Overridden"
    assert body["rule_count"] == 1


def test_route_classification_effective_mixed_disabled_route_rows(
    route_classification_effective_client: TestClient,
    db_session: Session,
) -> None:
    h = _seed_stream_two_routes(db_session)
    db_session.add(
        StreamClassificationRule(
            stream_id=h["stream_id"],
            name="pii-internal",
            enabled=True,
            condition_json={"sensitivity_class": "pii"},
            classification_level="INTERNAL",
        )
    )
    db_session.add(
        RouteClassificationRule(
            route_id=h["route_a_id"],
            name="secret-restricted",
            enabled=False,
            condition_json={"sensitivity_class": "secret"},
            classification_level="RESTRICTED",
        )
    )
    db_session.commit()

    r = route_classification_effective_client.get(
        f"/api/v1/runtime/routes/{h['route_a_id']}/classification/effective"
    )
    body = r.json()
    assert body["persisted_source"] == "stream"
    assert body["fallback_used"] is True
    assert body["processing_status"] == "Mixed"
    assert body["rule_count"] == 1
