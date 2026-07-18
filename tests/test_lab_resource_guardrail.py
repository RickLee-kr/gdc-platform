"""Unit tests for lab resource budget / pause guardrail."""

from __future__ import annotations

import pytest

from app.config import settings
from app.dev_validation_lab import lab_resource_guardrail as gr


@pytest.fixture(autouse=True)
def _reset_pause_state() -> None:
    gr.clear_lab_pause_state_for_tests()
    yield
    gr.clear_lab_pause_state_for_tests()


@pytest.fixture
def lab_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ENABLE_DEV_VALIDATION_LAB", True, raising=False)
    monkeypatch.setattr(settings, "APP_ENV", "development", raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_RESOURCE_GUARDRAIL_ENABLED", True, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_PAUSE_ON_BUDGET_EXCEEDED", True, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_MAX_DELIVERY_LOG_ROWS", 500_000, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_MAX_DELIVERY_LOG_SIZE_BYTES", 2_147_483_648, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_MAX_ALERT_HISTORY_ROWS", 100_000, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_MAX_REPLAY_EVENT_ROWS", 100_000, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_MAX_WIREMOCK_JOURNAL_ENTRIES", 500, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_MAX_RECENT_EPS", 20.0, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_MAX_ROWS_PER_10M", 12_000, raising=False)


def _metrics(**overrides: object) -> dict:
    base = {
        "delivery_logs_rows": 1000,
        "delivery_logs_rows_last_10m": 100,
        "delivery_logs_estimated_size": 1_000_000,
        "recent_eps": 0.2,
        "alert_history_rows": 10,
        "replay_event_rows": 10,
        "wiremock_journal_entries": 10,
        "scheduler_streams_in_backoff": 0,
    }
    base.update(overrides)
    return base


def test_budget_ok_within_limits(lab_on: None) -> None:
    result = gr.evaluate_lab_resource_budget(metrics_override=_metrics())
    assert result["resource_guardrail_enabled"] is True
    assert result["status"] == "ok"
    assert result["should_pause_lab"] is False
    assert result["exceeded_reasons"] == []


def test_delivery_log_rows_exceeded(lab_on: None) -> None:
    result = gr.check_lab_resource_budget(
        metrics_override=_metrics(delivery_logs_rows=500_001),
    )
    assert result["status"] == "exceeded"
    assert result["should_pause_lab"] is True
    assert any("delivery_logs_rows>" in r for r in result["exceeded_reasons"])
    assert result["lab_paused"] is True


def test_delivery_log_size_exceeded(lab_on: None) -> None:
    result = gr.check_lab_resource_budget(
        metrics_override=_metrics(delivery_logs_estimated_size=2_147_483_649),
    )
    assert result["status"] == "exceeded"
    assert result["should_pause_lab"] is True
    assert any("delivery_logs_size>" in r for r in result["exceeded_reasons"])


def test_recent_eps_exceeded_pauses(lab_on: None) -> None:
    result = gr.check_lab_resource_budget(
        metrics_override=_metrics(recent_eps=20.1, delivery_logs_rows_last_10m=12_060),
    )
    assert result["should_pause_lab"] is True
    assert any("recent_eps>" in r for r in result["exceeded_reasons"])


def test_rows_last_10m_exceeded_pauses(lab_on: None) -> None:
    result = gr.check_lab_resource_budget(
        metrics_override=_metrics(delivery_logs_rows_last_10m=12_001, recent_eps=20.0017),
    )
    assert result["should_pause_lab"] is True
    assert any("delivery_logs_rows_last_10m>" in r for r in result["exceeded_reasons"])


def test_alert_history_exceeded_pauses(lab_on: None) -> None:
    result = gr.check_lab_resource_budget(
        metrics_override=_metrics(alert_history_rows=100_001),
    )
    assert result["should_pause_lab"] is True
    assert any("alert_history_rows>" in r for r in result["exceeded_reasons"])


def test_replay_events_exceeded_pauses(lab_on: None) -> None:
    result = gr.check_lab_resource_budget(
        metrics_override=_metrics(replay_event_rows=100_001),
    )
    assert result["should_pause_lab"] is True
    assert any("replay_event_rows>" in r for r in result["exceeded_reasons"])


def test_cleanup_then_resume(lab_on: None) -> None:
    paused = gr.check_lab_resource_budget(
        metrics_override=_metrics(delivery_logs_rows=600_000),
    )
    assert paused["lab_paused"] is True
    assert gr.lab_pause_snapshot()["lab_paused"] is True
    should_pause, reason = gr.lab_generation_should_pause(force=False)
    assert should_pause is True
    assert reason

    resumed = gr.check_lab_resource_budget(
        metrics_override=_metrics(delivery_logs_rows=1000),
        force=True,
    )
    assert resumed["status"] == "ok"
    assert resumed["should_pause_lab"] is False
    assert resumed["lab_paused"] is False
    assert gr.lab_pause_snapshot()["lab_paused"] is False
    # Use cached override result only (do not force a live DB probe in unit tests).
    assert gr.lab_generation_should_pause(force=False)[0] is False
    assert gr.lab_pause_snapshot()["lab_pause_reason"] is None


def test_production_mode_guardrail_inactive(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ENABLE_DEV_VALIDATION_LAB", False, raising=False)
    monkeypatch.setattr(settings, "APP_ENV", "production", raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_RESOURCE_GUARDRAIL_ENABLED", True, raising=False)
    assert gr.lab_resource_guardrail_enabled() is False
    result = gr.evaluate_lab_resource_budget(metrics_override=_metrics(delivery_logs_rows=9_999_999))
    assert result["resource_guardrail_enabled"] is False
    assert result["should_pause_lab"] is False
    assert result["recommended_action"] == "guardrail_disabled"


def test_lab_mode_guardrail_default_active(lab_on: None) -> None:
    assert gr.lab_resource_guardrail_enabled() is True
    limits = gr.lab_resource_budget_limits()
    assert limits["enabled"] is True
    assert limits["max_delivery_log_rows"] == 500_000
    assert limits["pause_on_budget_exceeded"] is True


def test_pause_disabled_reports_exceeded_without_pause(lab_on: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "GDC_LAB_PAUSE_ON_BUDGET_EXCEEDED", False, raising=False)
    result = gr.check_lab_resource_budget(
        metrics_override=_metrics(delivery_logs_rows=600_000),
    )
    assert result["status"] == "exceeded"
    assert result["should_pause_lab"] is False
    assert result["lab_paused"] is False
