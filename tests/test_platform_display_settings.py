"""Platform display settings and user timezone preference."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.auth.jwt_service import issue_access_token
from app.database import get_db
from app.main import app
from app.platform_admin.models import PlatformUser
from app.platform_admin.timezone_util import validate_iana_timezone


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def auth_client(db_session: Session) -> TestClient:
    """TestClient that shares ``db_session`` (needed for JWT profile mutations)."""

    def _override() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def _seed_profile_user(db: Session, *, username: str = "tz-profile-user") -> PlatformUser:
    user = PlatformUser(
        username=username,
        password_hash="x",
        role="OPERATOR",
        status="ACTIVE",
        token_version=1,
        timezone=None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _auth_headers(user: PlatformUser) -> dict[str, str]:
    token, _ = issue_access_token(
        username=str(user.username),
        user_id=int(user.id),
        role=str(user.role),
        token_version=int(user.token_version or 1),
    )
    return {"Authorization": f"Bearer {token}"}


def _read_timezone_fresh(db_engine: Engine, user_id: int) -> str | None:
    """Re-open a new Session to prove the value was committed to the DB."""

    session = sessionmaker(bind=db_engine, autocommit=False, autoflush=False)()
    try:
        row = session.get(PlatformUser, user_id)
        assert row is not None
        return row.timezone
    finally:
        session.close()


def test_display_settings_round_trip(client: TestClient) -> None:
    get_resp = client.get("/api/v1/admin/display-settings")
    assert get_resp.status_code == 200
    body = get_resp.json()
    assert "default_timezone" in body

    put_resp = client.put(
        "/api/v1/admin/display-settings",
        json={"default_timezone": "Asia/Seoul"},
    )
    assert put_resp.status_code == 200
    assert put_resp.json()["default_timezone"] == "Asia/Seoul"

    who = client.get("/api/v1/auth/whoami")
    assert who.status_code == 200
    assert who.json().get("platform_default_timezone") == "Asia/Seoul"

    restore = client.put("/api/v1/admin/display-settings", json={"default_timezone": "UTC"})
    assert restore.status_code == 200


@pytest.mark.parametrize(
    "tz",
    ["Asia/Seoul", "America/Los_Angeles", "Europe/Berlin", "Asia/Tokyo", "UTC"],
)
def test_display_settings_accepts_iana_zones(client: TestClient, tz: str) -> None:
    put_resp = client.put("/api/v1/admin/display-settings", json={"default_timezone": tz})
    assert put_resp.status_code == 200, put_resp.text
    assert put_resp.json()["default_timezone"] == tz
    restore = client.put("/api/v1/admin/display-settings", json={"default_timezone": "UTC"})
    assert restore.status_code == 200


@pytest.mark.parametrize(
    "tz",
    ["KST", "GMT+9", "+09:00", "Not/A/Zone", "EST"],
)
def test_display_settings_rejects_non_iana(client: TestClient, tz: str) -> None:
    resp = client.put("/api/v1/admin/display-settings", json={"default_timezone": tz})
    assert resp.status_code == 400, resp.text
    detail = resp.json().get("detail") or {}
    assert detail.get("error_code") == "INVALID_TIMEZONE"


def test_whoami_includes_timezone_fields(client: TestClient) -> None:
    who = client.get("/api/v1/auth/whoami")
    assert who.status_code == 200
    data = who.json()
    assert "platform_default_timezone" in data
    assert "timezone" in data


def test_invalid_timezone_rejected(client: TestClient) -> None:
    resp = client.put("/api/v1/admin/display-settings", json={"default_timezone": "Not/A/Zone"})
    assert resp.status_code == 400


def test_validate_iana_timezone_unit() -> None:
    assert validate_iana_timezone("UTC") == "UTC"
    assert validate_iana_timezone("Asia/Seoul") == "Asia/Seoul"
    assert validate_iana_timezone("America/Los_Angeles") == "America/Los_Angeles"
    with pytest.raises(ValueError):
        validate_iana_timezone("KST")
    with pytest.raises(ValueError):
        validate_iana_timezone("GMT+9")
    with pytest.raises(ValueError):
        validate_iana_timezone("random-string")


def test_patch_profile_timezone_persists_across_new_db_session(
    auth_client: TestClient,
    db_session: Session,
    db_engine: Engine,
) -> None:
    user = _seed_profile_user(db_session, username="tz-persist-user")
    headers = _auth_headers(user)

    patch = auth_client.patch(
        "/api/v1/auth/profile",
        headers=headers,
        json={"timezone": "Asia/Seoul"},
    )
    assert patch.status_code == 200, patch.text
    assert patch.json()["timezone"] == "Asia/Seoul"

    who = auth_client.get("/api/v1/auth/whoami", headers=headers)
    assert who.status_code == 200
    assert who.json()["timezone"] == "Asia/Seoul"

    assert _read_timezone_fresh(db_engine, int(user.id)) == "Asia/Seoul"


@pytest.mark.parametrize(
    "bad_tz",
    ["KST", "GMT+9", "+09:00", "Invalid/Timezone"],
)
def test_patch_profile_rejects_non_iana_and_keeps_previous(
    auth_client: TestClient,
    db_session: Session,
    db_engine: Engine,
    bad_tz: str,
) -> None:
    user = _seed_profile_user(db_session, username=f"tz-reject-{bad_tz.replace('/', '-').replace('+', 'p')}")
    headers = _auth_headers(user)

    ok = auth_client.patch(
        "/api/v1/auth/profile",
        headers=headers,
        json={"timezone": "Asia/Seoul"},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["timezone"] == "Asia/Seoul"

    bad = auth_client.patch(
        "/api/v1/auth/profile",
        headers=headers,
        json={"timezone": bad_tz},
    )
    assert bad.status_code == 400, bad.text
    detail = bad.json().get("detail") or {}
    assert detail.get("error_code") == "INVALID_TIMEZONE"

    who = auth_client.get("/api/v1/auth/whoami", headers=headers)
    assert who.status_code == 200
    assert who.json()["timezone"] == "Asia/Seoul"
    assert _read_timezone_fresh(db_engine, int(user.id)) == "Asia/Seoul"


def test_patch_profile_can_clear_timezone(
    auth_client: TestClient,
    db_session: Session,
    db_engine: Engine,
) -> None:
    user = _seed_profile_user(db_session, username="tz-clear-user")
    headers = _auth_headers(user)

    auth_client.patch("/api/v1/auth/profile", headers=headers, json={"timezone": "UTC"})
    cleared = auth_client.patch("/api/v1/auth/profile", headers=headers, json={"timezone": ""})
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["timezone"] is None
    assert _read_timezone_fresh(db_engine, int(user.id)) is None
