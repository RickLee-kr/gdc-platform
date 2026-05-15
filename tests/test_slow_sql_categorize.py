"""Unit tests for slow SQL categorization heuristics."""

from app.observability.slow_query import categorize_sql


def test_categorize_delivery_logs() -> None:
    assert categorize_sql('SELECT * FROM "delivery_logs" WHERE id = 1') == "delivery_logs"


def test_categorize_validation() -> None:
    assert categorize_sql("SELECT count(*) FROM validation_runs") == "validation"


def test_categorize_other() -> None:
    assert categorize_sql("SELECT 1") == "other"
