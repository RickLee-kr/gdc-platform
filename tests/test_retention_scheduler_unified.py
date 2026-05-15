"""Unified operational retention scheduler: single thread, category + supplement paths."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.orm import Session

from app.backfill.models import BackfillJob
from app.config import settings
from app.database import get_db
from app.main import app
from app.platform_admin.repository import get_retention_policy_row
from app.retention.scheduler import OperationalRetentionScheduler
from app.streams.models import Stream
from fastapi.testclient import TestClient

UTC = timezone.utc


@pytest.fixture
def client(db_session: Session):
    def _override():
        yield db_session

    app.dependency_overrides[get_db] = _override
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_scheduler_lifecycle_start_stop() -> None:
    s = OperationalRetentionScheduler(tick_seconds=3600.0)
    assert not s.is_running()
    s.start()
    assert s.is_running()
    s.stop()
    assert not s.is_running()


def test_single_tick_invokes_cleanup_and_supplement_at_most_once(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "GDC_OPERATIONAL_RETENTION_SUPPLEMENT_ENABLED", True)
    calls = {"cleanup": 0, "supplement": 0}

    def _track_cleanup(*args, **kwargs):
        calls["cleanup"] += 1
        return []

    def _track_supplement(*args, **kwargs):
        calls["supplement"] += 1
        return []

    row = get_retention_policy_row(db_session)
    row.cleanup_scheduler_enabled = True
    row.operational_retention_meta = {}
    db_session.commit()

    sched = OperationalRetentionScheduler(tick_seconds=60.0)
    with (
        patch(
            "app.retention.scheduler.collect_due_categories",
            return_value=["logs"],
        ),
        patch("app.retention.scheduler.run_cleanup", side_effect=_track_cleanup),
        patch("app.retention.scheduler.supplement_due", return_value=True),
        patch("app.retention.scheduler.run_supplement_bundle", side_effect=_track_supplement),
    ):
        sched.trigger_once()

    assert calls["cleanup"] == 1
    assert calls["supplement"] == 1


def test_supplement_runs_when_no_categories_due(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """Previously a separate cleanup thread returned early and could skip supplement in-process; unified thread continues."""

    monkeypatch.setattr(settings, "GDC_OPERATIONAL_RETENTION_SUPPLEMENT_ENABLED", True)
    row = get_retention_policy_row(db_session)
    row.cleanup_scheduler_enabled = True
    row.operational_retention_meta = {}
    db_session.commit()

    sched = OperationalRetentionScheduler(tick_seconds=60.0)
    with (
        patch("app.retention.scheduler.collect_due_categories", return_value=[]),
        patch("app.retention.scheduler.run_cleanup") as mock_cleanup,
        patch("app.retention.scheduler.supplement_due", return_value=True),
        patch("app.retention.scheduler.run_supplement_bundle", return_value=[]) as mock_sup,
    ):
        sched.trigger_once()

    mock_cleanup.assert_not_called()
    mock_sup.assert_called_once()


def test_supplement_metadata_next_after(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "GDC_OPERATIONAL_RETENTION_SUPPLEMENT_ENABLED", True)
    row = get_retention_policy_row(db_session)
    row.cleanup_scheduler_enabled = True
    row.operational_retention_meta = {}
    db_session.commit()

    sched = OperationalRetentionScheduler(tick_seconds=60.0)
    with (
        patch("app.retention.scheduler.collect_due_categories", return_value=[]),
        patch("app.retention.scheduler.supplement_due", return_value=True),
    ):
        sched.trigger_once()

    db_session.expire_all()
    row2 = get_retention_policy_row(db_session)
    meta = dict(row2.operational_retention_meta or {})
    assert meta.get("supplement_next_after") is not None
    assert meta.get("last_operational_retention_at") is not None


def test_retention_status_api_regression(client: TestClient, db_session: Session) -> None:
    r = client.get("/api/v1/retention/status")
    assert r.status_code == 200
    body = r.json()
    assert "policies" in body
    assert "supplement_next_after_utc" in body


def test_runtime_modules_coexist_with_retention_scheduler() -> None:
    """Import smoke: StreamRunner, backfill worker, and unified scheduler load together."""

    from app.backfill.worker import BackfillWorker  # noqa: PLC0415
    from app.runners.stream_runner import StreamRunner  # noqa: PLC0415

    assert StreamRunner and BackfillWorker and OperationalRetentionScheduler


def test_main_single_scheduler_registration_pattern() -> None:
    src = app.router.__class__.__module__
    assert src  # app loads
    import inspect  # noqa: PLC0415

    from app import main as main_mod  # noqa: PLC0415

    src_main = inspect.getsource(main_mod.lifespan)
    assert src_main.count("OperationalRetentionScheduler()") == 1
    assert "register_operational_retention_scheduler" in src_main
    assert src_main.count(".start()") >= 1
    assert "operational_retention_scheduler.start()" in src_main


def test_duplicate_prevention_cleanup_not_called_twice_same_tick(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "GDC_OPERATIONAL_RETENTION_SUPPLEMENT_ENABLED", False)
    n = {"cleanup": 0}

    def _count_cleanup(db, **kwargs):
        n["cleanup"] += 1
        return [MagicMock(category="logs", status="ok", deleted_count=0)]

    row = get_retention_policy_row(db_session)
    row.cleanup_scheduler_enabled = True
    db_session.commit()

    sched = OperationalRetentionScheduler(tick_seconds=60.0)
    with (
        patch(
            "app.retention.scheduler.collect_due_categories",
            return_value=["logs", "runtime_metrics"],
        ),
        patch("app.retention.scheduler.run_cleanup", side_effect=_count_cleanup),
    ):
        sched.trigger_once()

    assert n["cleanup"] == 1


def test_running_backfill_job_coexists_with_scheduler_tick(db_session: Session, monkeypatch: pytest.MonkeyPatch):
    """Retention scheduler tick does not require stream rows; backfill RUNNING guard stays in service layer."""

    monkeypatch.setattr(settings, "GDC_OPERATIONAL_RETENTION_SUPPLEMENT_ENABLED", True)
    stream = db_session.query(Stream).first()
    if stream is None:
        pytest.skip("no stream in minimal fixture")

    job = BackfillJob(
        stream_id=stream.id,
        source_type="HTTP_API_POLLING",
        status="RUNNING",
        backfill_mode="INITIAL_FILL",
        requested_by="t",
        created_at=datetime.now(UTC) - timedelta(days=1),
        source_config_snapshot_json={},
        checkpoint_snapshot_json={},
        runtime_options_json={},
        progress_json={},
    )
    db_session.add(job)
    row = get_retention_policy_row(db_session)
    row.cleanup_scheduler_enabled = True
    row.operational_retention_meta = {}
    db_session.commit()

    sched = OperationalRetentionScheduler(tick_seconds=60.0)
    with (
        patch("app.retention.scheduler.collect_due_categories", return_value=[]),
        patch("app.retention.scheduler.supplement_due", return_value=True),
    ):
        sched.trigger_once()

    db_session.refresh(job)
    assert job.status == "RUNNING"
