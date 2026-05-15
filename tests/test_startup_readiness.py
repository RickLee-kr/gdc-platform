"""Unit tests for startup schema readiness (mocked engine; no SQLite)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from app.startup_readiness import (
    REQUIRED_TABLES,
    StartupSnapshot,
    build_startup_readiness_summary_payload,
    evaluate_schema_with_engine,
)


def test_evaluate_schema_ready_when_all_tables_present() -> None:
    mock_conn = MagicMock()
    mock_conn.execute.return_value.first.return_value = ("rev_head",)

    mock_inspector = MagicMock()
    mock_inspector.get_table_names.return_value = list(REQUIRED_TABLES)

    mock_eng = MagicMock()
    mock_cm = MagicMock()
    mock_cm.__enter__.return_value = mock_conn
    mock_cm.__exit__.return_value = None
    mock_eng.connect.return_value = mock_cm

    with patch("app.startup_readiness.inspect", return_value=mock_inspector):
        ready, missing, rev, err = evaluate_schema_with_engine(mock_eng)

    assert ready is True
    assert missing == ()
    assert rev == "rev_head"
    assert err is None


def test_evaluate_schema_not_ready_reports_missing() -> None:
    mock_conn = MagicMock()
    mock_conn.execute.return_value.first.return_value = ("rev_head",)

    mock_inspector = MagicMock()
    mock_inspector.get_table_names.return_value = ["streams"]

    mock_eng = MagicMock()
    mock_cm = MagicMock()
    mock_cm.__enter__.return_value = mock_conn
    mock_cm.__exit__.return_value = None
    mock_eng.connect.return_value = mock_cm

    with patch("app.startup_readiness.inspect", return_value=mock_inspector):
        ready, missing, rev, err = evaluate_schema_with_engine(mock_eng)

    assert ready is False
    assert "streams" not in missing
    assert "connectors" in missing
    assert rev == "rev_head"
    assert err is None


def test_evaluate_schema_connection_error() -> None:
    from sqlalchemy.exc import OperationalError

    mock_eng = MagicMock()
    mock_eng.connect.side_effect = OperationalError("statement", None, None)

    ready, missing, rev, err = evaluate_schema_with_engine(mock_eng)

    assert ready is False
    assert rev is None
    assert err is not None
    assert len(missing) == len(REQUIRED_TABLES)


def test_evaluate_schema_after_missing_alembic_version_table_rolls_back() -> None:
    """Missing alembic_version must not leave the probe connection aborted (PostgreSQL InFailedSqlTransaction)."""

    from sqlalchemy.exc import ProgrammingError

    mock_conn = MagicMock()
    mock_conn.execute.side_effect = ProgrammingError(
        "SELECT",
        {},
        Exception("relation alembic_version does not exist"),
    )

    mock_inspector = MagicMock()
    mock_inspector.get_table_names.return_value = list(REQUIRED_TABLES)

    mock_eng = MagicMock()
    mock_cm = MagicMock()
    mock_cm.__enter__.return_value = mock_conn
    mock_cm.__exit__.return_value = None
    mock_eng.connect.return_value = mock_cm

    with patch("app.startup_readiness.inspect", return_value=mock_inspector):
        ready, missing, rev, err = evaluate_schema_with_engine(mock_eng)

    assert ready is True
    assert missing == ()
    assert rev is None
    assert err is None
    mock_conn.rollback.assert_called_once()


def test_startup_readiness_summary_payload_shape() -> None:
    snap = StartupSnapshot(
        database_dbname="gdc",
        database_host="postgres",
        database_port=5432,
        database_user="gdc",
        database_url_source="environment",
        alembic_revision="abc123",
        schema_ready=True,
        missing_tables=(),
        scheduler_active=True,
        degraded_reason=None,
        connection_error=None,
    )
    body = build_startup_readiness_summary_payload(snap, scheduler_started=True)
    assert body["stage"] == "startup_readiness_summary"
    assert body["db_ready"] is True
    assert body["migrations_ready"] is True
    assert body["scheduler_started"] is True
    assert "frontend_expected" in body
    assert "reverse_proxy_expected" in body

    snap_bad = StartupSnapshot(
        database_dbname=None,
        database_host=None,
        database_port=None,
        database_user=None,
        database_url_source="dotenv_or_default",
        alembic_revision=None,
        schema_ready=False,
        missing_tables=("streams",),
        scheduler_active=False,
        degraded_reason="database_schema_not_ready",
        connection_error="connection refused",
    )
    body2 = build_startup_readiness_summary_payload(snap_bad, scheduler_started=False)
    assert body2["db_ready"] is False
    assert body2["migrations_ready"] is False
    assert body2["scheduler_started"] is False
