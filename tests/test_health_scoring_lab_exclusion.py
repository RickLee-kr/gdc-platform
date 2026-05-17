"""Health scoring must omit dev-validation negative-path streams (explicit config_json flags)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.orm import Session

from app.connectors.models import Connector
from app.destinations.models import Destination
from app.logs.models import DeliveryLog
from app.runtime import health_service
from app.routes.models import Route
from app.sources.models import Source
from app.streams.models import Stream

UTC = timezone.utc


def _seed_pair(
    db: Session,
    *,
    stream_name: str,
    exclude_from_health_scoring: bool,
) -> tuple[int, int]:
    connector = Connector(name=f"hsx-{stream_name}", description=None, status="RUNNING")
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
    cfg: dict = {}
    if exclude_from_health_scoring:
        cfg["exclude_from_health_scoring"] = True
        cfg["validation_expected_failure"] = True
    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name=stream_name,
        stream_type="HTTP_API_POLLING",
        config_json=cfg,
        polling_interval=60,
        enabled=True,
        status="RUNNING",
        rate_limit_json={},
    )
    db.add(stream)
    db.flush()
    dest = Destination(
        name=f"hsx-d-{stream_name}",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://example.invalid/h"},
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
    now = datetime.now(UTC)
    db.add(
        DeliveryLog(
            stream_id=stream.id,
            route_id=route.id,
            destination_id=dest.id,
            stage="route_send_failed",
            message="fail",
            created_at=now,
        )
    )
    db.commit()
    return int(stream.id), int(route.id)


def test_health_overview_omits_excluded_stream_failures(db_session: Session) -> None:
    good_id, _ = _seed_pair(db_session, stream_name="hsx-good", exclude_from_health_scoring=False)
    bad_id, _ = _seed_pair(db_session, stream_name="hsx-bad", exclude_from_health_scoring=True)
    since = datetime.now(UTC) - timedelta(hours=1)
    overview = health_service.get_health_overview(db_session, window=None, since=since, stream_id=None, route_id=None, destination_id=None)
    stream_ids = {r.stream_id for r in overview.worst_streams}
    assert bad_id not in stream_ids
    assert good_id in stream_ids or overview.streams.critical + overview.streams.unhealthy > 0


def test_health_detail_still_available_for_excluded_stream(db_session: Session) -> None:
    bad_id, _ = _seed_pair(db_session, stream_name="hsx-bad-detail", exclude_from_health_scoring=True)
    since = datetime.now(UTC) - timedelta(hours=1)
    detail = health_service.get_stream_health_detail(
        db_session,
        stream_id=bad_id,
        window=None,
        since=since,
        route_id=None,
        destination_id=None,
    )
    assert detail.score.metrics.failure_count >= 1
