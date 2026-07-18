"""Lab throughput feeder helpers — retention/prune must prevent unbounded E2E storage."""

from __future__ import annotations

import inspect
from datetime import datetime, timedelta, timezone

from app.dev_validation_lab import lab_throughput_feeder as feeder
from app.dev_validation_lab.lab_throughput_config import (
    LAB_DB_FEED_MAX_ROWS,
    LAB_REMOTE_FEED_MAX_FILES,
    LAB_S3_FEED_MAX_OBJECTS,
)


def test_upload_remote_file_accepts_ndjson_and_json_density_parameters() -> None:
    params = inspect.signature(feeder._upload_remote_file).parameters
    assert "ndjson_lines_per_file" in params
    assert "json_events_per_file" in params


def test_e2e_feed_retention_caps_are_small() -> None:
    """E2E verifies flow; retained fixture objects/files/rows must stay bounded."""

    assert LAB_S3_FEED_MAX_OBJECTS <= 48
    assert LAB_REMOTE_FEED_MAX_FILES <= 48
    assert LAB_DB_FEED_MAX_ROWS <= 2000
    assert LAB_S3_FEED_MAX_OBJECTS >= 8
    assert LAB_REMOTE_FEED_MAX_FILES >= 8
    assert LAB_DB_FEED_MAX_ROWS >= 50


def test_prune_s3_lab_feed_objects_deletes_oldest() -> None:
    deleted: list[list[str]] = []
    old = datetime.now(timezone.utc) - timedelta(hours=1)

    class _FakeClient:
        def list_objects_v2(self, **kwargs: object) -> dict[str, object]:
            _ = kwargs
            return {
                "Contents": [
                    {"Key": "e2e-s3/lab-feed-old.ndjson", "LastModified": old},
                    {"Key": "e2e-s3/lab-feed-new.ndjson", "LastModified": old + timedelta(minutes=1)},
                    {"Key": "e2e-s3/lab-feed-newer.ndjson", "LastModified": old + timedelta(minutes=2)},
                ],
                "IsTruncated": False,
            }

        def delete_objects(self, **kwargs: object) -> None:
            objs = kwargs.get("Delete", {}).get("Objects", [])  # type: ignore[union-attr]
            deleted.append([str(o.get("Key")) for o in objs])

    n = feeder._prune_s3_lab_feed_objects(_FakeClient(), bucket="b", prefix="e2e-s3/", max_objects=2)
    assert n == 1
    assert deleted == [["e2e-s3/lab-feed-old.ndjson"]]


def test_prune_s3_lab_feed_objects_pages_through_inventory() -> None:
    deleted: list[str] = []
    old = datetime.now(timezone.utc) - timedelta(hours=1)
    pages = [
        {
            "Contents": [{"Key": f"p/lab-feed-{i}.ndjson", "LastModified": old + timedelta(seconds=i)} for i in range(3)],
            "IsTruncated": True,
            "NextContinuationToken": "t2",
        },
        {
            "Contents": [{"Key": f"p/lab-feed-{i}.ndjson", "LastModified": old + timedelta(seconds=i)} for i in range(3, 5)],
            "IsTruncated": False,
        },
    ]
    calls: list[dict[str, object]] = []

    class _FakeClient:
        def list_objects_v2(self, **kwargs: object) -> dict[str, object]:
            calls.append(dict(kwargs))
            idx = 0 if "ContinuationToken" not in kwargs else 1
            return pages[idx]

        def delete_objects(self, **kwargs: object) -> None:
            objs = kwargs.get("Delete", {}).get("Objects", [])  # type: ignore[union-attr]
            deleted.extend(str(o.get("Key")) for o in objs)

    n = feeder._prune_s3_lab_feed_objects(_FakeClient(), bucket="b", prefix="p/", max_objects=2)
    assert len(calls) == 2
    assert n == 3
    assert deleted == ["p/lab-feed-0.ndjson", "p/lab-feed-1.ndjson", "p/lab-feed-2.ndjson"]


def test_prune_s3_lab_feed_objects_noop_when_under_cap() -> None:
    class _FakeClient:
        def list_objects_v2(self, **kwargs: object) -> dict[str, object]:
            _ = kwargs
            return {"Contents": [{"Key": "p/lab-feed-1.ndjson"}], "IsTruncated": False}

        def delete_objects(self, **kwargs: object) -> None:  # pragma: no cover
            raise AssertionError("must not delete")

    assert feeder._prune_s3_lab_feed_objects(_FakeClient(), bucket="b", prefix="p/", max_objects=10) == 0


def test_prune_remote_lab_files_deletes_oldest(monkeypatch) -> None:
    removed: list[str] = []

    class _Attr:
        def __init__(self, name: str, mtime: float) -> None:
            self.filename = name
            self.st_mtime = mtime

    class _Sftp:
        def listdir_attr(self, path: str):
            _ = path
            return [
                _Attr("lab-old.ndjson", 1.0),
                _Attr("lab-mid.ndjson", 2.0),
                _Attr("lab-new.ndjson", 3.0),
                _Attr("other.txt", 0.0),
            ]

        def remove(self, path: str) -> None:
            removed.append(path)

        def close(self) -> None:
            return None

    class _Transport:
        def __init__(self, *_a, **_k) -> None:
            return None

        def connect(self, **_k) -> None:
            return None

        def close(self) -> None:
            return None

    class _Paramiko:
        Transport = _Transport

        class SFTPClient:
            @staticmethod
            def from_transport(_t):
                return _Sftp()

    monkeypatch.setitem(__import__("sys").modules, "paramiko", _Paramiko)

    n = feeder._prune_remote_lab_files(
        host="h",
        port=22,
        username="u",
        password="p",
        remote_directory="upload",
        file_pattern_prefix="lab-",
        max_files=2,
    )
    assert n == 1
    assert removed == ["upload/lab-old.ndjson"]


def test_prune_fixture_db_rows_deletes_below_cutoff(monkeypatch) -> None:
    executed: list[tuple[str, dict[str, object]]] = []

    class _Result:
        def __init__(self, row=None, rowcount: int = 0) -> None:
            self._row = row
            self.rowcount = rowcount

        def fetchone(self):
            return self._row

    class _Conn:
        def execute(self, stmt, params=None):
            sql = str(stmt)
            executed.append((sql, dict(params or {})))
            if "OFFSET" in sql.upper():
                return _Result(row=(10,))
            return _Result(rowcount=7)

        def __enter__(self):
            return self

        def __exit__(self, *_a):
            return False

    class _Engine:
        def begin(self):
            return _Conn()

    monkeypatch.setattr(
        "sqlalchemy.create_engine",
        lambda *a, **k: _Engine(),
    )

    n = feeder._prune_fixture_db_rows("postgresql://u:p@localhost/db", table="security_events", max_rows=5)
    assert n == 7
    assert any("DELETE FROM security_events" in sql for sql, _ in executed)
    assert any(params.get("cutoff") == 10 for _, params in executed)


def test_run_lab_throughput_feed_tick_uploads_remote_files(monkeypatch) -> None:
    captured: list[dict[str, int]] = []

    def _fake_upload_remote_file(*args, **kwargs) -> None:
        captured.append(
            {
                "count": int(kwargs.get("count") or 0),
                "ndjson_lines": int(kwargs.get("ndjson_lines_per_file") or 0),
                "json_events": int(kwargs.get("json_events_per_file") or 0),
            }
        )

    monkeypatch.setattr(feeder, "_insert_postgres_rows", lambda *a, **k: None)
    monkeypatch.setattr(feeder, "_insert_mysql_rows", lambda *a, **k: None)
    monkeypatch.setattr(feeder, "_upload_s3_ndjson", lambda *a, **k: None)
    monkeypatch.setattr(feeder, "_upload_remote_file", _fake_upload_remote_file)
    monkeypatch.setattr(feeder, "_post_webhook_events", lambda *a, **k: None)
    monkeypatch.setattr(feeder, "_maybe_prune_s3_buckets", lambda *a, **k: None)
    monkeypatch.setattr(feeder, "_maybe_prune_remote_hosts", lambda *a, **k: None)
    monkeypatch.setattr(feeder, "_maybe_prune_fixture_databases", lambda *a, **k: None)
    monkeypatch.setattr(
        feeder,
        "_load_feeder_env",
        lambda: feeder.FeederEnv(
            api_base_url="http://127.0.0.1:8000",
            wiremock_base_url="http://127.0.0.1:8080",
            minio_endpoint="http://127.0.0.1:9000",
            minio_bucket_visible="bucket-visible",
            minio_bucket_validation="bucket-validation",
            minio_access_key="key",
            minio_secret_key="secret",
            minio_prefix_visible="e2e-s3/",
            minio_prefix_validation="security/",
            pg_fixture_url="postgresql://u:p@localhost/db",
            mysql_fixture_url="mysql://u:p@localhost/db",
            mariadb_fixture_url="mysql://u:p@localhost/db",
            sftp_host="sftp",
            sftp_port=22,
            sftp_user="user",
            sftp_password="pass",
            scp_host="scp",
            scp_port=22,
            scp_user="user",
            scp_password="pass",
        ),
    )

    feeder.run_lab_throughput_feed_tick(high_volume=True)
    assert captured
    assert max(row["count"] for row in captured) >= 1
    assert max(row["ndjson_lines"] for row in captured) >= 3
