"""Unit tests for lab auto remediation (safe cleanup before pause)."""

from __future__ import annotations

from typing import Any

import pytest

from app.config import settings
from app.dev_validation_lab import lab_auto_remediation as ar
from app.dev_validation_lab import lab_resource_guardrail as gr
from app.dev_validation_lab.runtime_gates import is_lab_fixture_stream


@pytest.fixture(autouse=True)
def _reset_state() -> None:
    gr.clear_lab_pause_state_for_tests()
    ar.clear_auto_remediation_state_for_tests()
    yield
    gr.clear_lab_pause_state_for_tests()
    ar.clear_auto_remediation_state_for_tests()


@pytest.fixture
def lab_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ENABLE_DEV_VALIDATION_LAB", True, raising=False)
    monkeypatch.setattr(settings, "APP_ENV", "development", raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_RESOURCE_GUARDRAIL_ENABLED", True, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_PAUSE_ON_BUDGET_EXCEEDED", True, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_AUTO_REMEDIATION_ENABLED", True, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_AUTO_CLEANUP_ON_BUDGET_EXCEEDED", True, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_AUTO_WIREMOCK_RESET", True, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_AUTO_CLEANUP_COOLDOWN_SECONDS", 300, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_AUTO_CLEANUP_MAX_ROWS_PER_RUN", 100_000, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_MAX_DELIVERY_LOG_ROWS", 500_000, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_MAX_DELIVERY_LOG_SIZE_BYTES", 2_147_483_648, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_MAX_ALERT_HISTORY_ROWS", 100_000, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_MAX_REPLAY_EVENT_ROWS", 100_000, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_MAX_WIREMOCK_JOURNAL_ENTRIES", 500, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_MAX_RECENT_EPS", 20.0, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_MAX_ROWS_PER_10M", 12_000, raising=False)


def _metrics(**overrides: object) -> dict[str, Any]:
    base: dict[str, Any] = {
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


def _recovering_hook(_db: Any, budget: dict[str, Any]) -> dict[str, Any]:
    return {
        "attempted": True,
        "skipped": False,
        "reason": None,
        "status": "ok",
        "recovered_budget": True,
        "should_pause_lab": False,
        "pause_reason": None,
        "deleted_rows": 42_000,
        "wiremock_reset": {"attempted": False, "ok": None},
        "cleanup": {"partition_drop_performed": False, "partition_drop_candidates": []},
        "destructive_cleanup_required": False,
        "partition_drop_candidates": [],
        "errors": [],
        "auto_cleanup_last_run_at": "2026-07-10T00:00:00+00:00",
        "auto_cleanup_cooldown_until": "2026-07-10T00:05:00+00:00",
        "budget_after": {"status": "ok", "exceeded_reasons": []},
    }


def _failing_hook(_db: Any, budget: dict[str, Any]) -> dict[str, Any]:
    return {
        "attempted": True,
        "skipped": False,
        "reason": None,
        "status": "error",
        "recovered_budget": False,
        "should_pause_lab": True,
        "pause_reason": "cleanup_failed",
        "deleted_rows": 0,
        "wiremock_reset": {"attempted": False, "ok": None},
        "cleanup": {"partition_drop_performed": False},
        "destructive_cleanup_required": False,
        "partition_drop_candidates": [],
        "errors": ["delivery_logs: boom"],
        "auto_cleanup_last_run_at": "2026-07-10T00:00:00+00:00",
        "auto_cleanup_cooldown_until": "2026-07-10T00:05:00+00:00",
        "budget_after": {
            "status": "exceeded",
            "exceeded_reasons": ["delivery_logs_rows>500000"],
        },
    }


def test_lab_budget_exceeded_runs_auto_cleanup(lab_on: None) -> None:
    calls: list[dict[str, Any]] = []

    def hook(db: Any, budget: dict[str, Any]) -> dict[str, Any]:
        calls.append(dict(budget))
        return _recovering_hook(db, budget)

    result = gr.check_lab_resource_budget(
        metrics_override=_metrics(delivery_logs_rows=600_000),
        run_remediation=True,
        remediation_hook=hook,
    )
    assert len(calls) == 1
    assert calls[0]["status"] == "exceeded"
    assert result["auto_cleanup_recovered_budget"] is True
    assert result["auto_cleanup_deleted_rows"] == 42_000


def test_auto_cleanup_success_keeps_should_pause_false(lab_on: None) -> None:
    result = gr.check_lab_resource_budget(
        metrics_override=_metrics(delivery_logs_rows=600_000),
        run_remediation=True,
        remediation_hook=_recovering_hook,
    )
    assert result["should_pause_lab"] is False
    assert result["lab_paused"] is False
    assert result["status"] == "ok"


def test_auto_cleanup_failure_sets_should_pause_true(lab_on: None) -> None:
    result = gr.check_lab_resource_budget(
        metrics_override=_metrics(delivery_logs_rows=600_000),
        run_remediation=True,
        remediation_hook=_failing_hook,
    )
    assert result["should_pause_lab"] is True
    assert result["lab_paused"] is True
    assert result["lab_pause_reason"] == "cleanup_failed"


def test_production_mode_skips_auto_cleanup(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ENABLE_DEV_VALIDATION_LAB", False, raising=False)
    monkeypatch.setattr(settings, "APP_ENV", "production", raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_AUTO_REMEDIATION_ENABLED", True, raising=False)
    assert ar.lab_auto_remediation_enabled() is False
    calls: list[int] = []

    def hook(db: Any, budget: dict[str, Any]) -> dict[str, Any]:
        calls.append(1)
        return _recovering_hook(db, budget)

    result = gr.check_lab_resource_budget(
        metrics_override=_metrics(delivery_logs_rows=9_999_999),
        run_remediation=True,
        remediation_hook=hook,
    )
    assert calls == []
    assert result["resource_guardrail_enabled"] is False
    assert result["should_pause_lab"] is False


def test_partition_drop_candidates_not_auto_executed(lab_on: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "GDC_LAB_AUTO_CLEANUP_COOLDOWN_SECONDS", 0, raising=False)

    def fake_delete(db: Any, *, max_rows_per_run: int, statement_timeout_ms: int) -> dict[str, Any]:
        return {
            "status": "ok",
            "deleted_rows": 1000,
            "outcomes": [],
            "errors": [],
            "partition_drop_candidates": [{"partition_name": "delivery_logs_2026_05", "rows": 1}],
            "partition_drop_performed": False,
            "max_rows_per_run": max_rows_per_run,
            "rows_budget_remaining": max_rows_per_run - 1000,
        }

    monkeypatch.setattr(ar, "_delete_retention_rows", fake_delete)
    monkeypatch.setattr(
        ar,
        "_reset_wiremock_if_needed",
        lambda budget, *, enabled: {"attempted": False, "ok": None},
    )

    budget = gr.evaluate_lab_resource_budget(
        metrics_override=_metrics(
            delivery_logs_rows=600_000,
            delivery_logs_estimated_size=3_000_000_000,
        )
    )
    rem = ar.run_lab_auto_remediation(
        None,
        budget,
        force=True,
        reevaluate=lambda _db=None, **_kw: gr.evaluate_lab_resource_budget(
            metrics_override=_metrics(
                delivery_logs_rows=600_000,
                delivery_logs_estimated_size=3_000_000_000,
            )
        ),
    )
    assert rem["cleanup"]["partition_drop_performed"] is False
    assert rem["partition_drop_candidates"]
    assert rem["destructive_cleanup_required"] is True
    assert rem["pause_reason"] == "destructive_cleanup_required"
    assert rem["should_pause_lab"] is True


def test_wiremock_journal_exceeded_calls_reset(lab_on: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "GDC_LAB_AUTO_CLEANUP_COOLDOWN_SECONDS", 0, raising=False)
    reset_calls: list[int] = []

    def fake_reset(budget: dict[str, Any], *, enabled: bool) -> dict[str, Any]:
        reset_calls.append(1)
        assert enabled is True
        return {"attempted": True, "ok": True, "before": 500, "after": 0}

    monkeypatch.setattr(ar, "_reset_wiremock_if_needed", fake_reset)
    monkeypatch.setattr(
        ar,
        "_delete_retention_rows",
        lambda *_a, **_k: {
            "status": "ok",
            "deleted_rows": 0,
            "outcomes": [],
            "errors": [],
            "partition_drop_candidates": [],
            "partition_drop_performed": False,
        },
    )
    budget = gr.evaluate_lab_resource_budget(
        metrics_override=_metrics(wiremock_journal_entries=500)
    )
    rem = ar.run_lab_auto_remediation(
        None,
        budget,
        force=True,
        reevaluate=lambda _db=None, **_kw: gr.evaluate_lab_resource_budget(
            metrics_override=_metrics(wiremock_journal_entries=0)
        ),
    )
    assert reset_calls == [1]
    assert rem["recovered_budget"] is True
    assert rem["should_pause_lab"] is False


def test_cleanup_cooldown_prevents_duplicate_runs(lab_on: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "GDC_LAB_AUTO_CLEANUP_COOLDOWN_SECONDS", 300, raising=False)
    runs: list[int] = []

    def fake_delete(*_a: Any, **_k: Any) -> dict[str, Any]:
        runs.append(1)
        return {
            "status": "ok",
            "deleted_rows": 10,
            "outcomes": [],
            "errors": [],
            "partition_drop_candidates": [],
            "partition_drop_performed": False,
        }

    monkeypatch.setattr(ar, "_delete_retention_rows", fake_delete)
    monkeypatch.setattr(
        ar,
        "_reset_wiremock_if_needed",
        lambda *_a, **_k: {"attempted": False, "ok": None},
    )
    budget = gr.evaluate_lab_resource_budget(metrics_override=_metrics(delivery_logs_rows=600_000))
    first = ar.run_lab_auto_remediation(
        None,
        budget,
        force=True,
        reevaluate=lambda _db=None, **_kw: gr.evaluate_lab_resource_budget(
            metrics_override=_metrics(delivery_logs_rows=1000)
        ),
    )
    second = ar.run_lab_auto_remediation(
        None,
        budget,
        force=False,
        reevaluate=lambda _db=None, **_kw: gr.evaluate_lab_resource_budget(
            metrics_override=_metrics(delivery_logs_rows=1000)
        ),
    )
    assert first["attempted"] is True
    assert second["skipped"] is True
    assert second["reason"] == "cooldown"
    assert runs == [1]


def test_max_rows_per_run_passed_to_delete(lab_on: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "GDC_LAB_AUTO_CLEANUP_MAX_ROWS_PER_RUN", 12_345, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_AUTO_CLEANUP_COOLDOWN_SECONDS", 0, raising=False)
    seen: dict[str, int] = {}

    def fake_delete(db: Any, *, max_rows_per_run: int, statement_timeout_ms: int) -> dict[str, Any]:
        seen["max_rows_per_run"] = max_rows_per_run
        seen["statement_timeout_ms"] = statement_timeout_ms
        return {
            "status": "ok",
            "deleted_rows": 0,
            "outcomes": [],
            "errors": [],
            "partition_drop_candidates": [],
            "partition_drop_performed": False,
        }

    monkeypatch.setattr(ar, "_delete_retention_rows", fake_delete)
    monkeypatch.setattr(
        ar,
        "_reset_wiremock_if_needed",
        lambda *_a, **_k: {"attempted": False, "ok": None},
    )
    budget = gr.evaluate_lab_resource_budget(metrics_override=_metrics(alert_history_rows=200_000))
    ar.run_lab_auto_remediation(
        None,
        budget,
        force=True,
        reevaluate=lambda _db=None, **_kw: gr.evaluate_lab_resource_budget(
            metrics_override=_metrics(alert_history_rows=10)
        ),
    )
    assert seen["max_rows_per_run"] == 12_345


def test_core_streams_not_lab_fixture() -> None:
    assert is_lab_fixture_stream("Customer Production Stream") is False
    assert is_lab_fixture_stream("[DEV VALIDATION] HTTP API Stream") is True
    assert is_lab_fixture_stream("[DEV E2E] S3 Object Stream") is True


def test_lab_e2e_generation_only_pauses(lab_on: None) -> None:
    """Pause gate applies to lab fixture streams; core names are not lab fixtures."""

    result = gr.check_lab_resource_budget(
        metrics_override=_metrics(delivery_logs_rows=600_000),
        run_remediation=True,
        remediation_hook=_failing_hook,
    )
    assert result["lab_paused"] is True
    assert is_lab_fixture_stream("[DEV E2E] HTTP API Stream") is True
    assert is_lab_fixture_stream("ops-core-stream") is False
