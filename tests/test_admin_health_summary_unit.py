"""Unit checks for admin health summary builder (no DB fixture)."""

from __future__ import annotations

from unittest.mock import MagicMock

from app.platform_admin.health_summary import build_admin_health_summary


def test_build_admin_health_summary_import_and_shape() -> None:
    """Regression: router must import this symbol; builder returns metrics envelope."""

    db = MagicMock()
    db.execute.return_value = None
    db.scalar.side_effect = [50.0, 0, 10, 2, None]

    raw = build_admin_health_summary(db)

    assert raw["metrics_window_seconds"] == 3600
    assert isinstance(raw["metrics"], list)
    assert len(raw["metrics"]) >= 1
    keys = {m["key"] for m in raw["metrics"]}
    assert "db_latency_ms" in keys
    assert "failure_rate_1h" in keys
