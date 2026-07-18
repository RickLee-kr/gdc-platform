"""Tests for connector-common incremental fetch framework."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.runtime.incremental_fetch import (
    build_delivery_checkpoint_update,
    build_fetch_checkpoint_update,
    build_fetch_window,
    connector_incremental_strategy_from_template,
    get_incremental_display_state,
    parse_incremental_fetch_config,
    prepare_fetch_checkpoint_context,
)


def test_parse_incremental_fetch_config_explicit() -> None:
    cfg = {
        "incremental_fetch": {
            "strategy": "closed_window_watermark",
            "watermark_field": "$.event_time",
            "stability_lag_seconds": 90,
            "initial_lookback_seconds": 3600,
        }
    }
    parsed = parse_incremental_fetch_config(cfg)
    assert parsed.strategy == "closed_window_watermark"
    assert parsed.watermark_field == "$.event_time"
    assert parsed.stability_lag_seconds == 90
    assert parsed.framework_enabled is True


def test_parse_incremental_fetch_legacy_checkpoint_mode() -> None:
    cfg = {
        "incremental_fetch": {"strategy": "timestamp_watermark", "watermark_field": "$.created_at"},
        "checkpoint": {"mode": "Timestamp", "cursor_path": "$.created_at"},
    }
    parsed = parse_incremental_fetch_config(cfg)
    assert parsed.strategy == "timestamp_watermark"
    assert parsed.watermark_field == "$.created_at"
    assert parsed.framework_enabled is True


def test_legacy_ui_checkpoint_timestamp_enables_closed_window() -> None:
    """Record Selection checkpoint-only streams auto-map to closed_window_watermark."""

    cfg = {"checkpoint": {"mode": "Timestamp", "cursor_path": "$.created_at"}}
    parsed = parse_incremental_fetch_config(cfg)
    assert parsed.strategy == "closed_window_watermark"
    assert parsed.watermark_field == "$.created_at"
    assert parsed.stability_lag_seconds == 120
    assert parsed.framework_enabled is True


def test_legacy_ui_checkpoint_creation_time_field_name_beats_cursor_mode() -> None:
    """Wizard may leave mode=Cursor while the selected field is a timestamp name."""

    cfg = {
        "event_array_path": "$.Records",
        "checkpoint": {"mode": "Cursor", "cursor_path": "$.Records[*].creationTime"},
    }
    parsed = parse_incremental_fetch_config(cfg)
    assert parsed.strategy == "closed_window_watermark"
    assert parsed.watermark_field == "$.creationTime"
    assert parsed.framework_enabled is True


def test_legacy_ui_checkpoint_cursor_field_enables_cursor_strategy() -> None:
    cfg = {"checkpoint": {"mode": "Cursor", "cursor_path": "$[*].next_cursor"}}
    parsed = parse_incremental_fetch_config(cfg)
    assert parsed.strategy == "cursor"
    assert parsed.cursor_field == "$.next_cursor"
    assert parsed.framework_enabled is True


def test_legacy_ui_event_id_mode_maps_to_cursor() -> None:
    cfg = {"checkpoint": {"mode": "Event ID", "cursor_path": "$.uuid"}}
    parsed = parse_incremental_fetch_config(cfg)
    assert parsed.strategy == "cursor"
    assert parsed.cursor_field == "$.uuid"
    assert parsed.framework_enabled is True


def test_explicit_incremental_fetch_wins_over_legacy_checkpoint() -> None:
    cfg = {
        "incremental_fetch": {
            "strategy": "cursor",
            "cursor_field": "$.page_token",
            "stability_lag_seconds": 30,
        },
        "checkpoint": {"mode": "Timestamp", "cursor_path": "$.created_at"},
    }
    parsed = parse_incremental_fetch_config(cfg)
    assert parsed.strategy == "cursor"
    assert parsed.cursor_field == "$.page_token"
    assert parsed.stability_lag_seconds == 30


def test_legacy_stream_without_incremental_fetch_disabled() -> None:
    parsed = parse_incremental_fetch_config({"checkpoint": {"mode": "None"}})
    assert parsed.framework_enabled is False


def test_legacy_checkpoint_without_field_path_disabled() -> None:
    parsed = parse_incremental_fetch_config({"checkpoint": {"mode": "Timestamp"}})
    assert parsed.framework_enabled is False


def test_prepare_fetch_context_from_legacy_ui_includes_fetch_window_upper() -> None:
    now = datetime(2026, 7, 2, 12, 0, 0, tzinfo=timezone.utc)
    cfg = {"checkpoint": {"mode": "Timestamp", "cursor_path": "$.creationTime"}}
    ctx = prepare_fetch_checkpoint_context({}, cfg, now=now)
    assert "fetch_window_upper" in ctx
    assert ctx["fetch_window_upper"] == "2026-07-02T11:58:00Z"
    assert ctx["stability_lag_seconds"] == 120


def test_closed_window_upper_bound_uses_stability_lag() -> None:
    now = datetime(2026, 7, 2, 12, 0, 0, tzinfo=timezone.utc)
    cfg = {"incremental_fetch": {"strategy": "closed_window_watermark", "stability_lag_seconds": 120}}
    config = parse_incremental_fetch_config(cfg)
    window = build_fetch_window(config=config, checkpoint={}, now=now)
    assert window is not None
    assert window.upper_bound == "2026-07-02T11:58:00Z"
    assert window.lower_bound == "2026-07-01T12:00:00Z"


def test_prepare_fetch_checkpoint_context_closed_window_aliases() -> None:
    now = datetime(2026, 7, 2, 12, 0, 0, tzinfo=timezone.utc)
    cfg = {"incremental_fetch": {"strategy": "closed_window_watermark", "stability_lag_seconds": 60}}
    ctx = prepare_fetch_checkpoint_context({"incremental_fetch_watermark": "2026-07-01T00:00:00Z"}, cfg, now=now)
    assert ctx["fetch_window_lower"] == "2026-07-01T00:00:00Z"
    assert ctx["fetch_window_upper"] == "2026-07-02T11:59:00Z"
    assert ctx["incremental_fetch_watermark"] == "2026-07-01T00:00:00Z"


def test_fetch_watermark_advances_on_closed_window_without_events() -> None:
    now = datetime(2026, 7, 2, 12, 0, 0, tzinfo=timezone.utc)
    cfg = {"incremental_fetch": {"strategy": "closed_window_watermark", "stability_lag_seconds": 120}}
    updated = build_fetch_checkpoint_update(
        events=[],
        stream_config=cfg,
        existing_checkpoint={},
        fetch_succeeded=True,
        now=now,
    )
    assert updated is not None
    assert updated["incremental_fetch_watermark"] == "2026-07-02T11:58:00Z"
    assert updated["last_fetch_at"] == "2026-07-02T12:00:00Z"


def test_cursor_strategy_advances_connector_cursor() -> None:
    cfg = {"incremental_fetch": {"strategy": "cursor", "cursor_field": "$.id"}}
    updated = build_fetch_checkpoint_update(
        events=[{"id": "b-2"}, {"id": "a-1"}],
        stream_config=cfg,
        existing_checkpoint={"connector_cursor": "a-0"},
        fetch_succeeded=True,
    )
    assert updated is not None
    assert updated["connector_cursor"] == "b-2"


def test_timestamp_watermark_strategy() -> None:
    cfg = {"incremental_fetch": {"strategy": "timestamp_watermark", "watermark_field": "$.ts"}}
    updated = build_fetch_checkpoint_update(
        events=[{"ts": "2026-01-01T00:00:00Z"}, {"ts": "2026-01-02T00:00:00Z"}],
        stream_config=cfg,
        existing_checkpoint={"incremental_fetch_watermark": "2025-12-31T00:00:00Z"},
        fetch_succeeded=True,
    )
    assert updated is not None
    assert updated["incremental_fetch_watermark"] == "2026-01-02T00:00:00Z"


def test_delivery_checkpoint_independent_from_fetch_watermark() -> None:
    cfg = {"incremental_fetch": {"strategy": "timestamp_watermark", "watermark_field": "$.ts"}}
    existing = {
        "incremental_fetch_watermark": "2026-01-02T00:00:00Z",
        "last_fetch_at": "2026-01-02T01:00:00Z",
    }
    delivery = build_delivery_checkpoint_update(
        successful_events=[{"ts": "2026-01-01T12:00:00Z", "id": "evt-9"}],
        stream_config=cfg,
        existing_checkpoint=existing,
        now=datetime(2026, 1, 2, 2, 0, 0, tzinfo=timezone.utc),
    )
    assert delivery["incremental_fetch_watermark"] == "2026-01-02T00:00:00Z"
    assert delivery["delivery_checkpoint"]["last_success_event"]["id"] == "evt-9"
    assert delivery["last_delivery_at"] == "2026-01-02T02:00:00Z"


def test_connector_template_strategy_mapping() -> None:
    patch = connector_incremental_strategy_from_template(
        {
            "incremental": {"supported": True, "mode": "search_after"},
            "checkpoint_defaults": {"cursor_field_path": "$.published"},
        }
    )
    assert patch is not None
    assert patch["incremental_fetch"]["strategy"] == "cursor"
    assert patch["incremental_fetch"]["cursor_field"] == "$.published"


def test_split_checkpoint_for_display_legacy() -> None:
    from app.runtime.incremental_fetch import split_checkpoint_for_display

    split = split_checkpoint_for_display({"last_success_event": {"id": "1"}}, {})
    assert split["checkpoint_mode"] == "legacy"
    assert split["legacy_checkpoint"]["last_success_event"]["id"] == "1"


def test_split_checkpoint_for_display_framework() -> None:
    from app.runtime.incremental_fetch import split_checkpoint_for_display

    split = split_checkpoint_for_display(
        {
            "incremental_fetch_watermark": "2026-01-01T00:00:00Z",
            "delivery_checkpoint": {"last_success_event": {"id": "evt-1"}},
        },
        {"incremental_fetch": {"strategy": "timestamp_watermark", "watermark_field": "$.ts"}},
    )
    assert split["checkpoint_mode"] == "framework"
    assert split["fetch_checkpoint"]["incremental_fetch_watermark"] == "2026-01-01T00:00:00Z"
    assert split["delivery_checkpoint"]["last_success_event"]["id"] == "evt-1"


def test_display_state() -> None:
    state = get_incremental_display_state(
        {
            "incremental_fetch_watermark": "2026-01-01T00:00:00Z",
            "connector_cursor": "abc",
            "delivery_checkpoint": {"last_success_event": {"id": "1"}},
            "last_fetch_at": "2026-01-02T00:00:00Z",
        },
        {"incremental_fetch": {"strategy": "cursor", "cursor_field": "$.id"}},
    )
    assert state.strategy == "cursor"
    assert state.fetch_watermark == "2026-01-01T00:00:00Z"
    assert state.connector_cursor == "abc"
    assert state.delivery_checkpoint is not None
