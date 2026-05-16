from __future__ import annotations

import pytest
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.db.seed import reset_or_create_platform_admin_password, seed_default_platform_admin, seed_dev_data
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


def test_reset_platform_admin_password_updates_existing(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GDC_SEED_ADMIN_PASSWORD", raising=False)
    seed_default_platform_admin(db_session)
    row_before = db_session.query(PlatformUser).filter(PlatformUser.username == "admin").one()
    tv_before = int(row_before.token_version)

    monkeypatch.setenv("GDC_SEED_ADMIN_PASSWORD", "NewLongPwd1!")
    out = reset_or_create_platform_admin_password(db_session)

    assert out["created"] is False
    assert out["password_reset"] is True
    assert out["username"] == "admin"

    from app.auth.security import verify_password

    row = db_session.query(PlatformUser).filter(PlatformUser.username == "admin").one()
    assert verify_password("NewLongPwd1!", row.password_hash) is True
    assert row.must_change_password is False
    assert int(row.token_version) == tv_before + 1


def test_reset_platform_admin_password_creates_when_missing(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GDC_SEED_ADMIN_PASSWORD", "CreatePwd9!")
    out = reset_or_create_platform_admin_password(db_session)

    assert out["created"] is True
    assert out.get("password_reset") is None
    row = db_session.query(PlatformUser).filter(PlatformUser.username == "admin").one()
    from app.auth.security import verify_password

    assert verify_password("CreatePwd9!", row.password_hash) is True


def test_reset_platform_admin_password_requires_env_when_existing(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("GDC_SEED_ADMIN_PASSWORD", raising=False)
    seed_default_platform_admin(db_session)
    monkeypatch.delenv("GDC_SEED_ADMIN_PASSWORD", raising=False)

    with pytest.raises(ValueError, match="GDC_SEED_ADMIN_PASSWORD"):
        reset_or_create_platform_admin_password(db_session)


def test_reset_platform_admin_password_only_touches_admin_user(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.auth.security import get_password_hash, verify_password

    other = PlatformUser(
        username="viewer1",
        password_hash=get_password_hash("ViewerPwd1!"),
        role="VIEWER",
        status="ACTIVE",
        must_change_password=False,
    )
    db_session.add(other)
    db_session.commit()

    monkeypatch.delenv("GDC_SEED_ADMIN_PASSWORD", raising=False)
    seed_default_platform_admin(db_session)
    monkeypatch.setenv("GDC_SEED_ADMIN_PASSWORD", "AdminReset2!")

    reset_or_create_platform_admin_password(db_session)

    other_reloaded = db_session.query(PlatformUser).filter(PlatformUser.username == "viewer1").one()
    assert verify_password("ViewerPwd1!", other_reloaded.password_hash) is True


def test_seed_main_cli_help_and_unknown() -> None:
    from app.db.seed import main

    assert main(["--help"]) == 0
    assert main(["-h"]) == 0
    assert main(["--platform-admin-only", "--bogus"]) == 2


def test_seed_main_reset_requires_platform_admin_only() -> None:
    from app.db.seed import main

    assert main(["--reset-platform-admin-password"]) == 2
