"""Tests for pytest catalog leak cleanup on the platform gdc catalog."""

from __future__ import annotations

from app.connectors.models import Connector
from app.destinations.models import Destination
from app.dev_validation_lab.pytest_catalog_cleanup import cleanup_pytest_catalog_leaks
from app.sources.models import Source
from app.streams.models import Stream
from tests.test_stream_runner_e2e import _seed_stream_runtime


def test_cleanup_pytest_catalog_leaks_removes_legacy_rows(db_session) -> None:
    fixture = _seed_stream_runtime(db_session)
    legacy = Connector(name="e2e-connector", description="legacy leak", status="STOPPED")
    db_session.add(legacy)
    db_session.flush()
    legacy_source = Source(
        connector_id=legacy.id,
        source_type="HTTP_API_POLLING",
        config_json={"base_url": "https://api.example.com"},
        auth_json={"auth_type": "no_auth"},
        enabled=True,
    )
    db_session.add(legacy_source)
    db_session.flush()
    legacy_stream = Stream(
        connector_id=legacy.id,
        source_id=legacy_source.id,
        name="e2e-stream",
        stream_type="HTTP_API_POLLING",
        config_json={"endpoint": "/events"},
        polling_interval=60,
        enabled=True,
        status="STOPPED",
    )
    db_session.add(legacy_stream)
    db_session.commit()

    result = cleanup_pytest_catalog_leaks(db_session)

    assert result["removed_streams"] >= 2
    assert result["removed_connectors"] >= 1
    assert db_session.query(Connector).filter(Connector.name == "e2e-connector").count() == 0
    assert db_session.query(Stream).filter(Stream.id == fixture["stream_id"]).count() == 0
    assert db_session.query(Destination).filter(Destination.name.like("pytest-sr-dest-%")).count() == 0


def test_cleanup_pytest_catalog_leaks_preserves_dev_validation_rows(db_session) -> None:
    dev = Connector(name="[DEV VALIDATION] Generic REST", description="lab", status="RUNNING")
    db_session.add(dev)
    db_session.commit()

    result = cleanup_pytest_catalog_leaks(db_session)

    assert result["removed_connectors"] == 0
    assert db_session.query(Connector).filter(Connector.name == "[DEV VALIDATION] Generic REST").count() == 1
