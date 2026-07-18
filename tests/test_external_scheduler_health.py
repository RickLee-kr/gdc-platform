"""Tests for external scheduler container health probing and maintenance branching."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.scheduler.external_container_health import (
    ExternalSchedulerHealth,
    probe_external_scheduler_container,
)
from app.platform_admin import maintenance_health as mh


def test_probe_external_scheduler_healthy(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.scheduler.external_container_health.shutil.which",
        lambda _name: "/usr/bin/docker",
    )

    class _Completed:
        returncode = 0
        stdout = '{"Running": true, "Health": {"Status": "healthy"}}'
        stderr = ""

    monkeypatch.setattr(
        "app.scheduler.external_container_health.subprocess.run",
        lambda *args, **kwargs: _Completed(),
    )
    result = probe_external_scheduler_container(container_name="gdc-platform-scheduler")
    assert result.probe_ok is True
    assert result.running is True
    assert result.health_status == "healthy"


def test_probe_external_scheduler_unhealthy(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.scheduler.external_container_health.shutil.which",
        lambda _name: "/usr/bin/docker",
    )

    class _Completed:
        returncode = 0
        stdout = '{"Running": true, "Health": {"Status": "unhealthy"}}'
        stderr = ""

    monkeypatch.setattr(
        "app.scheduler.external_container_health.subprocess.run",
        lambda *args, **kwargs: _Completed(),
    )
    result = probe_external_scheduler_container()
    assert result.health_status == "unhealthy"
    assert result.running is True


def test_probe_external_scheduler_unknown_without_docker(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.scheduler.external_container_health.shutil.which",
        lambda _name: None,
    )
    result = probe_external_scheduler_container()
    assert result.probe_ok is False
    assert result.health_status == "unknown"
    assert result.running is None


def test_maintenance_health_in_process_missing_supervisor_is_error(
    monkeypatch: pytest.MonkeyPatch, db_session
) -> None:
    monkeypatch.setattr(mh.settings, "GDC_ENABLE_IN_PROCESS_SCHEDULER", True, raising=False)
    monkeypatch.setattr(
        mh,
        "get_startup_snapshot",
        lambda: SimpleNamespace(
            scheduler_active=True,
            migration_integrity=None,
        ),
    )
    monkeypatch.setattr(mh.scheduler_runtime_state, "scheduler_uptime_seconds", lambda now=None: None)
    monkeypatch.setattr(mh.scheduler_runtime_state, "active_worker_count", lambda: 0)
    monkeypatch.setattr(mh.scheduler_runtime_state, "stream_backoff_summary", lambda: {})
    monkeypatch.setattr(mh, "evaluate_schema_with_engine", lambda _engine: (True, [], "head", None))
    monkeypatch.setattr(mh, "_alembic_script_heads", lambda: ("head",))
    monkeypatch.setattr(mh, "load_script_directory", lambda _root: MagicMock(get_heads=lambda: ["head"]))

    # Minimal stubs for later panels that touch DB / filesystem
    monkeypatch.setattr(mh, "get_retention_policy_row", lambda _db: None)
    monkeypatch.setattr(mh, "get_cleanup_scheduler", lambda: SimpleNamespace(is_running=lambda: False, last_tick_at=lambda: None))
    monkeypatch.setattr(mh, "effective_retention_policies", lambda _row: {})
    monkeypatch.setattr(mh, "fetch_destination_health_aggregates", lambda *a, **k: [])
    monkeypatch.setattr(mh, "fetch_destination_lookup", lambda *a, **k: {})
    monkeypatch.setattr(mh, "get_https_config_row", lambda _db: None)
    monkeypatch.setattr(mh, "probe_delivery_logs_indexes", lambda _conn: {"checked": False, "error": None})
    monkeypatch.setattr(mh, "probe_pg_stat_statements", lambda _conn: {"available": False})
    monkeypatch.setattr(mh, "fetch_pg_stat_statements_top", lambda *a, **k: [])
    monkeypatch.setattr(mh, "build_partition_observability", lambda *a, **k: {})
    monkeypatch.setattr(
        mh,
        "get_partition_maintenance_scheduler",
        lambda: SimpleNamespace(is_running=lambda: False),
    )

    body = mh.build_maintenance_health(db_session)
    assert body["panels"]["scheduler"]["mode"] == "in_process"
    assert body["panels"]["scheduler"]["status"] == "ERROR"
    assert any(item.get("code") == "STREAM_SCHEDULER_NOT_RUNNING" for item in body["error"])


def test_maintenance_health_external_healthy_skips_local_supervisor(
    monkeypatch: pytest.MonkeyPatch, db_session
) -> None:
    monkeypatch.setattr(mh.settings, "GDC_ENABLE_IN_PROCESS_SCHEDULER", False, raising=False)
    monkeypatch.setattr(
        mh,
        "get_startup_snapshot",
        lambda: SimpleNamespace(scheduler_active=True, migration_integrity=None),
    )
    monkeypatch.setattr(mh.scheduler_runtime_state, "scheduler_uptime_seconds", lambda now=None: None)
    monkeypatch.setattr(mh.scheduler_runtime_state, "active_worker_count", lambda: 0)
    monkeypatch.setattr(mh.scheduler_runtime_state, "stream_backoff_summary", lambda: {})
    monkeypatch.setattr(mh, "evaluate_schema_with_engine", lambda _engine: (True, [], "head", None))
    monkeypatch.setattr(mh, "_alembic_script_heads", lambda: ("head",))
    monkeypatch.setattr(
        "app.scheduler.external_container_health.probe_external_scheduler_container",
        lambda: ExternalSchedulerHealth(
            container_name="gdc-platform-scheduler",
            probe_ok=True,
            running=True,
            health_status="healthy",
        ),
    )
    monkeypatch.setattr(mh, "get_retention_policy_row", lambda _db: None)
    monkeypatch.setattr(mh, "get_cleanup_scheduler", lambda: SimpleNamespace(is_running=lambda: False, last_tick_at=lambda: None))
    monkeypatch.setattr(mh, "effective_retention_policies", lambda _row: {})
    monkeypatch.setattr(mh, "fetch_destination_health_aggregates", lambda *a, **k: [])
    monkeypatch.setattr(mh, "fetch_destination_lookup", lambda *a, **k: {})
    monkeypatch.setattr(mh, "get_https_config_row", lambda _db: None)
    monkeypatch.setattr(mh, "probe_delivery_logs_indexes", lambda _conn: {"checked": False, "error": None})
    monkeypatch.setattr(mh, "probe_pg_stat_statements", lambda _conn: {"available": False})
    monkeypatch.setattr(mh, "fetch_pg_stat_statements_top", lambda *a, **k: [])
    monkeypatch.setattr(mh, "build_partition_observability", lambda *a, **k: {})
    monkeypatch.setattr(
        mh,
        "get_partition_maintenance_scheduler",
        lambda: SimpleNamespace(is_running=lambda: False),
    )

    body = mh.build_maintenance_health(db_session)
    sched = body["panels"]["scheduler"]
    assert sched["mode"] == "external_container"
    assert sched["status"] == "OK"
    assert any(item.get("code") == "STREAM_SCHEDULER_EXTERNAL_HEALTHY" for item in body["ok"])
    assert not any(item.get("code") == "STREAM_SCHEDULER_NOT_RUNNING" for item in body["error"])


def test_maintenance_health_external_unknown_is_degraded(
    monkeypatch: pytest.MonkeyPatch, db_session
) -> None:
    monkeypatch.setattr(mh.settings, "GDC_ENABLE_IN_PROCESS_SCHEDULER", False, raising=False)
    monkeypatch.setattr(
        mh,
        "get_startup_snapshot",
        lambda: SimpleNamespace(scheduler_active=True, migration_integrity=None),
    )
    monkeypatch.setattr(mh.scheduler_runtime_state, "scheduler_uptime_seconds", lambda now=None: None)
    monkeypatch.setattr(mh.scheduler_runtime_state, "active_worker_count", lambda: 0)
    monkeypatch.setattr(mh.scheduler_runtime_state, "stream_backoff_summary", lambda: {})
    monkeypatch.setattr(mh, "evaluate_schema_with_engine", lambda _engine: (True, [], "head", None))
    monkeypatch.setattr(mh, "_alembic_script_heads", lambda: ("head",))
    monkeypatch.setattr(
        "app.scheduler.external_container_health.probe_external_scheduler_container",
        lambda: ExternalSchedulerHealth(
            container_name="gdc-platform-scheduler",
            probe_ok=False,
            running=None,
            health_status="unknown",
            detail="docker CLI not available in this process",
        ),
    )
    monkeypatch.setattr(mh, "get_retention_policy_row", lambda _db: None)
    monkeypatch.setattr(mh, "get_cleanup_scheduler", lambda: SimpleNamespace(is_running=lambda: False, last_tick_at=lambda: None))
    monkeypatch.setattr(mh, "effective_retention_policies", lambda _row: {})
    monkeypatch.setattr(mh, "fetch_destination_health_aggregates", lambda *a, **k: [])
    monkeypatch.setattr(mh, "fetch_destination_lookup", lambda *a, **k: {})
    monkeypatch.setattr(mh, "get_https_config_row", lambda _db: None)
    monkeypatch.setattr(mh, "probe_delivery_logs_indexes", lambda _conn: {"checked": False, "error": None})
    monkeypatch.setattr(mh, "probe_pg_stat_statements", lambda _conn: {"available": False})
    monkeypatch.setattr(mh, "fetch_pg_stat_statements_top", lambda *a, **k: [])
    monkeypatch.setattr(mh, "build_partition_observability", lambda *a, **k: {})
    monkeypatch.setattr(
        mh,
        "get_partition_maintenance_scheduler",
        lambda: SimpleNamespace(is_running=lambda: False),
    )

    body = mh.build_maintenance_health(db_session)
    assert body["panels"]["scheduler"]["status"] == "WARN"
    assert any(item.get("code") == "STREAM_SCHEDULER_EXTERNAL_UNKNOWN" for item in body["warn"])


def test_maintenance_health_external_unhealthy_is_error(
    monkeypatch: pytest.MonkeyPatch, db_session
) -> None:
    monkeypatch.setattr(mh.settings, "GDC_ENABLE_IN_PROCESS_SCHEDULER", False, raising=False)
    monkeypatch.setattr(
        mh,
        "get_startup_snapshot",
        lambda: SimpleNamespace(scheduler_active=True, migration_integrity=None),
    )
    monkeypatch.setattr(mh.scheduler_runtime_state, "scheduler_uptime_seconds", lambda now=None: None)
    monkeypatch.setattr(mh.scheduler_runtime_state, "active_worker_count", lambda: 0)
    monkeypatch.setattr(mh.scheduler_runtime_state, "stream_backoff_summary", lambda: {})
    monkeypatch.setattr(mh, "evaluate_schema_with_engine", lambda _engine: (True, [], "head", None))
    monkeypatch.setattr(mh, "_alembic_script_heads", lambda: ("head",))
    monkeypatch.setattr(
        "app.scheduler.external_container_health.probe_external_scheduler_container",
        lambda: ExternalSchedulerHealth(
            container_name="gdc-platform-scheduler",
            probe_ok=True,
            running=False,
            health_status="unhealthy",
            detail="scheduler container is not running",
        ),
    )
    monkeypatch.setattr(mh, "get_retention_policy_row", lambda _db: None)
    monkeypatch.setattr(mh, "get_cleanup_scheduler", lambda: SimpleNamespace(is_running=lambda: False, last_tick_at=lambda: None))
    monkeypatch.setattr(mh, "effective_retention_policies", lambda _row: {})
    monkeypatch.setattr(mh, "fetch_destination_health_aggregates", lambda *a, **k: [])
    monkeypatch.setattr(mh, "fetch_destination_lookup", lambda *a, **k: {})
    monkeypatch.setattr(mh, "get_https_config_row", lambda _db: None)
    monkeypatch.setattr(mh, "probe_delivery_logs_indexes", lambda _conn: {"checked": False, "error": None})
    monkeypatch.setattr(mh, "probe_pg_stat_statements", lambda _conn: {"available": False})
    monkeypatch.setattr(mh, "fetch_pg_stat_statements_top", lambda *a, **k: [])
    monkeypatch.setattr(mh, "build_partition_observability", lambda *a, **k: {})
    monkeypatch.setattr(
        mh,
        "get_partition_maintenance_scheduler",
        lambda: SimpleNamespace(is_running=lambda: False),
    )

    body = mh.build_maintenance_health(db_session)
    assert body["panels"]["scheduler"]["status"] == "ERROR"
    assert any(item.get("code") == "STREAM_SCHEDULER_EXTERNAL_UNHEALTHY" for item in body["error"])
