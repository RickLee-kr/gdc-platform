"""Unit tests for route processing_status alignment helpers."""

from __future__ import annotations

from app.runtime.route_processing_status import compute_route_processing_status


class _FakeRow:
    def __init__(self, *, enabled: bool) -> None:
        self.enabled = enabled


def test_compute_status_inherited_stream_only() -> None:
    assert (
        compute_route_processing_status(
            persisted_source="stream",
            route_rule_rows=[],
            has_governance_override=False,
        )
        == "Inherited"
    )


def test_compute_status_mixed_stream_plus_governance() -> None:
    assert (
        compute_route_processing_status(
            persisted_source="stream",
            route_rule_rows=[],
            has_governance_override=True,
        )
        == "Mixed"
    )


def test_compute_status_overridden_route_only() -> None:
    assert (
        compute_route_processing_status(
            persisted_source="route",
            route_rule_rows=[_FakeRow(enabled=True)],
            has_governance_override=False,
        )
        == "Overridden"
    )


def test_compute_status_mixed_route_plus_governance() -> None:
    assert (
        compute_route_processing_status(
            persisted_source="route",
            route_rule_rows=[_FakeRow(enabled=True)],
            has_governance_override=True,
        )
        == "Mixed"
    )


def test_compute_status_overridden_governance_only() -> None:
    assert (
        compute_route_processing_status(
            persisted_source="empty",
            route_rule_rows=[],
            has_governance_override=True,
        )
        == "Overridden"
    )


def test_compute_status_mixed_disabled_route_rows() -> None:
    assert (
        compute_route_processing_status(
            persisted_source="stream",
            route_rule_rows=[_FakeRow(enabled=False)],
            has_governance_override=False,
        )
        == "Mixed"
    )
