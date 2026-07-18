"""Regression tests: secrets must not leak via API, audit, merge, or error paths."""

from __future__ import annotations

import json
from typing import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db, get_db_read_bounded
from app.destinations.models import Destination
from app.main import app
from app.platform_admin import journal
from app.platform_admin.models import PlatformAuditEvent
from app.security.secrets import (
    SECRET_MASK,
    mask_credential_url,
    mask_secrets,
    merge_preserving_masked_secrets,
    sanitize_error_detail,
    secret_fields_changed,
)


LEAK_MARKER = "SECRET-LEAK-VERIFY-DO-NOT-EXPOSE"


@pytest.fixture
def client(db_session: Session) -> Iterator[TestClient]:
    def _override_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_db_read_bounded] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_db_read_bounded, None)


def test_mask_credential_url_strips_password():
    assert (
        mask_credential_url(f"postgres://admin:{LEAK_MARKER}@db.example:5432/gdc")
        == f"postgres://admin:{SECRET_MASK}@db.example:5432/gdc"
    )
    assert mask_credential_url("https://example.com/hook") == "https://example.com/hook"


def test_mask_secrets_masks_shared_secret_and_headers():
    payload = {
        "shared_secret": LEAK_MARKER,
        "headers": {"Authorization": f"Bearer {LEAK_MARKER}", "Accept": "application/json"},
        "common_headers": {"X-API-Key": LEAK_MARKER, "Accept": "application/json"},
        "url": f"https://user:{LEAK_MARKER}@hooks.example/path",
    }
    out = mask_secrets(payload)
    blob = json.dumps(out)
    assert LEAK_MARKER not in blob
    assert out["shared_secret"] == SECRET_MASK
    assert out["headers"]["Authorization"] == SECRET_MASK
    assert out["headers"]["Accept"] == "application/json"
    assert out["common_headers"]["X-API-Key"] == SECRET_MASK
    assert SECRET_MASK in out["url"]


def test_merge_preserving_masked_secrets_keeps_existing():
    existing = {
        "headers": {"Authorization": f"Bearer {LEAK_MARKER}"},
        "token": LEAK_MARKER,
        "url": "https://hooks.example/ok",
    }
    incoming = {
        "headers": {"Authorization": SECRET_MASK},
        "token": SECRET_MASK,
        "url": "https://hooks.example/updated",
    }
    merged = merge_preserving_masked_secrets(incoming, existing)
    assert merged["token"] == LEAK_MARKER
    assert merged["headers"]["Authorization"] == f"Bearer {LEAK_MARKER}"
    assert merged["url"] == "https://hooks.example/updated"


def test_secret_fields_changed_reports_names_only():
    before = {"token": "old", "name": "a"}
    after = {"token": "new", "name": "a"}
    changed = secret_fields_changed(before, after)
    assert "token" in changed
    assert LEAK_MARKER not in json.dumps(changed)


def test_sanitize_error_detail_masks_credential_urls():
    detail = {
        "message": f"connect failed: postgres://u:{LEAK_MARKER}@db/app",
        "password": LEAK_MARKER,
    }
    out = sanitize_error_detail(detail)
    blob = json.dumps(out)
    assert LEAK_MARKER not in blob


def test_destination_api_masks_webhook_headers(client: TestClient, db_session: Session):
    row = Destination(
        name="leak-dest-mask",
        destination_type="WEBHOOK_POST",
        config_json={
            "url": "https://hooks.example/events",
            "headers": {"Authorization": f"Bearer {LEAK_MARKER}", "X-Token": LEAK_MARKER},
        },
        enabled=True,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)

    r = client.get(f"/api/v1/destinations/{row.id}")
    assert r.status_code == 200
    body = r.json()
    blob = json.dumps(body)
    assert LEAK_MARKER not in blob
    assert body["config_json"]["headers"]["Authorization"] == SECRET_MASK
    assert body["config_json"]["url"] == "https://hooks.example/events"

    # Preserve secrets when client resubmits the mask.
    upd = client.put(
        f"/api/v1/destinations/{row.id}",
        json={
            "name": "leak-dest-mask",
            "config_json": {
                "url": "https://hooks.example/events",
                "headers": {"Authorization": SECRET_MASK, "X-Token": SECRET_MASK},
            },
        },
    )
    assert upd.status_code == 200
    assert LEAK_MARKER not in json.dumps(upd.json())

    db_session.refresh(row)
    assert row.config_json["headers"]["Authorization"] == f"Bearer {LEAK_MARKER}"
    assert row.config_json["headers"]["X-Token"] == LEAK_MARKER


def test_platform_audit_event_details_sanitized(db_session: Session):
    journal.record_audit_event(
        db_session,
        action="TEST_SECRET_AUDIT",
        entity_type="DESTINATION",
        entity_id=1,
        entity_name="x",
        details={"password": LEAK_MARKER, "note": "ok"},
    )
    db_session.commit()
    row = (
        db_session.query(PlatformAuditEvent)
        .filter(PlatformAuditEvent.action == "TEST_SECRET_AUDIT")
        .order_by(PlatformAuditEvent.id.desc())
        .first()
    )
    assert row is not None
    blob = json.dumps(row.details_json or {})
    assert LEAK_MARKER not in blob
    assert (row.details_json or {}).get("password") == SECRET_MASK
