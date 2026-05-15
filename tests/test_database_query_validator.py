"""Unit tests for DATABASE_QUERY SQL validation."""

from __future__ import annotations

import pytest

from app.runtime.errors import SourceFetchError
from app.sources.database_query.query_validator import coerce_query_params, validate_select_query, validate_sql_identifier


def test_validate_select_accepts_simple_select() -> None:
    validate_select_query("SELECT id, name FROM users WHERE active = true")


def test_validate_select_rejects_semicolon() -> None:
    with pytest.raises(SourceFetchError, match="semicolon"):
        validate_select_query("SELECT 1; SELECT 2")


def test_validate_select_rejects_insert() -> None:
    with pytest.raises(SourceFetchError):
        validate_select_query("INSERT INTO t VALUES (1)")


def test_validate_select_rejects_update() -> None:
    with pytest.raises(SourceFetchError):
        validate_select_query("UPDATE t SET x = 1")


def test_validate_select_rejects_delete() -> None:
    with pytest.raises(SourceFetchError):
        validate_select_query("DELETE FROM t")


def test_validate_select_rejects_drop() -> None:
    with pytest.raises(SourceFetchError):
        validate_select_query("DROP TABLE t")


def test_validate_select_rejects_truncate() -> None:
    with pytest.raises(SourceFetchError):
        validate_select_query("TRUNCATE t")


def test_validate_select_rejects_copy() -> None:
    with pytest.raises(SourceFetchError):
        validate_select_query("COPY t TO STDOUT")


def test_validate_select_accepts_with_cte() -> None:
    validate_select_query("WITH a AS (SELECT 1 AS x) SELECT * FROM a")


def test_coerce_query_params_list() -> None:
    assert coerce_query_params([1, "a"]) == (1, "a")


def test_coerce_query_params_dict() -> None:
    assert coerce_query_params({"a": 1}) == {"a": 1}


def test_validate_identifier_ok() -> None:
    assert validate_sql_identifier("event_time", field="x") == "event_time"


def test_validate_identifier_bad() -> None:
    with pytest.raises(SourceFetchError):
        validate_sql_identifier("bad;col", field="x")
