"""JSON-safe value isolation for the runtime pipeline (minimize deepcopy cost)."""

from __future__ import annotations

from typing import Any

_CHECKPOINT_LOG_META_KEYS = frozenset(
    {
        "last_processed_key",
        "last_processed_file",
        "last_processed_last_modified",
        "last_processed_mtime",
        "last_processed_etag",
        "last_processed_size",
        "last_processed_offset",
        "last_processed_hash",
        "last_processed_db_watermark",
        "last_processed_db_order",
        "updated_at",
        "checkpoint_type",
    }
)
_EVENT_ID_PREVIEW_KEYS = ("event_id", "id", "@timestamp", "timestamp")


def copy_json_value(value: Any) -> Any:
    """Deep-copy nested dict/list only; pass through immutable JSON scalars."""

    if isinstance(value, dict):
        return {key: copy_json_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [copy_json_value(item) for item in value]
    return value


def copy_event_dict(event: dict[str, Any]) -> dict[str, Any]:
    """Return an isolated event dict safe from downstream in-place mutation."""

    return copy_json_value(event)


def copy_events(events: list[dict[str, Any]], *, limit: int | None = None) -> list[dict[str, Any]]:
    """Copy a bounded list of event dicts for replay/checkpoint snapshots."""

    bounded = events[:limit] if limit is not None else events
    return [copy_event_dict(item) for item in bounded if isinstance(item, dict)]


def slim_checkpoint_for_log(checkpoint: dict[str, Any] | None) -> dict[str, Any] | None:
    """Persist only checkpoint metadata and event-id preview (not full last_success_event)."""

    if not isinstance(checkpoint, dict):
        return None

    out: dict[str, Any] = {}
    for key in _CHECKPOINT_LOG_META_KEYS:
        if key in checkpoint:
            out[key] = checkpoint[key]

    last_success = checkpoint.get("last_success_event")
    if isinstance(last_success, dict):
        preview = {key: last_success[key] for key in _EVENT_ID_PREVIEW_KEYS if key in last_success}
        if preview:
            out["last_success_event"] = preview

    if out:
        return out
    return copy_json_value(checkpoint)
