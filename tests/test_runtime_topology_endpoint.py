"""Read-only runtime topology aggregation endpoint."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.database import get_db
from app.destinations.models import Destination
from app.enrichments.models import Enrichment
from app.main import app
from app.mappings.models import Mapping
from app.routes.models import Route
from app.sources.models import Source
from app.streams.models import Stream

UTC = timezone.utc


def _seed_topology_graph(db: Session) -> dict[str, int]:
    connector = Connector(name="topo-connector", description=None, status="RUNNING")
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
        name="topo-stream",
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
        Mapping(
            stream_id=stream.id,
            event_array_path="$.events",
            field_mappings_json={"severity": "$.level"},
        )
    )
    db.add(
        Enrichment(
            stream_id=stream.id,
            enrichment_json={"tenant": "acme"},
            enabled=True,
        )
    )
    d1 = Destination(
        name="topo-dest-a",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://a.example/h"},
        rate_limit_json={},
        enabled=True,
    )
    d2 = Destination(
        name="topo-dest-b",
        destination_type="SYSLOG_TCP",
        config_json={"host": "syslog.example", "port": 514},
        rate_limit_json={},
        enabled=False,
    )
    db.add_all([d1, d2])
    db.flush()
    r1 = Route(
        stream_id=stream.id,
        destination_id=d1.id,
        enabled=True,
        failure_policy="LOG_AND_CONTINUE",
        formatter_config_json={},
        rate_limit_json={},
        status="ENABLED",
    )
    r2 = Route(
        stream_id=stream.id,
        destination_id=d2.id,
        enabled=False,
        failure_policy="LOG_AND_CONTINUE",
        formatter_config_json={},
        rate_limit_json={},
        status="DISABLED",
    )
    db.add_all([r1, r2])
    db.add(Checkpoint(stream_id=stream.id, checkpoint_type="CUSTOM_FIELD", checkpoint_value_json={}))
    db.commit()
    return {
        "connector_id": int(connector.id),
        "source_id": int(source.id),
        "stream_id": int(stream.id),
        "route_a_id": int(r1.id),
        "route_b_id": int(r2.id),
        "dest_a_id": int(d1.id),
        "dest_b_id": int(d2.id),
    }


@pytest.fixture
def topology_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_runtime_topology_empty(db_session: Session, topology_client: TestClient) -> None:
    res = topology_client.get("/api/v1/runtime/topology?window=1h")
    assert res.status_code == 200
    body = res.json()
    assert body["summary"]["stream_count"] == 0
    assert body["streams"] == []
    assert body["routes"] == []


def test_runtime_topology_links_source_stream_routes_and_flags(
    db_session: Session, topology_client: TestClient
) -> None:
    ids = _seed_topology_graph(db_session)

    res = topology_client.get("/api/v1/runtime/topology?window=1h&scoring_mode=current_runtime")
    assert res.status_code == 200
    body = res.json()

    assert body["summary"]["stream_count"] == 1
    assert body["summary"]["route_count"] == 2
    assert body["summary"]["streams_with_mapping"] == 1
    assert body["summary"]["streams_with_enrichment"] == 1
    assert body["summary"]["enabled_routes"] == 1
    assert body["summary"]["disabled_routes"] == 1

    stream = next(s for s in body["streams"] if s["stream_id"] == ids["stream_id"])
    assert stream["source_id"] == ids["source_id"]
    assert stream["connector_id"] == ids["connector_id"]
    assert stream["has_mapping"] is True
    assert stream["has_enrichment"] is True
    assert stream["route_count"] == 2

    routes = [r for r in body["routes"] if r["stream_id"] == ids["stream_id"]]
    assert len(routes) == 2
    dest_ids = {r["destination_id"] for r in routes}
    assert dest_ids == {ids["dest_a_id"], ids["dest_b_id"]}

    disabled = next(r for r in routes if r["route_id"] == ids["route_b_id"])
    assert disabled["enabled"] is False
    assert disabled["destination_enabled"] is False

    source = next(s for s in body["sources"] if s["id"] == ids["source_id"])
    assert source["connector_id"] == ids["connector_id"]
    assert source["stream_count"] == 1


def test_runtime_topology_excludes_orphan_destination(
    db_session: Session, topology_client: TestClient
) -> None:
    ids = _seed_topology_graph(db_session)
    orphan = Destination(
        name="topo-orphan",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://orphan.example/h"},
        rate_limit_json={},
        enabled=True,
    )
    db_session.add(orphan)
    db_session.commit()

    body = topology_client.get("/api/v1/runtime/topology").json()
    dest_ids = {d["destination_id"] for d in body["destinations"]}
    assert ids["dest_a_id"] in dest_ids
    assert ids["dest_b_id"] in dest_ids
    assert int(orphan.id) not in dest_ids
