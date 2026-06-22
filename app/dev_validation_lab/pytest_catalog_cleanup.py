"""Remove pytest fixture rows that leaked into the platform catalog (never [DEV VALIDATION] / [DEV E2E])."""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.connectors.models import Connector
from app.destinations.models import Destination
from app.logs.models import DeliveryLog
from app.routes.models import Route
from app.sources.models import Source
from app.streams.delete_scope import delete_stream_and_dependencies
from app.streams.models import Stream

# Legacy fixed names from tests/test_stream_runner_e2e.py and test_s3_stream_runner_checkpoint.py.
_LEGACY_PYTEST_CONNECTOR_NAMES = frozenset({"e2e-connector", "s3-e2e-connector"})
_LEGACY_PYTEST_STREAM_NAMES = frozenset({"e2e-stream", "s3-e2e-stream"})
_LEGACY_DEST_NAME = re.compile(r"^dest-\d+$")
_PYTEST_DEST_PREFIXES = ("pytest-sr-dest-", "pytest-s3-dest-")


def _is_pytest_leak_connector(name: str) -> bool:
    normalized = str(name or "").strip()
    if normalized in _LEGACY_PYTEST_CONNECTOR_NAMES:
        return True
    return normalized.startswith("pytest-sr-") or normalized.startswith("pytest-s3-")


def _is_pytest_leak_stream(name: str) -> bool:
    normalized = str(name or "").strip()
    if normalized in _LEGACY_PYTEST_STREAM_NAMES:
        return True
    return normalized.startswith("pytest-sr-stream-") or normalized.startswith("pytest-s3-stream-")


def _is_pytest_leak_destination(name: str) -> bool:
    normalized = str(name or "").strip()
    if _LEGACY_DEST_NAME.match(normalized):
        return True
    return normalized.startswith(_PYTEST_DEST_PREFIXES)


def cleanup_pytest_catalog_leaks(db: Session) -> dict[str, Any]:
    """Delete leaked pytest connectors/streams/destinations from a live catalog."""

    removed_streams = 0
    removed_connectors = 0
    removed_destinations = 0

    leak_streams = (
        db.query(Stream)
        .join(Connector, Connector.id == Stream.connector_id)
        .filter(
            or_(
                Stream.name.in_(_LEGACY_PYTEST_STREAM_NAMES),
                Connector.name.in_(_LEGACY_PYTEST_CONNECTOR_NAMES),
                Stream.name.like("pytest-sr-stream-%"),
                Stream.name.like("pytest-s3-stream-%"),
                Connector.name.like("pytest-sr-%"),
                Connector.name.like("pytest-s3-%"),
            )
        )
        .order_by(Stream.id.asc())
        .all()
    )
    for stream in leak_streams:
        if str(stream.status or "").upper() == "RUNNING":
            stream.status = "STOPPED"
            db.flush()
        delete_stream_and_dependencies(db, int(stream.id))
        removed_streams += 1

    leak_connector_ids = [
        int(row[0])
        for row in db.query(Connector.id)
        .filter(
            Connector.name.in_(_LEGACY_PYTEST_CONNECTOR_NAMES)
            | Connector.name.like("pytest-sr-%")
            | Connector.name.like("pytest-s3-%")
        )
        .all()
    ]
    if leak_connector_ids:
        db.query(DeliveryLog).filter(DeliveryLog.connector_id.in_(leak_connector_ids)).delete(synchronize_session=False)
        db.query(Source).filter(Source.connector_id.in_(leak_connector_ids)).delete(synchronize_session=False)
        removed_connectors += (
            db.query(Connector)
            .filter(
                or_(
                    Connector.name.in_(_LEGACY_PYTEST_CONNECTOR_NAMES),
                    Connector.name.like("pytest-sr-%"),
                    Connector.name.like("pytest-s3-%"),
                )
            )
            .delete(synchronize_session=False)
            or 0
        )

    orphan_destinations = (
        db.query(Destination)
        .filter(
            Destination.name.in_([f"dest-{idx}" for idx in range(8)])
            | Destination.name.like("pytest-sr-dest-%")
            | Destination.name.like("pytest-s3-dest-%")
        )
        .all()
    )
    for destination in orphan_destinations:
        if not _is_pytest_leak_destination(str(destination.name)):
            continue
        has_route = db.query(Route.id).filter(Route.destination_id == destination.id).first() is not None
        if has_route:
            continue
        db.delete(destination)
        removed_destinations += 1

    db.commit()
    return {
        "removed_streams": removed_streams,
        "removed_connectors": removed_connectors,
        "removed_destinations": removed_destinations,
    }
