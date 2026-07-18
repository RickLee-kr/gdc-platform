"""Throughput targets for dev-validation and visible E2E lab streams.

Every active (non-negative) lab stream gets a stable pseudo-random sustained EPS target
in ``[LAB_EPS_MIN, LAB_EPS_MAX]``. Polling intervals, WireMock batch sizes, and feeder
tick rates are derived from those targets so the stream console shows ≥5 EPS per stream.
"""

from __future__ import annotations

import math
import random
import zlib
from typing import Any

# Sustained EPS band for dashboard / stream-console lab fixtures.
LAB_EPS_MIN = 5
LAB_EPS_MAX = 20

# Legacy aliases (tests / callers).
LAB_EPS_MAX_EXCLUSIVE = LAB_EPS_MAX + 1

# Polling cadence bounds and negative-test slow path.
LAB_POLLING_INTERVAL_MIN = 1
LAB_POLLING_INTERVAL_MAX = 4
LAB_POLLING_INTERVAL_NEGATIVE = 120

# Fastest observed HTTP lab poll cycles (fetch + map + batched deliver); caps batch size
# when modeled cycle (LAB_EXPECTED_RUN_DURATION_SEC) overshoots actual runtime.
LAB_MIN_OBSERVED_CYCLE_SEC = 11.0

# Measured StreamRunner cycle (fetch + map + deliver) on lab HTTP streams; EPS must use
# events / (run_duration + polling_interval), not events / polling_interval alone.
LAB_EXPECTED_RUN_DURATION_SEC = 26
LAB_MAX_EVENTS_PER_POLL = 300

# Lab webhook destinations deliver one HTTP POST per poll batch (not per event).
LAB_WEBHOOK_PAYLOAD_MODE = "BATCH_JSON_ARRAY"
LAB_WEBHOOK_BATCH_SIZE = 300

# Legacy tier constants (kept for importers; prefer per-stream helpers below).
LAB_POLLING_INTERVAL_BASE = 2
LAB_POLLING_INTERVAL_HIGH = 1
LAB_POLLING_INTERVAL_SINGLE_EVENT = 1

# WireMock batch size per lab-throughput HTTP path (≥ LAB_EPS_MAX for interval=1 streams).
LAB_HTTP_EVENTS_BASE = 20
LAB_HTTP_EVENTS_HIGH = 20
LAB_HTTP_EVENTS_NESTED = 20
LAB_HTTP_EVENTS_OKTA = 20
LAB_HTTP_EVENTS_SINGLE = 20

# Feeder tick batch sizes — scaled to sustain the highest DB / webhook / object targets.
LAB_FEED_DB_ROWS_BASE = 8
LAB_FEED_DB_ROWS_HIGH = 20
LAB_FEED_S3_OBJECTS_BASE = 2
LAB_FEED_S3_OBJECTS_HIGH = 4
LAB_FEED_REMOTE_FILES_BASE = 2
LAB_FEED_REMOTE_FILES_HIGH = 4
LAB_FEED_WEBHOOK_EVENTS_BASE = 8
LAB_FEED_WEBHOOK_EVENTS_HIGH = 20
LAB_FEED_REMOTE_VISIBLE_LINES = 20
# Cap SFTP/SCP file creations per feeder tick; each file carries multiple events/lines.
LAB_FEED_REMOTE_FILES_CAP = 12

LAB_HTTP_BASE_PATH = "/api/v1/lab-throughput/base-events"
LAB_HTTP_HIGH_PATH = "/api/v1/lab-throughput/high-events"
LAB_HTTP_SINGLE_PATH = "/api/v1/lab-throughput/single-object"
LAB_HTTP_NESTED_PATH = "/api/v1/lab-throughput/nested-array"
LAB_HTTP_OKTA_LOGS_PATH = "/api/v1/lab-throughput/okta-logs"

_VISIBLE_E2E_PREFIX = "[DEV E2E] "
_VALIDATION_PREFIX = "[DEV VALIDATION] "

# Bare titles seeded only under ``[DEV E2E] `` (not duplicated under validation prefix).
VISIBLE_E2E_ONLY_STREAM_TITLES: frozenset[str] = frozenset(
    {
        "HTTP API Stream",
        "S3 Object Stream",
        "Database Query Stream",
        "Remote File Stream",
        "Webhook Receiver Stream",
    }
)

# Approximate ingest lines per polled object/file in the lab feeder fixtures.
# Dense objects keep GetObject count low under multi-stream MinIO contention.
LAB_S3_LINES_PER_OBJECT = 25
# Ideal run duration once List/Get are uncontended (parallel GetObject + denser files).
LAB_S3_EXPECTED_RUN_DURATION_SEC = 15
# Measured StreamRunner cycle for S3 under concurrent lab load (scheduler contention).
# Batch sizing must use this so eps_1m stays ≥ LAB_EPS_MIN after a single successful poll.
LAB_S3_OBSERVED_CYCLE_SEC = 55
# Cap objects fetched per poll (parallel GetObject remains bounded).
LAB_S3_MAX_OBJECTS_PER_RUN = 16
# Cap lab-feed S3 keys retained on disk (E2E verifies flow; not a data lake).
# Keep a small buffer above one poll batch so streams never starve, then prune.
LAB_S3_FEED_MAX_OBJECTS = 24
# Cap lab-* remote files retained under SFTP/SCP upload dirs.
LAB_REMOTE_FEED_MAX_FILES = 24
# Cap feeder-inserted rows retained in fixture DB tables (security_events / source_e2e_rows).
LAB_DB_FEED_MAX_ROWS = 500
# Isolated prefixes avoid scanning historical lab-feed backlogs in MinIO.
LAB_S3_VISIBLE_ACTIVE_PREFIX = "e2e-s3/lab-active/"
LAB_S3_VALIDATION_ACTIVE_PREFIX = "security/lab-active/"
LAB_REMOTE_NDJSON_LINES_PER_FILE = 3
LAB_REMOTE_JSON_ARRAY_EVENTS_PER_FILE = 1

# Bare stream titles (without lab prefix) that receive sustained throughput.
LAB_ACTIVE_STREAM_TITLES: frozenset[str] = frozenset(
    {
        # DEV VALIDATION — HTTP
        "Stream single-object",
        "Stream array-response",
        "Stream nested-array",
        "Stream post-json-body",
        "Stream pagination-sample",
        "Stream delivery-only",
        "Stream vendor-malop",
        "Stream OAuth2 client-credentials",
        "Stream OAuth2 refresh-cycle (JWT token URL)",
        "Stream OAuth2 token-exchange-failure",
        "Stream session-events",
        # DEV VALIDATION — source expansion
        "Database Query PostgreSQL E2E",
        "Database Query MySQL E2E",
        "Database Query MariaDB E2E",
        "Remote File SFTP E2E",
        "Remote File SCP JSON E2E",
        "S3 Object Polling E2E",
        # DEV E2E — visible fixtures
        "HTTP API Stream",
        "S3 Object Stream",
        "Database Query Stream",
        "Remote File Stream",
        "Webhook Receiver Stream",
    }
)

NEGATIVE_VALIDATION_STREAM_TITLES: frozenset[str] = frozenset(
    {
        "Stream empty-response",
        "Stream auth-only",
    }
)

# Deprecated tier sets — retained for compatibility; logic uses per-stream targets.
HIGH_VOLUME_VALIDATION_STREAM_TITLES: frozenset[str] = frozenset(
    {
        "Stream array-response",
        "Stream delivery-only",
        "Database Query PostgreSQL E2E",
        "Database Query MySQL E2E",
        "Database Query MariaDB E2E",
        "S3 Object Polling E2E",
        "Remote File SFTP E2E",
        "Remote File SCP JSON E2E",
        "Stream vendor-malop",
    }
)

HIGH_VOLUME_VISIBLE_E2E_STREAM_TITLES: frozenset[str] = frozenset(
    {
        "HTTP API Stream",
        "Database Query Stream",
        "S3 Object Stream",
    }
)

SINGLE_EVENT_STREAM_TITLES: frozenset[str] = frozenset(
    {
        "Stream single-object",
        "Remote File Stream",
    }
)


def _bare_stream_title(title: str, *, prefix: str) -> str:
    t = str(title or "").strip()
    if t.startswith(prefix):
        return t[len(prefix) :]
    return t


def is_negative_stream_title(title: str, *, prefix: str) -> bool:
    return _bare_stream_title(title, prefix=prefix) in NEGATIVE_VALIDATION_STREAM_TITLES


def is_high_volume_stream_title(title: str, *, prefix: str) -> bool:
    bare = _bare_stream_title(title, prefix=prefix)
    if prefix == _VISIBLE_E2E_PREFIX:
        return bare in HIGH_VOLUME_VISIBLE_E2E_STREAM_TITLES
    return bare in HIGH_VOLUME_VALIDATION_STREAM_TITLES


def _rng_for_bare_title(bare: str) -> random.Random:
    seed = zlib.crc32(bare.encode("utf-8")) & 0xFFFFFFFF
    return random.Random(seed)


def lab_target_eps_for_bare_title(bare: str) -> int:
    """Stable pseudo-random EPS target in [LAB_EPS_MIN, LAB_EPS_MAX] for active lab streams."""

    if bare not in LAB_ACTIVE_STREAM_TITLES:
        return LAB_EPS_MIN
    return _rng_for_bare_title(bare).randint(LAB_EPS_MIN, LAB_EPS_MAX)


def lab_target_eps_for_title(title: str, *, prefix: str) -> int | None:
    if is_negative_stream_title(title, prefix=prefix):
        return None
    bare = _bare_stream_title(title, prefix=prefix)
    if bare not in LAB_ACTIVE_STREAM_TITLES:
        return LAB_EPS_MIN
    return lab_target_eps_for_bare_title(bare)


def lab_http_path_for_bare_title(bare: str) -> str:
    if bare == "Stream single-object":
        return LAB_HTTP_SINGLE_PATH
    if bare == "Stream nested-array":
        return LAB_HTTP_NESTED_PATH
    if bare in {
        "Stream OAuth2 client-credentials",
        "Stream OAuth2 refresh-cycle (JWT token URL)",
        "Stream OAuth2 token-exchange-failure",
    }:
        return LAB_HTTP_OKTA_LOGS_PATH
    if bare in {"Stream vendor-malop", "Stream array-response", "Stream delivery-only", "HTTP API Stream"}:
        return LAB_HTTP_HIGH_PATH
    if bare == "Stream session-events":
        return LAB_HTTP_BASE_PATH
    return LAB_HTTP_BASE_PATH


def lab_effective_cycle_seconds(polling_interval_seconds: int) -> float:
    return float(LAB_EXPECTED_RUN_DURATION_SEC) + max(1.0, float(polling_interval_seconds))


def lab_events_per_poll_for_target(target_eps: int, polling_interval_seconds: int = LAB_POLLING_INTERVAL_MIN) -> int:
    """Batch size so sustained EPS meets target given run duration + polling sleep."""

    target = max(LAB_EPS_MIN, min(LAB_EPS_MAX, int(target_eps)))
    events = int(math.ceil(target * lab_effective_cycle_seconds(polling_interval_seconds)))
    return max(LAB_EPS_MIN, min(LAB_MAX_EVENTS_PER_POLL, events))


def lab_http_events_for_path(path: str) -> int:
    matching = [bare for bare in LAB_ACTIVE_STREAM_TITLES if lab_http_path_for_bare_title(bare) == path]
    if not matching:
        return lab_events_per_poll_for_target(LAB_EPS_MIN, LAB_POLLING_INTERVAL_MIN)
    return max(lab_http_events_for_bare_title(bare) for bare in matching)


def lab_http_events_for_bare_title(bare: str) -> int:
    target = lab_target_eps_for_bare_title(bare)
    interval = lab_polling_interval_for_bare_title(bare)
    modeled = lab_events_per_poll_for_target(target, interval)
    floor = int(math.ceil(LAB_EPS_MIN * lab_effective_cycle_seconds(interval)))
    fast_cap = int(math.ceil(target * (LAB_MIN_OBSERVED_CYCLE_SEC + interval)))
    return max(LAB_EPS_MIN, min(modeled, max(floor, fast_cap)))


def lab_polling_interval_for_events(*, events_per_poll: int, target_eps: int) -> int:
    """Pick polling interval so sustained EPS stays within [LAB_EPS_MIN, LAB_EPS_MAX]."""

    events = max(1, int(events_per_poll))
    target = max(LAB_EPS_MIN, min(LAB_EPS_MAX, int(target_eps)))
    ideal = max(1, round(events / target))
    min_interval = max(1, (events + LAB_EPS_MAX) // LAB_EPS_MAX)
    max_interval = max(1, events // LAB_EPS_MIN)
    interval = max(min_interval, min(max_interval, ideal))
    return max(LAB_POLLING_INTERVAL_MIN, min(LAB_POLLING_INTERVAL_MAX, interval))


def lab_polling_interval_for_title(title: str, *, prefix: str) -> int:
    if is_negative_stream_title(title, prefix=prefix):
        return LAB_POLLING_INTERVAL_NEGATIVE
    bare = _bare_stream_title(title, prefix=prefix)
    return lab_polling_interval_for_bare_title(bare)


def lab_estimated_http_eps(*, events_per_poll: int, polling_interval_seconds: int) -> float:
    return float(events_per_poll) / lab_effective_cycle_seconds(polling_interval_seconds)


def lab_estimated_eps_for_title(title: str, *, prefix: str) -> float | None:
    if is_negative_stream_title(title, prefix=prefix):
        return None
    bare = _bare_stream_title(title, prefix=prefix)
    if bare == "Webhook Receiver Stream":
        interval = lab_polling_interval_for_bare_title(bare)
        events = lab_sustained_events_per_poll_for_bare_title(bare)
        return events / lab_effective_cycle_seconds(interval)
    if bare in {
        "Database Query PostgreSQL E2E",
        "Database Query MySQL E2E",
        "Database Query MariaDB E2E",
        "Database Query Stream",
    }:
        interval = lab_polling_interval_for_bare_title(bare)
        rows = lab_sustained_events_per_poll_for_bare_title(bare)
        return float(rows) / lab_effective_cycle_seconds(interval)
    if bare in {"S3 Object Polling E2E", "S3 Object Stream"}:
        interval = lab_polling_interval_for_bare_title(bare)
        events = lab_sustained_events_per_poll_for_bare_title(bare)
        cycle = float(max(LAB_S3_EXPECTED_RUN_DURATION_SEC, LAB_S3_OBSERVED_CYCLE_SEC)) + float(interval)
        return float(events) / cycle
    if bare in {"Remote File SFTP E2E", "Remote File SCP JSON E2E", "Remote File Stream"}:
        interval = lab_polling_interval_for_bare_title(bare)
        events = lab_sustained_events_per_poll_for_bare_title(bare)
        return float(events) / lab_effective_cycle_seconds(interval)
    events = lab_http_events_for_bare_title(bare)
    interval = lab_polling_interval_for_bare_title(bare)
    return lab_estimated_http_eps(events_per_poll=events, polling_interval_seconds=interval)


def lab_http_eps_within_target(title: str, *, prefix: str) -> bool:
    eps = lab_estimated_eps_for_title(title, prefix=prefix)
    if eps is None:
        return True
    return LAB_EPS_MIN <= eps <= LAB_EPS_MAX


def lab_http_events_for_title(title: str, *, prefix: str) -> int:
    bare = _bare_stream_title(title, prefix=prefix)
    return lab_http_events_for_bare_title(bare)


def _http_endpoint_eligible_for_lab_throughput(endpoint: str) -> bool:
    ep = str(endpoint or "").strip()
    return (
        ep.startswith("/api/")
        or ep.startswith("/connect/api/")
        or ep.startswith("/e2e-session/")
    )


def lab_e2e_throughput_stream_cases() -> list[tuple[str, str]]:
    """Return ``(full_stream_title, prefix)`` for every positive lab throughput stream."""

    out: list[tuple[str, str]] = []
    for prefix in (_VALIDATION_PREFIX, _VISIBLE_E2E_PREFIX):
        for bare in sorted(LAB_ACTIVE_STREAM_TITLES):
            if prefix == _VISIBLE_E2E_PREFIX:
                if bare not in VISIBLE_E2E_ONLY_STREAM_TITLES:
                    continue
            elif bare in VISIBLE_E2E_ONLY_STREAM_TITLES:
                continue
            out.append((f"{prefix}{bare}", prefix))
    return out


_S3_STREAM_TITLES: frozenset[str] = frozenset({"S3 Object Polling E2E", "S3 Object Stream"})


def lab_s3_max_objects_for_bare_title(bare: str) -> int:
    target = lab_target_eps_for_bare_title(bare)
    interval = LAB_POLLING_INTERVAL_MIN
    cycle = float(max(LAB_S3_EXPECTED_RUN_DURATION_SEC, LAB_S3_OBSERVED_CYCLE_SEC)) + float(interval)
    events = max(LAB_EPS_MIN, min(LAB_MAX_EVENTS_PER_POLL, int(math.ceil(target * cycle))))
    # Floor at events needed for eps_1m >= LAB_EPS_MIN after one 60s-window poll.
    events = max(events, LAB_EPS_MIN * 60)
    return max(1, min(LAB_S3_MAX_OBJECTS_PER_RUN, math.ceil(events / LAB_S3_LINES_PER_OBJECT)))


def lab_sustained_events_per_poll_for_bare_title(bare: str) -> int:
    """Events ingested per stream poll cycle used for interval tuning."""

    if bare in _S3_STREAM_TITLES:
        return max(LAB_EPS_MIN, lab_s3_max_objects_for_bare_title(bare) * LAB_S3_LINES_PER_OBJECT)
    target = lab_target_eps_for_bare_title(bare)
    interval = LAB_POLLING_INTERVAL_MIN
    return lab_events_per_poll_for_target(target, interval)


def lab_remote_max_files_for_bare_title(bare: str) -> int:
    events = lab_sustained_events_per_poll_for_bare_title(bare)
    if bare == "Remote File SCP JSON E2E":
        events_per_file = lab_remote_json_events_per_file_for_bare_title(bare)
    else:
        events_per_file = max(
            LAB_REMOTE_NDJSON_LINES_PER_FILE,
            int(math.ceil(events / LAB_FEED_REMOTE_FILES_CAP)),
        )
    return max(1, math.ceil(events / events_per_file))


def lab_database_max_rows_for_bare_title(bare: str) -> int:
    target = lab_target_eps_for_bare_title(bare)
    modeled = lab_sustained_events_per_poll_for_bare_title(bare)
    # DB lab polls typically complete in ~8–10s (faster than HTTP modeled cycle).
    db_fast_cap = int(math.ceil(target * 10.0))
    return max(LAB_EPS_MIN, min(modeled, db_fast_cap))


def apply_lab_stream_throughput_config(
    config_json: dict[str, Any],
    *,
    stream_title: str,
    prefix: str,
    stream_type: str,
) -> dict[str, Any]:
    """Apply per-stream ingest batch tuning for lab / visible E2E streams."""

    if is_negative_stream_title(stream_title, prefix=prefix):
        return dict(config_json)
    bare = _bare_stream_title(stream_title, prefix=prefix)
    if bare not in LAB_ACTIVE_STREAM_TITLES:
        return dict(config_json)

    out = dict(config_json)
    st = str(stream_type or "").strip().upper()
    if st == "DATABASE_QUERY":
        out["max_rows_per_run"] = lab_database_max_rows_for_bare_title(bare)
    elif st == "S3_OBJECT_POLLING":
        out["max_objects_per_run"] = lab_s3_max_objects_for_bare_title(bare)
        out["max_list_keys_per_run"] = 250
    elif st == "REMOTE_FILE_POLLING":
        out["max_files_per_run"] = lab_remote_max_files_for_bare_title(bare)
    elif st == "HTTP_API_POLLING":
        return apply_lab_http_throughput_config(out, stream_title=stream_title, prefix=prefix)
    return out


def lab_http_endpoint_for_stream(
    stream_title: str,
    *,
    prefix: str,
    current_endpoint: str,
) -> str:
    if is_negative_stream_title(stream_title, prefix=prefix):
        return current_endpoint
    bare = _bare_stream_title(stream_title, prefix=prefix)
    if bare not in LAB_ACTIVE_STREAM_TITLES:
        return current_endpoint
    if not _http_endpoint_eligible_for_lab_throughput(current_endpoint):
        return current_endpoint
    return lab_http_path_for_bare_title(bare)


def _is_lab_throughput_http_endpoint(endpoint: str) -> bool:
    return str(endpoint or "").strip().startswith("/api/v1/lab-throughput/")


def apply_lab_http_throughput_config(
    config_json: dict[str, Any],
    *,
    stream_title: str,
    prefix: str,
) -> dict[str, Any]:
    """Return ``config_json`` with lab throughput HTTP endpoint when applicable."""

    out = dict(config_json)
    if is_negative_stream_title(stream_title, prefix=prefix):
        return out
    bare = _bare_stream_title(stream_title, prefix=prefix)
    if bare not in LAB_ACTIVE_STREAM_TITLES:
        return out
    endpoint = str(out.get("endpoint") or "").strip()
    if not endpoint or not _http_endpoint_eligible_for_lab_throughput(endpoint):
        return out
    new_endpoint = lab_http_path_for_bare_title(bare)
    out["endpoint"] = new_endpoint
    if _is_lab_throughput_http_endpoint(new_endpoint):
        out["method"] = "GET"
        out.pop("body", None)
        out.pop("params", None)
    return out


def _max_target_eps_for(*titles: str) -> int:
    return max(lab_target_eps_for_bare_title(t) for t in titles)


_DB_STREAM_TITLES: frozenset[str] = frozenset(
    {
        "Database Query PostgreSQL E2E",
        "Database Query MySQL E2E",
        "Database Query MariaDB E2E",
        "Database Query Stream",
    }
)

_REMOTE_FILE_TITLES: frozenset[str] = frozenset(
    {"Remote File SFTP E2E", "Remote File SCP JSON E2E", "Remote File Stream"}
)


def lab_feed_events_per_tick_for_bare_title(bare: str, *, tick_seconds: float = 1.0) -> int:
    """Translate per-poll ingest batch into per-feeder-tick volume for sustained EPS."""

    events_per_poll = lab_sustained_events_per_poll_for_bare_title(bare)
    cycle = lab_effective_cycle_seconds(LAB_POLLING_INTERVAL_MIN)
    tick = max(0.1, float(tick_seconds))
    return max(LAB_EPS_MIN, int(math.ceil(events_per_poll * tick / cycle)))


def lab_feed_db_rows_per_tick(*, tick_seconds: float = 1.0) -> int:
    # DB inserts are cheap; load each poll cycle's full batch every tick so streams never starve.
    _ = tick_seconds
    return max(lab_sustained_events_per_poll_for_bare_title(t) for t in _DB_STREAM_TITLES)


def lab_feed_webhook_events_per_tick(*, tick_seconds: float = 1.0) -> int:
    # Webhook runs have per-run pipeline overhead; use larger batches for sustained EPS.
    base = lab_feed_events_per_tick_for_bare_title("Webhook Receiver Stream", tick_seconds=tick_seconds)
    return max(LAB_EPS_MIN, int(base) * 20)


def lab_feed_s3_objects_per_tick(*, tick_seconds: float = 1.0) -> int:
    """New objects per tick — sized to sustain target EPS without flooding MinIO.

    Uploading a full ``max_objects_per_run`` batch every tick made ListObjects/GetObject
    dominate StreamRunner cycles (60–80s empty polls) and collapsed visible S3 EPS to 0.
    Feed slightly ahead of consume rate (events/tick ÷ lines-per-object).
    """

    tick = max(0.1, float(tick_seconds))
    max_events = max(
        lab_feed_events_per_tick_for_bare_title(t, tick_seconds=tick) for t in _S3_STREAM_TITLES
    )
    # Keep enough fresh keys in each active prefix for the next poll after a long run.
    return max(3, int(math.ceil((max_events * 3) / LAB_S3_LINES_PER_OBJECT)))


def lab_feed_remote_ndjson_lines_per_file() -> int:
    max_events = max(
        lab_sustained_events_per_poll_for_bare_title(t)
        for t in _REMOTE_FILE_TITLES
        if t != "Remote File Stream"
    )
    return max(LAB_REMOTE_NDJSON_LINES_PER_FILE, int(math.ceil(max_events / LAB_FEED_REMOTE_FILES_CAP)))


def lab_feed_remote_json_events_per_file() -> int:
    max_events = lab_sustained_events_per_poll_for_bare_title("Remote File SCP JSON E2E")
    return max(LAB_REMOTE_JSON_ARRAY_EVENTS_PER_FILE, int(math.ceil(max_events / LAB_FEED_REMOTE_FILES_CAP)))


def lab_remote_json_events_per_file_for_bare_title(bare: str) -> int:
    events = lab_sustained_events_per_poll_for_bare_title(bare)
    if bare != "Remote File SCP JSON E2E":
        return LAB_REMOTE_JSON_ARRAY_EVENTS_PER_FILE
    return max(LAB_REMOTE_JSON_ARRAY_EVENTS_PER_FILE, int(math.ceil(events / LAB_FEED_REMOTE_FILES_CAP)))


def lab_feed_remote_files_per_tick(*, tick_seconds: float = 1.0) -> int:
    ndjson_lines = lab_feed_remote_ndjson_lines_per_file()
    json_events = lab_feed_remote_json_events_per_file()
    return max(
        1,
        max(
            math.ceil(
                lab_feed_events_per_tick_for_bare_title(t, tick_seconds=tick_seconds) / ndjson_lines
            )
            if t != "Remote File SCP JSON E2E"
            else math.ceil(
                lab_feed_events_per_tick_for_bare_title(t, tick_seconds=tick_seconds) / json_events
            )
            for t in _REMOTE_FILE_TITLES
            if t != "Remote File Stream"
        ),
    )


def lab_polling_interval_for_bare_title(bare: str) -> int:
    if bare in NEGATIVE_VALIDATION_STREAM_TITLES:
        return LAB_POLLING_INTERVAL_NEGATIVE
    return LAB_POLLING_INTERVAL_MIN


def lab_webhook_destination_config_patch(config_json: dict[str, Any]) -> dict[str, Any]:
    """Ensure lab webhook destinations use batched POSTs for sustained EPS."""

    out = dict(config_json or {})
    out["payload_mode"] = LAB_WEBHOOK_PAYLOAD_MODE
    out["batch_size"] = LAB_WEBHOOK_BATCH_SIZE
    return out


def lab_feed_tick_rates(*, high_volume: bool = True, tick_seconds: float = 1.0) -> dict[str, int]:
    """Batch sizes for one feeder tick (1s default)."""

    tick = max(0.1, float(tick_seconds))
    if not high_volume:
        return {
            "db_rows": LAB_FEED_DB_ROWS_BASE,
            "s3_objects": LAB_FEED_S3_OBJECTS_BASE,
            "remote_files": LAB_FEED_REMOTE_FILES_BASE,
            "webhook_events": LAB_FEED_WEBHOOK_EVENTS_BASE,
            "remote_ndjson_lines_per_file": LAB_REMOTE_NDJSON_LINES_PER_FILE,
            "remote_json_events_per_file": LAB_REMOTE_JSON_ARRAY_EVENTS_PER_FILE,
        }
    return {
        "db_rows": lab_feed_db_rows_per_tick(tick_seconds=tick),
        "s3_objects": lab_feed_s3_objects_per_tick(tick_seconds=tick),
        "remote_files": lab_feed_remote_files_per_tick(tick_seconds=tick),
        "webhook_events": lab_feed_webhook_events_per_tick(tick_seconds=tick),
        "remote_ndjson_lines_per_file": lab_feed_remote_ndjson_lines_per_file(),
        "remote_json_events_per_file": lab_feed_remote_json_events_per_file(),
    }
