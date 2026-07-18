"""Tests for lab cleanup recoverability assessment and partition SQL dry-run."""

from __future__ import annotations

from datetime import timezone

import pytest

from app.config import settings
from app.dev_validation_lab import lab_auto_remediation as ar
from app.dev_validation_lab import lab_cleanup_recoverability as rc
from app.dev_validation_lab import lab_resource_guardrail as gr
from app.dev_validation_lab.lab_cleanup_cli import main as cleanup_cli_main


UTC = timezone.utc


def _cand(
    name: str,
    *,
    safe: bool,
    rows: int = 1_000_000,
    size: int = 500_000_000,
    reason: str = "fully_older_than_retention_cutoff_safe_drop_candidate",
    month_start: str = "2026-05-01",
    month_end: str = "2026-06-01",
) -> dict:
    return {
        "partition_name": name,
        "estimated_rows": rows,
        "estimated_size_bytes": size,
        "min_created_at": "2026-05-01T00:00:00+00:00",
        "max_created_at": "2026-05-31T23:59:59+00:00",
        "month_start": month_start,
        "month_end": month_end,
        "retention_cutoff": "2026-07-03T00:00:00+00:00",
        "safe_to_drop_candidate": safe,
        "reason": reason if safe else "current_or_next_month_protected",
    }


def test_recoverable_by_auto_cleanup_single_cycle() -> None:
    result = rc.assess_lab_cleanup_recoverability(
        budget={
            "exceeded_reasons": ["delivery_logs_rows>500000"],
            "limits": {"max_delivery_log_rows": 500_000, "max_delivery_log_size_bytes": 2_147_483_648},
            "delivery_logs_rows": 550_000,
            "delivery_logs_estimated_size": 100_000_000,
        },
        delivery_logs_eligible_rows=80_000,
        max_rows_per_run=100_000,
        partition_candidates=[],
    )
    assert result["recoverability_status"] == rc.RECOVERABLE_BY_AUTO_CLEANUP
    assert result["auto_cleanup_cycles_estimated"] == 1
    assert "Wait for next cleanup cycle" in result["recommended_action"]


def test_needs_multiple_auto_cleanup_cycles() -> None:
    result = rc.assess_lab_cleanup_recoverability(
        budget={
            "exceeded_reasons": ["delivery_logs_rows>500000"],
            "limits": {"max_delivery_log_rows": 500_000, "max_delivery_log_size_bytes": 2_147_483_648},
            "delivery_logs_rows": 2_000_000,
            "delivery_logs_estimated_size": 100_000_000,
        },
        delivery_logs_eligible_rows=1_600_000,
        max_rows_per_run=100_000,
        partition_candidates=[],
    )
    assert result["recoverability_status"] == rc.NEEDS_MULTIPLE_AUTO_CLEANUP_CYCLES
    assert result["auto_cleanup_cycles_estimated"] == 16
    assert "Increase GDC_LAB_AUTO_CLEANUP_MAX_ROWS_PER_RUN" in result["recommended_action"]


def test_destructive_cleanup_recommended_with_old_partitions() -> None:
    result = rc.assess_lab_cleanup_recoverability(
        budget={
            "exceeded_reasons": ["delivery_logs_size>2147483648"],
            "limits": {"max_delivery_log_rows": 500_000, "max_delivery_log_size_bytes": 2_147_483_648},
            "delivery_logs_rows": 400_000,
            "delivery_logs_estimated_size": 5_000_000_000,
        },
        delivery_logs_eligible_rows=50_000,
        max_rows_per_run=100_000,
        partition_candidates=[_cand("delivery_logs_2026_05", safe=True, size=3_000_000_000)],
        remediation_still_exceeded=False,
    )
    assert result["recoverability_status"] == rc.DESTRUCTIVE_CLEANUP_RECOMMENDED
    assert result["destructive_cleanup_recommended"] is True
    assert "Manual partition DROP is recommended" in result["recommended_action"]


def test_destructive_cleanup_required_when_still_exceeded() -> None:
    result = rc.assess_lab_cleanup_recoverability(
        budget={
            "exceeded_reasons": ["delivery_logs_rows>500000", "delivery_logs_size>2147483648"],
            "limits": {"max_delivery_log_rows": 500_000, "max_delivery_log_size_bytes": 2_147_483_648},
            "delivery_logs_rows": 10_000_000,
            "delivery_logs_estimated_size": 20_000_000_000,
        },
        delivery_logs_eligible_rows=100_000,
        max_rows_per_run=100_000,
        partition_candidates=[
            _cand("delivery_logs_2026_05", safe=True, rows=2_000_000, size=8_000_000_000),
            _cand("delivery_logs_2026_06", safe=True, rows=8_000_000, size=10_000_000_000),
        ],
        remediation_still_exceeded=True,
        remediation_errors=[],
    )
    assert result["recoverability_status"] == rc.DESTRUCTIVE_CLEANUP_REQUIRED
    assert result["destructive_cleanup_required"] is True
    assert "Automatic cleanup cannot safely recover this state." in result["recommended_action"]
    assert "Manual review is required" in result["recommended_action"]


def test_pause_policy_recommended_false() -> None:
    pause, reason = rc.should_pause_lab_for_recoverability(rc.DESTRUCTIVE_CLEANUP_RECOMMENDED)
    assert pause is False
    assert reason is None


def test_pause_policy_required_true() -> None:
    pause, reason = rc.should_pause_lab_for_recoverability(rc.DESTRUCTIVE_CLEANUP_REQUIRED)
    assert pause is True
    assert reason == "destructive_cleanup_required"


def test_pause_policy_multi_cycle_false() -> None:
    pause, reason = rc.should_pause_lab_for_recoverability(rc.NEEDS_MULTIPLE_AUTO_CLEANUP_CYCLES)
    assert pause is False
    assert reason is None


def test_pause_policy_cleanup_failed_true() -> None:
    pause, reason = rc.should_pause_lab_for_recoverability(
        rc.DESTRUCTIVE_CLEANUP_RECOMMENDED,
        remediation_errors=["delivery_logs: boom"],
    )
    assert pause is True
    assert reason == "cleanup_failed"


def test_current_month_partition_not_safe() -> None:
    cands = [
        _cand("delivery_logs_2026_07", safe=False, reason="current_or_next_month_protected"),
        _cand("delivery_logs_2026_05", safe=True),
    ]
    sqls = rc.build_partition_drop_sql(cands)
    joined = "\n".join(sqls)
    assert 'DROP TABLE IF EXISTS "delivery_logs_2026_05";' in joined
    assert "delivery_logs_2026_07" not in joined
    assert cands[0]["safe_to_drop_candidate"] is False
    assert cands[1]["safe_to_drop_candidate"] is True


def test_only_retention_outside_partitions_are_safe() -> None:
    cands = [
        {
            "partition_name": "delivery_logs_2026_06",
            "safe_to_drop_candidate": False,
            "reason": "partition_may_contain_rows_newer_than_retention_cutoff",
            "estimated_rows": 100,
        },
        _cand("delivery_logs_2026_04", safe=True, rows=50, month_start="2026-04-01", month_end="2026-05-01"),
    ]
    sqls = rc.build_partition_drop_sql(cands)
    assert len(sqls) == 1
    assert "-- Candidate: delivery_logs_2026_04" in sqls[0]
    assert 'DROP TABLE IF EXISTS "delivery_logs_2026_04";' in sqls[0]
    assert "delivery_logs_2026_06" not in sqls[0]


def test_partition_drop_sql_includes_comments() -> None:
    sqls = rc.build_partition_drop_sql(
        [_cand("delivery_logs_2026_05", safe=True, rows=1_200_000, size=1_900_000_000)]
    )
    assert len(sqls) == 1
    block = sqls[0]
    assert "-- Candidate: delivery_logs_2026_05" in block
    assert "-- Estimated size:" in block
    assert "-- Estimated rows: 1200000" in block
    assert "-- Date range: 2026-05-01 ~ 2026-05-31" in block
    assert "-- Reason: partition is fully outside retention cutoff" in block
    assert 'DROP TABLE IF EXISTS "delivery_logs_2026_05";' in block


def test_show_partition_drop_sql_prints_only(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(settings, "ENABLE_DEV_VALIDATION_LAB", True, raising=False)
    monkeypatch.setattr(settings, "APP_ENV", "development", raising=False)
    monkeypatch.setattr(settings, "DATABASE_URL", "postgresql://gdc:gdc@postgres:5432/gdc_platform", raising=False)

    class _FakeSession:
        def close(self) -> None:
            return None

    monkeypatch.setattr(
        "app.database.SessionLocal",
        lambda: _FakeSession(),
    )
    monkeypatch.setattr(
        "app.dev_validation_lab.lab_cleanup_recoverability.enrich_partition_drop_candidates",
        lambda *_a, **_k: [
            _cand("delivery_logs_2026_05", safe=True),
            _cand("delivery_logs_2026_07", safe=False),
        ],
    )
    drop_calls: list[str] = []

    def _forbid_drop(*_a, **_k):  # pragma: no cover
        drop_calls.append("drop")
        raise AssertionError("DROP must not execute")

    monkeypatch.setattr(
        "app.db.delivery_log_partitions.drop_delivery_log_partitions",
        _forbid_drop,
        raising=False,
    )
    rc_code = cleanup_cli_main(["--show-partition-drop-sql"])
    assert rc_code == 0
    out = capsys.readouterr().out
    assert "Database target:" in out
    assert "host: postgres" in out
    assert "database: gdc_platform" in out
    assert "user: gdc" in out
    assert "mode: development" in out
    assert "lab_effective: true" in out
    assert "DRY RUN ONLY." in out
    assert "This command does not execute DROP." in out
    assert "Review the target database before manually executing SQL." in out
    assert "-- Candidate: delivery_logs_2026_05" in out
    assert 'DROP TABLE IF EXISTS "delivery_logs_2026_05";' in out
    assert 'DROP TABLE IF EXISTS "delivery_logs_2026_07"' not in out
    assert "not executed" in out.lower() or "BEGIN manual review SQL" in out
    assert drop_calls == []


def test_show_partition_drop_sql_excludes_unsafe(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(settings, "ENABLE_DEV_VALIDATION_LAB", True, raising=False)
    monkeypatch.setattr(settings, "APP_ENV", "development", raising=False)
    monkeypatch.setattr(settings, "DATABASE_URL", "postgresql://gdc:gdc@postgres:5432/gdc", raising=False)

    class _FakeSession:
        def close(self) -> None:
            return None

    monkeypatch.setattr("app.database.SessionLocal", lambda: _FakeSession())
    monkeypatch.setattr(
        "app.dev_validation_lab.lab_cleanup_recoverability.enrich_partition_drop_candidates",
        lambda *_a, **_k: [
            _cand("delivery_logs_2026_07", safe=False),
            _cand(
                "delivery_logs_2026_06",
                safe=False,
                reason="partition_may_contain_rows_newer_than_retention_cutoff",
            ),
        ],
    )
    assert cleanup_cli_main(["--show-partition-drop-sql"]) == 0
    out = capsys.readouterr().out
    assert "No safe_to_drop_candidate partitions." in out
    assert "DROP TABLE IF EXISTS" not in out


def test_production_mode_no_auto_destructive(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ENABLE_DEV_VALIDATION_LAB", False, raising=False)
    monkeypatch.setattr(settings, "APP_ENV", "production", raising=False)
    from app.dev_validation_lab.lab_auto_remediation import lab_auto_remediation_enabled

    assert lab_auto_remediation_enabled() is False
    result = rc.assess_lab_cleanup_recoverability(
        budget={"exceeded_reasons": ["delivery_logs_size>1"], "delivery_logs_estimated_size": 9},
        partition_candidates=[_cand("delivery_logs_2026_05", safe=True)],
        remediation_still_exceeded=True,
    )
    assert result["destructive_cleanup_required"] is True
    assert "Manual" in result["recommended_action"]


@pytest.fixture
def lab_on(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "ENABLE_DEV_VALIDATION_LAB", True, raising=False)
    monkeypatch.setattr(settings, "APP_ENV", "development", raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_RESOURCE_GUARDRAIL_ENABLED", True, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_PAUSE_ON_BUDGET_EXCEEDED", True, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_AUTO_REMEDIATION_ENABLED", True, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_AUTO_CLEANUP_ON_BUDGET_EXCEEDED", True, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_AUTO_WIREMOCK_RESET", True, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_AUTO_CLEANUP_COOLDOWN_SECONDS", 0, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_AUTO_CLEANUP_MAX_ROWS_PER_RUN", 100_000, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_MAX_DELIVERY_LOG_ROWS", 500_000, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_MAX_DELIVERY_LOG_SIZE_BYTES", 2_147_483_648, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_MAX_ALERT_HISTORY_ROWS", 100_000, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_MAX_REPLAY_EVENT_ROWS", 100_000, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_MAX_WIREMOCK_JOURNAL_ENTRIES", 500, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_MAX_RECENT_EPS", 20.0, raising=False)
    monkeypatch.setattr(settings, "GDC_LAB_MAX_ROWS_PER_10M", 12_000, raising=False)
    gr.clear_lab_pause_state_for_tests()
    ar.clear_auto_remediation_state_for_tests()
    yield
    gr.clear_lab_pause_state_for_tests()
    ar.clear_auto_remediation_state_for_tests()


def test_recommended_does_not_pause_lab(lab_on) -> None:
    def hook(_db, budget):
        return {
            "attempted": True,
            "skipped": False,
            "reason": None,
            "status": "insufficient",
            "recovered_budget": False,
            "should_pause_lab": False,
            "pause_reason": None,
            "deleted_rows": 1000,
            "wiremock_reset": {"attempted": False, "ok": None},
            "cleanup": {"partition_drop_performed": False},
            "destructive_cleanup_required": False,
            "destructive_cleanup_recommended": True,
            "recoverability_status": "destructive_cleanup_recommended",
            "recommended_action": "Manual partition DROP is recommended, but lab generation is not paused.",
            "partition_drop_candidates": [_cand("delivery_logs_2026_05", safe=True)],
            "errors": [],
            "auto_cleanup_last_run_at": "2026-07-10T00:00:00+00:00",
            "auto_cleanup_cooldown_until": "2026-07-10T00:05:00+00:00",
            "budget_after": {
                "status": "exceeded",
                "exceeded_reasons": ["delivery_logs_size>2147483648"],
            },
        }

    result = gr.check_lab_resource_budget(
        metrics_override={
            "delivery_logs_rows": 400_000,
            "delivery_logs_rows_last_10m": 100,
            "delivery_logs_estimated_size": 5_000_000_000,
            "recent_eps": 0.2,
            "alert_history_rows": 10,
            "replay_event_rows": 10,
            "wiremock_journal_entries": 10,
            "scheduler_streams_in_backoff": 0,
        },
        run_remediation=True,
        remediation_hook=hook,
    )
    assert result["recoverability_status"] == "destructive_cleanup_recommended"
    assert result["should_pause_lab"] is False
    assert result["lab_paused"] is False
    assert result["destructive_cleanup_required"] is False
    assert result["destructive_cleanup_recommended"] is True


def test_required_pauses_lab(lab_on) -> None:
    def hook(_db, budget):
        return {
            "attempted": True,
            "skipped": False,
            "reason": None,
            "status": "insufficient",
            "recovered_budget": False,
            "should_pause_lab": True,
            "pause_reason": "destructive_cleanup_required",
            "deleted_rows": 1000,
            "wiremock_reset": {"attempted": False, "ok": None},
            "cleanup": {"partition_drop_performed": False},
            "destructive_cleanup_required": True,
            "destructive_cleanup_recommended": True,
            "recoverability_status": "destructive_cleanup_required",
            "recommended_action": "Automatic cleanup cannot safely recover this state. Lab generation is paused.",
            "partition_drop_candidates": [_cand("delivery_logs_2026_05", safe=True)],
            "errors": [],
            "auto_cleanup_last_run_at": "2026-07-10T00:00:00+00:00",
            "auto_cleanup_cooldown_until": "2026-07-10T00:05:00+00:00",
            "budget_after": {
                "status": "exceeded",
                "exceeded_reasons": ["delivery_logs_rows>500000"],
            },
        }

    result = gr.check_lab_resource_budget(
        metrics_override={
            "delivery_logs_rows": 10_000_000,
            "delivery_logs_rows_last_10m": 100,
            "delivery_logs_estimated_size": 20_000_000_000,
            "recent_eps": 0.2,
            "alert_history_rows": 10,
            "replay_event_rows": 10,
            "wiremock_journal_entries": 10,
            "scheduler_streams_in_backoff": 0,
        },
        run_remediation=True,
        remediation_hook=hook,
    )
    assert result["recoverability_status"] == "destructive_cleanup_required"
    assert result["should_pause_lab"] is True
    assert result["lab_paused"] is True
    assert result["lab_pause_reason"] == "destructive_cleanup_required"


def test_multi_cycle_auto_remediation_does_not_pause(lab_on, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        ar,
        "_delete_retention_rows",
        lambda *_a, **_k: {
            "status": "ok",
            "deleted_rows": 100_000,
            "outcomes": [{"table": "delivery_logs", "matched_count": 1_600_000, "deleted_count": 100_000}],
            "errors": [],
            "partition_drop_candidates": [],
            "partition_drop_performed": False,
        },
    )
    monkeypatch.setattr(
        ar,
        "_reset_wiremock_if_needed",
        lambda *_a, **_k: {"attempted": False, "ok": None},
    )
    rem = ar.run_lab_auto_remediation(
        None,
        {
            "status": "exceeded",
            "exceeded_reasons": ["delivery_logs_rows>500000"],
            "delivery_logs_rows": 2_000_000,
            "delivery_logs_estimated_size": 100_000_000,
            "limits": {
                "max_delivery_log_rows": 500_000,
                "max_delivery_log_size_bytes": 2_147_483_648,
            },
        },
        force=True,
        reevaluate=lambda _db=None, **_kw: {
            "status": "exceeded",
            "exceeded_reasons": ["delivery_logs_rows>500000"],
            "delivery_logs_rows": 1_900_000,
            "delivery_logs_estimated_size": 100_000_000,
            "limits": {
                "max_delivery_log_rows": 500_000,
                "max_delivery_log_size_bytes": 2_147_483_648,
            },
        },
    )
    assert rem["recoverability_status"] == rc.NEEDS_MULTIPLE_AUTO_CLEANUP_CYCLES
    assert rem["should_pause_lab"] is False
    assert rem["pause_reason"] is None


def test_recommended_auto_remediation_does_not_pause_or_escalate(
    lab_on, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Size pressure with safe partitions while still exceeded must not escalate recommended→required pause.

    When assess returns destructive_cleanup_recommended (remediation_still_exceeded=False path is
    not used here). For still-exceeded size with safe partitions, assess returns REQUIRED.
    This test covers the advisory recommended path via assess helper + pause policy, and
    ensures auto remediation does not set pause when recoverability is recommended-only.
    """

    # Direct policy: recommended never pauses.
    pause, reason = rc.should_pause_lab_for_recoverability(rc.DESTRUCTIVE_CLEANUP_RECOMMENDED)
    assert pause is False and reason is None

    # Simulate remediation result that stays recommended (not required).
    monkeypatch.setattr(
        ar,
        "_delete_retention_rows",
        lambda *_a, **_k: {
            "status": "ok",
            "deleted_rows": 1000,
            "outcomes": [{"table": "delivery_logs", "matched_count": 50_000, "deleted_count": 1000}],
            "errors": [],
            "partition_drop_candidates": [
                _cand("delivery_logs_2026_05", safe=True, size=3_000_000_000),
            ],
            "partition_drop_performed": False,
        },
    )
    monkeypatch.setattr(
        ar,
        "_reset_wiremock_if_needed",
        lambda *_a, **_k: {"attempted": False, "ok": None},
    )

    # Force assess to recommended by reevaluating as not exceeded on hard caps after cleanup,
    # while still providing size-over budget input for candidate guidance via partition list.
    # Actually: if not still_exceeded, recovered=True. To get recommended without pause while
    # still_exceeded, we need assess to return recommended — which only happens when
    # remediation_still_exceeded=False. So use a custom assess path by patching.
    def fake_assess(**kwargs):
        return {
            "recoverability_status": rc.DESTRUCTIVE_CLEANUP_RECOMMENDED,
            "auto_cleanup_cycles_estimated": 1,
            "destructive_cleanup_required": False,
            "destructive_cleanup_recommended": True,
            "recommended_action": "Manual partition DROP is recommended for old delivery_logs partitions.",
            "partition_drop_candidates": kwargs.get("partition_candidates") or [],
        }

    monkeypatch.setattr(ar, "assess_lab_cleanup_recoverability", fake_assess, raising=False)
    monkeypatch.setattr(
        "app.dev_validation_lab.lab_cleanup_recoverability.assess_lab_cleanup_recoverability",
        fake_assess,
    )

    rem = ar.run_lab_auto_remediation(
        None,
        {
            "status": "exceeded",
            "exceeded_reasons": ["delivery_logs_size>2147483648"],
            "delivery_logs_rows": 400_000,
            "delivery_logs_estimated_size": 5_000_000_000,
            "limits": {
                "max_delivery_log_rows": 500_000,
                "max_delivery_log_size_bytes": 2_147_483_648,
            },
        },
        force=True,
        reevaluate=lambda _db=None, **_kw: {
            "status": "exceeded",
            "exceeded_reasons": ["delivery_logs_size>2147483648"],
            "delivery_logs_rows": 400_000,
            "delivery_logs_estimated_size": 5_000_000_000,
            "limits": {
                "max_delivery_log_rows": 500_000,
                "max_delivery_log_size_bytes": 2_147_483_648,
            },
        },
    )
    assert rem["recoverability_status"] == rc.DESTRUCTIVE_CLEANUP_RECOMMENDED
    assert rem["should_pause_lab"] is False
    assert rem["pause_reason"] is None
    assert rem["destructive_cleanup_required"] is False
    assert rem["destructive_cleanup_recommended"] is True
