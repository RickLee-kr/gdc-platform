"""Historical materialization design contract validation."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "specs/043-observability-scale-foundation/spec.md"
GUIDE = ROOT / "docs/operations/historical-materialization.md"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_historical_materialization_contract_is_documented() -> None:
    spec = _read(SPEC)
    guide = _read(GUIDE)
    combined = f"{spec}\n{guide}"

    required_terms = [
        "raw delivery_logs -> hourly snapshots -> daily snapshots",
        "Historical Snapshot Retention Model",
        "Behavior After Raw Delivery Log Retention",
        "Snapshot Anchor Rules",
        "Live vs Historical Query Boundary",
        "Fail-Open Behavior",
        "Non-Goals",
        "raw",
        "hourly_snapshot",
        "daily_snapshot",
        "partial",
    ]

    for term in required_terms:
        assert term in combined


def test_phase_zero_contract_remains_non_destructive() -> None:
    guide = _read(GUIDE)

    required_guardrails = [
        "New database migrations or tables",
        "Destructive cleanup",
        "A background worker",
        "Runtime production code changes",
        "Retention service changes",
        "StreamRunner changes",
        "Frontend behavior changes",
    ]

    for guardrail in required_guardrails:
        assert guardrail in guide


def test_future_validation_requires_schema_approval() -> None:
    guide = _read(GUIDE)

    assert "schema-free" in guide
    assert "only after the schema and query interfaces are approved" in guide
