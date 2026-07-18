"""Unit tests for lab retention preview / execute gating."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.orm import Session

from app.config import settings
from app.dev_validation_lab import lab_retention as lr
from app.platform_admin.models import PlatformAlertHistory


UTC = timezone.utc


@pytest.fixture
def lab_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ENABLE_DEV_VALIDATION_LAB", True, raising=False)
    monkeypatch.setattr(settings, "APP_ENV", "development", raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_RETENTION_ENABLED", True, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_RETENTION_AUTOMATIC_CLEANUP", False, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_ALERT_HISTORY_RETENTION_DAYS", 7, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_REPLAY_EVENT_RETENTION_DAYS", 7, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_DELIVERY_LOG_RETENTION_DAYS", 7, raising=False)


def test_lab_retention_settings_disabled_when_lab_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ENABLE_DEV_VALIDATION_LAB", False, raising=False)
    monkeypatch.setattr(settings, "APP_ENV", "development", raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_RETENTION_ENABLED", True, raising=False)
    cfg = lr.lab_retention_settings()
    assert cfg["enabled"] is False
    assert cfg["lab_effective"] is False


def test_preview_and_execute_gating(db_session: Session, lab_on: None, monkeypatch: pytest.MonkeyPatch) -> None:
    old = datetime.now(UTC) - timedelta(days=30)
    db_session.add(
        PlatformAlertHistory(
            created_at=old,
            alert_type="test",
            severity="INFO",
            message="old alert",
            fingerprint="fp-lab-retention-1",
            delivery_status="ok",
            payload_json={},
        )
    )
    db_session.commit()

    preview = lr.preview_lab_cleanup(db_session)
    assert preview["execute"] is False
    assert preview["retention"]["enabled"] is True
    alert_row = next(t for t in preview["tables"] if t["table"] == "platform_alert_history")
    assert alert_row["rows_eligible"] >= 1

    dry = lr.execute_lab_cleanup(db_session, execute=False)
    assert dry["execute"] is False
    assert "dry-run" in str(dry.get("message") or "").lower() or dry.get("execute") is False
    still = db_session.query(PlatformAlertHistory).filter_by(fingerprint="fp-lab-retention-1").count()
    assert still == 1

    executed = lr.execute_lab_cleanup(db_session, execute=True)
    assert executed["execute"] is True
    outcomes = {o["table"]: o for o in executed.get("outcomes") or []}
    assert "platform_alert_history" in outcomes
    assert outcomes["platform_alert_history"]["deleted_count"] >= 1
    assert db_session.query(PlatformAlertHistory).filter_by(fingerprint="fp-lab-retention-1").count() == 0
    assert executed.get("partition_drop_performed") is False

    snap = lr.last_lab_cleanup_snapshot()
    assert snap["last_cleanup_at"] is not None


def test_scheduled_cleanup_dry_run_only_by_default(
    db_session: Session, lab_on: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    result = lr.run_scheduled_lab_cleanup(db_session)
    assert result.get("skipped_execute") is True or result.get("execute") is not True

    monkeypatch.setattr(settings, "GDC_LAB_RETENTION_AUTOMATIC_CLEANUP", True, raising=False)
    # No eligible rows required — just ensure execute path is allowed when gated on.
    result2 = lr.run_scheduled_lab_cleanup(db_session)
    assert result2.get("execute") is True or result2.get("skipped") is True


def test_execute_refuses_when_retention_disabled(
    db_session: Session, lab_on: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "GDC_LAB_RETENTION_ENABLED", False, raising=False)
    out = lr.execute_lab_cleanup(db_session, execute=True)
    assert out.get("execute") is False
    assert "refusing" in str(out.get("message") or "").lower() or out.get("retention", {}).get("enabled") is False
