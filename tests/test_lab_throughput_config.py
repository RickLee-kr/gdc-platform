"""Lab throughput tuning helpers."""

from __future__ import annotations

from app.dev_validation_lab.lab_throughput_config import (
    LAB_ACTIVE_STREAM_TITLES,
    LAB_EPS_MAX,
    LAB_EPS_MIN,
    LAB_HTTP_HIGH_PATH,
    apply_lab_http_throughput_config,
    apply_lab_stream_throughput_config,
    lab_database_max_rows_for_bare_title,
    lab_e2e_throughput_stream_cases,
    lab_estimated_eps_for_title,
    lab_feed_tick_rates,
    lab_http_endpoint_for_stream,
    lab_http_eps_within_target,
    lab_http_events_for_path,
    lab_polling_interval_for_title,
    lab_remote_max_files_for_bare_title,
    lab_s3_max_objects_for_bare_title,
    lab_target_eps_for_bare_title,
)


def test_every_active_stream_has_unique_random_target_eps() -> None:
    targets = {lab_target_eps_for_bare_title(title) for title in LAB_ACTIVE_STREAM_TITLES}
    assert min(targets) >= LAB_EPS_MIN
    assert max(targets) <= LAB_EPS_MAX
    assert len(targets) > 1


def test_all_e2e_throughput_streams_estimated_eps_within_band() -> None:
    for title, prefix in lab_e2e_throughput_stream_cases():
        assert lab_http_eps_within_target(title, prefix=prefix), title
        eps = lab_estimated_eps_for_title(title, prefix=prefix)
        assert eps is not None
        assert LAB_EPS_MIN <= eps <= LAB_EPS_MAX, (title, eps)


def test_negative_streams_keep_slow_polling() -> None:
    prefix = "[DEV VALIDATION] "
    assert lab_polling_interval_for_title(f"{prefix}Stream empty-response", prefix=prefix) == 120
    assert lab_estimated_eps_for_title(f"{prefix}Stream empty-response", prefix=prefix) is None


def test_lab_http_endpoint_mapping() -> None:
    prefix = "[DEV VALIDATION] "
    assert lab_http_endpoint_for_stream(
        f"{prefix}Stream array-response",
        prefix=prefix,
        current_endpoint="/api/v1/e2e-auth/no-auth-events",
    ) == LAB_HTTP_HIGH_PATH
    assert lab_http_endpoint_for_stream(
        f"{prefix}Stream vendor-malop",
        prefix=prefix,
        current_endpoint="/connect/api/dataexport/anomalies/malop/_search",
    ) == LAB_HTTP_HIGH_PATH


def test_apply_lab_http_throughput_config() -> None:
    prefix = "[DEV VALIDATION] "
    out = apply_lab_http_throughput_config(
        {"endpoint": "/api/v1/e2e-auth/no-auth-events", "method": "GET"},
        stream_title=f"{prefix}Stream array-response",
        prefix=prefix,
    )
    assert out["endpoint"] == LAB_HTTP_HIGH_PATH
    assert out["method"] == "GET"


def test_apply_lab_stream_throughput_config_database_rows_meet_minimum_eps() -> None:
    prefix = "[DEV VALIDATION] "
    title = f"{prefix}Database Query MariaDB E2E"
    out = apply_lab_stream_throughput_config(
        {"query": "SELECT 1"},
        stream_title=title,
        prefix=prefix,
        stream_type="DATABASE_QUERY",
    )
    rows = int(out["max_rows_per_run"])
    assert rows >= lab_database_max_rows_for_bare_title("Database Query MariaDB E2E")
    eps = lab_estimated_eps_for_title(title, prefix=prefix)
    assert eps is not None and LAB_EPS_MIN <= eps <= LAB_EPS_MAX


def test_apply_lab_stream_throughput_config_s3_and_remote_files() -> None:
    prefix = "[DEV E2E] "
    s3 = apply_lab_stream_throughput_config(
        {},
        stream_title=f"{prefix}S3 Object Stream",
        prefix=prefix,
        stream_type="S3_OBJECT_POLLING",
    )
    assert int(s3["max_objects_per_run"]) == lab_s3_max_objects_for_bare_title("S3 Object Stream")
    remote = apply_lab_stream_throughput_config(
        {"remote_directory": "upload"},
        stream_title=f"{prefix}Remote File Stream",
        prefix=prefix,
        stream_type="REMOTE_FILE_POLLING",
    )
    assert int(remote["max_files_per_run"]) == lab_remote_max_files_for_bare_title("Remote File Stream")


def test_lab_webhook_destination_uses_batch_delivery() -> None:
    from app.dev_validation_lab.lab_throughput_config import (
        LAB_WEBHOOK_BATCH_SIZE,
        LAB_WEBHOOK_PAYLOAD_MODE,
        lab_webhook_destination_config_patch,
    )

    out = lab_webhook_destination_config_patch({"url": "http://example/webhook"})
    assert out["payload_mode"] == LAB_WEBHOOK_PAYLOAD_MODE
    assert out["batch_size"] == LAB_WEBHOOK_BATCH_SIZE


def test_feeder_tick_rates_meet_minimum_throughput() -> None:
    rates = lab_feed_tick_rates(high_volume=True)
    assert rates["db_rows"] >= LAB_EPS_MIN
    assert rates["webhook_events"] >= LAB_EPS_MIN
    assert rates["s3_objects"] >= 1
    # Keep S3 feed small enough that MinIO list/get latency stays bounded.
    assert rates["s3_objects"] <= 40
    assert rates["remote_files"] >= 1
    # Retention caps must stay above one tick of S3 uploads so prune does not starve polls.
    from app.dev_validation_lab.lab_throughput_config import LAB_S3_FEED_MAX_OBJECTS

    assert LAB_S3_FEED_MAX_OBJECTS >= rates["s3_objects"]
    assert LAB_S3_FEED_MAX_OBJECTS <= 48


def test_s3_objects_per_tick_scales_with_tick_but_stays_bounded() -> None:
    from app.dev_validation_lab.lab_throughput_config import lab_feed_s3_objects_per_tick

    one = lab_feed_s3_objects_per_tick(tick_seconds=1.0)
    five = lab_feed_s3_objects_per_tick(tick_seconds=5.0)
    assert one >= 1
    assert five >= one
    assert one < 40



def test_lab_http_events_per_path_meet_minimum_eps() -> None:
    for path in (
        "/api/v1/lab-throughput/base-events",
        "/api/v1/lab-throughput/high-events",
        "/api/v1/lab-throughput/single-object",
        "/api/v1/lab-throughput/nested-array",
        "/api/v1/lab-throughput/okta-logs",
    ):
        events = lab_http_events_for_path(path)
        assert events >= LAB_EPS_MIN
