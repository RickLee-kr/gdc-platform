from __future__ import annotations

import pytest
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.db.seed import seed_default_platform_admin, seed_dev_data
from app.destinations.models import Destination
from app.platform_admin.models import PlatformUser
from app.routes.models import Route
from app.runners.stream_loader import load_stream_context
from app.streams.models import Stream

def test_seed_dev_data_idempotent_and_loadable_context(db_session: Session) -> None:
    db = db_session

    first = seed_dev_data(db)
    second = seed_dev_data(db)

    assert first["connector_id"] == second["connector_id"]
    assert first["stream_id"] == second["stream_id"]
    assert first["route_id"] == second["route_id"]
    assert first["checkpoint_id"] == second["checkpoint_id"]

    connector_count = db.query(func.count(Connector.id)).scalar()
    stream_count = db.query(func.count(Stream.id)).scalar()
    destination_count = db.query(func.count(Destination.id)).scalar()
    route_count = db.query(func.count(Route.id)).scalar()
    checkpoint_count = db.query(func.count(Checkpoint.id)).scalar()

    assert connector_count == 1
    assert stream_count == 1
    assert destination_count == 1
    assert route_count == 1
    assert checkpoint_count == 1

    context = load_stream_context(db, first["stream_id"])
    assert context.checkpoint == {"type": "EVENT_ID", "value": {"last_event_id": None}}
    assert context.routes
    seeded_route = db.query(Route).filter(Route.id == first["route_id"]).one()
    assert seeded_route.formatter_config_json == {"message_format": "json"}
    assert "format" not in seeded_route.formatter_config_json
    assert context.routes[0]["destination"]["destination_type"] == "WEBHOOK_POST"
    assert context.destinations_by_route

    assert first["connector_id"] > 0
    assert first["stream_id"] > 0
    assert first["route_id"] > 0
    assert first["checkpoint_id"] > 0


def test_seed_default_platform_admin_idempotent(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GDC_SEED_ADMIN_PASSWORD", raising=False)
    first = seed_default_platform_admin(db_session)
    second = seed_default_platform_admin(db_session)

    assert first["created"] is True
    assert first["username"] == "admin"
    assert isinstance(first["user_id"], int)

    assert second["created"] is False
    assert second["username"] == "admin"

    row = db_session.query(PlatformUser).filter(PlatformUser.username == "admin").one()
    assert row.role == "ADMINISTRATOR"
    assert row.status == "ACTIVE"
    assert row.must_change_password is True
    from app.auth.security import verify_password

    assert verify_password("admin", row.password_hash) is True


def test_seed_main_cli_help_and_unknown() -> None:
    from app.db.seed import main

    assert main(["--help"]) == 0
    assert main(["-h"]) == 0
    assert main(["--platform-admin-only", "--bogus"]) == 2
