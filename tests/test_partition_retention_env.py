"""Retention policy env alias tests."""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from app.config import settings
from app.platform_admin.repository import get_retention_policy_row
from app.retention.config import effective_retention_policies


def test_delivery_log_retention_env_only(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "GDC_DELIVERY_LOG_RETENTION_DAYS", 14)
    monkeypatch.setattr(settings, "GDC_CHECKPOINT_HISTORY_RETENTION_DAYS", None)
    row = get_retention_policy_row(db_session)
    pol = effective_retention_policies(row)
    assert pol["delivery_logs_days"] == 14
    assert pol["checkpoint_history_days"] == 14
