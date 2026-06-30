"""Apply per-stream lab throughput tuning to existing catalog rows."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.destinations.models import Destination
from app.dev_validation_lab import templates as T
from app.dev_validation_lab.lab_throughput_config import (
    apply_lab_http_throughput_config,
    is_negative_stream_title,
    lab_polling_interval_for_title,
    lab_sustained_events_per_poll_for_bare_title,
    lab_webhook_destination_config_patch,
)
from app.mappings.models import Mapping
from app.streams.models import Stream

_VISIBLE_E2E_PREFIX = "[DEV E2E] "


_DB_BARE_TITLES: frozenset[str] = frozenset(
    {
        "Database Query PostgreSQL E2E",
        "Database Query MySQL E2E",
        "Database Query MariaDB E2E",
        "Database Query Stream",
    }
)


def sync_lab_throughput_destination_tuning(db: Session) -> None:
    """Switch lab webhook destinations to batched POST delivery."""

    prefixes = (T.LAB_NAME_PREFIX, _VISIBLE_E2E_PREFIX)
    rows = (
        db.query(Destination)
        .filter(
            Destination.name.startswith(prefixes[0]) | Destination.name.startswith(prefixes[1]),
            Destination.destination_type == "WEBHOOK_POST",
        )
        .all()
    )
    for row in rows:
        desired = lab_webhook_destination_config_patch(dict(row.config_json or {}))
        if dict(row.config_json or {}) != desired:
            row.config_json = desired
    db.flush()


def sync_lab_throughput_stream_tuning(db: Session) -> None:
    """Refresh polling intervals and HTTP lab endpoints for active lab streams."""

    for prefix in (T.LAB_NAME_PREFIX, _VISIBLE_E2E_PREFIX):
        rows = db.query(Stream).filter(Stream.name.startswith(prefix)).all()
        for row in rows:
            name = str(row.name)
            if is_negative_stream_title(name, prefix=prefix):
                continue
            desired_polling = lab_polling_interval_for_title(name, prefix=prefix)
            if int(row.polling_interval or 0) != desired_polling:
                row.polling_interval = desired_polling
            bare = name[len(prefix) :] if name.startswith(prefix) else name
            if bare in _DB_BARE_TITLES:
                desired_rows = lab_sustained_events_per_poll_for_bare_title(bare)
                cfg = dict(row.config_json or {})
                if int(cfg.get("max_rows_per_run") or 0) != desired_rows:
                    cfg["max_rows_per_run"] = desired_rows
                    row.config_json = cfg
            if str(row.stream_type or "").strip().upper() == "HTTP_API_POLLING":
                desired_cfg = apply_lab_http_throughput_config(
                    dict(row.config_json or {}),
                    stream_title=name,
                    prefix=prefix,
                )
                if dict(row.config_json or {}) != desired_cfg:
                    row.config_json = desired_cfg
            if bare == "Stream single-object":
                mapping = db.query(Mapping).filter(Mapping.stream_id == int(row.id)).first()
                if mapping is not None and mapping.event_array_path != "$.data":
                    mapping.event_array_path = "$.data"
                    mapping.event_root_path = None
    db.flush()


def sync_lab_throughput_tuning(db: Session) -> None:
    """Apply stream + destination lab throughput tuning in one transaction."""

    sync_lab_throughput_stream_tuning(db)
    sync_lab_throughput_destination_tuning(db)
