"""journal.record_audit_event resolves authenticated actor from request."""

from __future__ import annotations

from types import SimpleNamespace

from sqlalchemy.orm import Session

from app.audit.models import AuditLog
from app.auth.role_guard import AuthContext
from app.platform_admin import journal
from app.platform_admin.models import PlatformAuditEvent


def test_record_audit_event_uses_request_actor(db_session: Session) -> None:
    request = SimpleNamespace(
        state=SimpleNamespace(
            auth=AuthContext(user_id=7, username="admin", role="ADMINISTRATOR", source="jwt", token_version=1),
        ),
        client=SimpleNamespace(host="127.0.0.1"),
        headers={"user-agent": "pytest"},
    )
    journal.record_audit_event(
        db_session,
        action="STREAM_CHECKPOINT_UPDATED",
        entity_type="STREAM",
        entity_id=9,
        details={
            "affected_count": 1,
            "previous_value": {"cursor": "a"},
            "new_value": {"cursor": "b"},
            "success": True,
        },
        request=request,
    )
    db_session.commit()

    audit = db_session.query(AuditLog).order_by(AuditLog.id.desc()).first()
    assert audit is not None
    assert audit.action == "STREAM_CHECKPOINT_UPDATED"
    assert audit.actor_username == "admin"
    assert audit.actor_user_id == 7
    assert audit.entity_type == "STREAM"
    assert audit.entity_id == 9
    assert audit.metadata_json["affected_count"] == 1
    assert audit.metadata_json["previous_value"] == {"cursor": "a"}
    assert audit.metadata_json["new_value"] == {"cursor": "b"}

    legacy = db_session.query(PlatformAuditEvent).order_by(PlatformAuditEvent.id.desc()).first()
    assert legacy is not None
    assert legacy.actor_username == "admin"
    assert legacy.action == "STREAM_CHECKPOINT_UPDATED"
