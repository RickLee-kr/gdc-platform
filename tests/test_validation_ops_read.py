"""validation_runs dashboard trend read hardening."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.validation.models import ContinuousValidation, ValidationRun
from app.validation.ops_read import (
    build_validation_operational_summary,
    validation_outcome_trend_buckets,
)

UTC = timezone.utc


def _mk_validation(db: Session, *, name: str = "trend-val") -> ContinuousValidation:
    row = ContinuousValidation(
        name=name,
        enabled=True,
        validation_type="AUTH_ONLY",
        target_stream_id=None,
        schedule_seconds=300,
        expect_checkpoint_advance=False,
    )
    db.add(row)
    db.flush()
    return row


def test_validation_outcome_trend_buckets_scoped_to_recent_runner_summary(db_session: Session) -> None:
    val = _mk_validation(db_session)
    now = datetime.now(UTC)
    db_session.add(
        ValidationRun(
            validation_id=val.id,
            stream_id=None,
            status="PASS",
            validation_stage="runner_summary",
            message="ok",
            created_at=now - timedelta(hours=2),
        )
    )
    db_session.add(
        ValidationRun(
            validation_id=val.id,
            stream_id=None,
            status="FAIL",
            validation_stage="runner_summary",
            message="bad",
            created_at=now - timedelta(hours=30),
        )
    )
    db_session.add(
        ValidationRun(
            validation_id=val.id,
            stream_id=None,
            status="FAIL",
            validation_stage="stage_detail",
            message="ignored",
            created_at=now - timedelta(hours=1),
        )
    )
    db_session.commit()

    trend = validation_outcome_trend_buckets(db_session, hours=24)
    assert len(trend) == 1
    assert trend[0]["pass_count"] == 1
    assert trend[0]["fail_count"] == 0


def test_validation_outcome_trend_buckets_empty_without_validations(db_session: Session) -> None:
    assert validation_outcome_trend_buckets(db_session, hours=24) == []


def test_build_validation_operational_summary_marks_degraded_on_trend_timeout(
    db_session: Session,
) -> None:
    _mk_validation(db_session)
    db_session.commit()
    with patch(
        "app.validation.ops_read.validation_outcome_trend_buckets",
        side_effect=OperationalError("statement", {}, Exception("timeout")),
    ):
        payload = build_validation_operational_summary(db_session, scoring_mode="current_runtime")
    assert payload["outcome_trend_24h"] == []
    assert payload["degraded"] is True
