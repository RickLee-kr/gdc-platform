from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from app.runtime.errors import SourceFetchError
from app.sources.adapters.s3_object_polling import (
    S3ObjectPollingAdapter,
    _should_skip_object,
    _watermark_tuple,
    parse_s3_object_records,
)


def test_parse_ndjson_lines() -> None:
    body = b'{"id":"1","x":1}\n{"id":"2","x":2}\n'
    rows = parse_s3_object_records(body, object_key="k")
    assert [r["id"] for r in rows] == ["1", "2"]


def test_parse_json_array() -> None:
    body = b'[{"id":"a"},{"id":"b"}]'
    rows = parse_s3_object_records(body, object_key="k")
    assert [r["id"] for r in rows] == ["a", "b"]


def test_parse_json_object() -> None:
    body = b'{"id":"o","message":"m"}'
    rows = parse_s3_object_records(body, object_key="k")
    assert len(rows) == 1 and rows[0]["id"] == "o"


def test_parse_empty_object() -> None:
    assert parse_s3_object_records(b"", object_key="k") == []
    assert parse_s3_object_records(b"  \n\t\n", object_key="k") == []


def test_parse_lenient_ndjson_skips_bad_lines() -> None:
    body = b'{"id":"1"}\nnot-json\n{"id":"2"}\n'
    rows = parse_s3_object_records(body, object_key="k", lenient_ndjson=True)
    assert [r["id"] for r in rows] == ["1", "2"]


def test_parse_strict_ndjson_raises_on_bad_line() -> None:
    body = b'{"id":"1"}\nnot-json\n'
    with pytest.raises(SourceFetchError):
        parse_s3_object_records(body, object_key="k", lenient_ndjson=False)


def test_parse_json_array_rejects_non_object_items() -> None:
    with pytest.raises(SourceFetchError):
        parse_s3_object_records(b'[{"id":"a"},"x"]', object_key="k")


def test_parse_lenient_skips_non_object_ndjson_line() -> None:
    body = b'{"id":"1"}\n[1,2]\n{"id":"2"}\n'
    rows = parse_s3_object_records(body, object_key="k", lenient_ndjson=True)
    assert [r["id"] for r in rows] == ["1", "2"]


def test_watermark_tuple_prefers_top_level() -> None:
    cp = {
        "last_processed_key": "b",
        "last_processed_last_modified": "2020-01-02T00:00:00Z",
        "last_success_event": {"s3_key": "a", "s3_last_modified": "2020-01-01T00:00:00Z"},
    }
    lm, k = _watermark_tuple(cp)
    assert k == "b"
    assert lm is not None and lm.year == 2020 and lm.month == 1 and lm.day == 2


def test_watermark_from_last_success_event() -> None:
    cp = {"last_success_event": {"s3_key": "obj1", "s3_last_modified": "2021-06-15T12:00:00Z"}}
    lm, k = _watermark_tuple(cp)
    assert k == "obj1"
    assert lm is not None


def test_should_skip_object_same_tuple() -> None:
    lm = datetime(2022, 3, 4, 5, 6, 7, tzinfo=timezone.utc)
    assert _should_skip_object(lm, "k", lm, "k") is True


def test_should_skip_object_older() -> None:
    w = datetime(2022, 1, 1, tzinfo=timezone.utc)
    cur = datetime(2021, 12, 31, tzinfo=timezone.utc)
    assert _should_skip_object(cur, "z", w, "a") is True


def test_should_not_skip_newer() -> None:
    w = datetime(2022, 1, 1, tzinfo=timezone.utc)
    cur = datetime(2022, 1, 2, tzinfo=timezone.utc)
    assert _should_skip_object(cur, "a", w, "a") is False


def test_s3_adapter_fetch_merges_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    lm = datetime(2024, 5, 1, 10, 0, 0, tzinfo=timezone.utc)

    class _Body:
        def read(self) -> bytes:
            return b'{"id":"x","message":"hi","severity":"1"}\n'

    fake_client = MagicMock()
    fake_client.list_objects_v2.return_value = {
        "Contents": [{"Key": "security/a.ndjson", "LastModified": lm, "ETag": '"abc"', "Size": 12}],
        "IsTruncated": False,
    }
    fake_client.get_object.return_value = {"Body": _Body()}

    fake_session = MagicMock()
    fake_session.client.return_value = fake_client
    monkeypatch.setattr("app.sources.adapters.s3_object_polling.boto3.session.Session", lambda **kw: fake_session)

    adapter = S3ObjectPollingAdapter()
    out = adapter.fetch(
        {
            "endpoint_url": "http://127.0.0.1:9000",
            "bucket": "b1",
            "region": "us-east-1",
            "access_key": "k",
            "secret_key": "s",
            "prefix": "security/",
            "path_style_access": True,
            "use_ssl": False,
        },
        {"max_objects_per_run": 5},
        None,
    )
    assert isinstance(out, list) and len(out) == 1
    ev = out[0]
    assert ev["id"] == "x"
    assert ev["s3_bucket"] == "b1"
    assert ev["s3_key"] == "security/a.ndjson"
    assert ev["s3_etag"] == "abc"
    assert ev["s3_size"] == 12
    assert "s3_last_modified" in ev


def test_s3_adapter_respects_max_objects(monkeypatch: pytest.MonkeyPatch) -> None:
    lm = datetime(2024, 5, 1, 10, 0, 0, tzinfo=timezone.utc)

    class _Body:
        def read(self) -> bytes:
            return b'{"id":"1","message":"a","severity":"1"}'

    fake_client = MagicMock()
    fake_client.list_objects_v2.return_value = {
        "Contents": [
            {"Key": "p/a.json", "LastModified": lm, "ETag": '"1"', "Size": 1},
            {"Key": "p/b.json", "LastModified": lm, "ETag": '"2"', "Size": 1},
        ],
        "IsTruncated": False,
    }
    fake_client.get_object.return_value = {"Body": _Body()}
    fake_session = MagicMock()
    fake_session.client.return_value = fake_client
    monkeypatch.setattr("app.sources.adapters.s3_object_polling.boto3.session.Session", lambda **kw: fake_session)

    adapter = S3ObjectPollingAdapter()
    out = adapter.fetch(
        {
            "endpoint_url": "http://127.0.0.1:9000",
            "bucket": "b1",
            "region": "us-east-1",
            "access_key": "k",
            "secret_key": "s",
            "prefix": "p/",
            "path_style_access": True,
            "use_ssl": False,
        },
        {"max_objects_per_run": 1},
        None,
    )
    assert len(out) == 1
    assert fake_client.get_object.call_count == 1


def test_s3_adapter_max_objects_rollover(monkeypatch: pytest.MonkeyPatch) -> None:
    """After max_objects_per_run objects are fetched, remaining keys are not read."""

    lm = datetime(2024, 5, 1, 10, 0, 0, tzinfo=timezone.utc)

    class _Body:
        def read(self) -> bytes:
            return b'{"id":"1","message":"a","severity":"1"}'

    fake_client = MagicMock()
    fake_client.list_objects_v2.return_value = {
        "Contents": [
            {"Key": "p/a.json", "LastModified": lm, "ETag": '"1"', "Size": 1},
            {"Key": "p/b.json", "LastModified": lm, "ETag": '"2"', "Size": 1},
            {"Key": "p/c.json", "LastModified": lm, "ETag": '"3"', "Size": 1},
        ],
        "IsTruncated": False,
    }
    fake_client.get_object.return_value = {"Body": _Body()}
    fake_session = MagicMock()
    fake_session.client.return_value = fake_client
    monkeypatch.setattr("app.sources.adapters.s3_object_polling.boto3.session.Session", lambda **kw: fake_session)

    adapter = S3ObjectPollingAdapter()
    out = adapter.fetch(
        {
            "endpoint_url": "http://127.0.0.1:9000",
            "bucket": "b1",
            "region": "us-east-1",
            "access_key": "k",
            "secret_key": "s",
            "prefix": "p/",
            "path_style_access": True,
            "use_ssl": False,
        },
        {"max_objects_per_run": 2},
        None,
    )
    assert len(out) == 2
    assert fake_client.get_object.call_count == 2
