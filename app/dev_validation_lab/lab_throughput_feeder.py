"""Continuous fixture feeder for dev-validation / visible E2E lab throughput."""

from __future__ import annotations

import json
import logging
import os
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Any

import httpx

from app.dev_validation_lab.lab_throughput_config import (
    LAB_DB_FEED_MAX_ROWS,
    LAB_REMOTE_FEED_MAX_FILES,
    LAB_S3_FEED_MAX_OBJECTS,
    LAB_S3_LINES_PER_OBJECT,
    LAB_S3_VALIDATION_ACTIVE_PREFIX,
    LAB_S3_VISIBLE_ACTIVE_PREFIX,
    lab_feed_tick_rates,
)
from app.dev_validation_lab.visible_e2e_seed import (
    VISIBLE_E2E_WEBHOOK_RECEIVER_KEY,
    VISIBLE_E2E_WEBHOOK_SHARED_SECRET,
)

logger = logging.getLogger(__name__)

_FEEDER_THREAD: threading.Thread | None = None
_FEEDER_STOP = threading.Event()
_SEQ = 0
_SEQ_LOCK = threading.Lock()
_FEEDER_TICK_COUNT = 0
# Default: prune every tick so E2E fixture storage cannot grow unbounded.
_S3_PRUNE_EVERY_TICKS = max(
    1,
    int(os.environ.get("LAB_S3_PRUNE_EVERY_TICKS", "1") or "1"),
)
_S3_PRUNE_BATCH_DELETE = max(
    100,
    int(os.environ.get("LAB_S3_PRUNE_BATCH_DELETE", "5000") or "5000"),
)
_REMOTE_PRUNE_EVERY_TICKS = max(
    1,
    int(os.environ.get("LAB_REMOTE_PRUNE_EVERY_TICKS", "1") or "1"),
)
_DB_PRUNE_EVERY_TICKS = max(
    1,
    int(os.environ.get("LAB_DB_PRUNE_EVERY_TICKS", "5") or "5"),
)
_WIREMOCK_RESYNC_EVERY_TICKS = max(
    1,
    int(os.environ.get("LAB_WIREMOCK_RESYNC_EVERY_TICKS", "300") or "300"),
)


def lab_throughput_feeder_enabled() -> bool:
    if (os.environ.get("SKIP_LAB_THROUGHPUT_FEEDER") or "").strip() == "1":
        return False
    from app.dev_validation_lab.seeder import lab_effective

    if not lab_effective():
        return False
    from app.config import settings

    return bool(getattr(settings, "ENABLE_LAB_THROUGHPUT_FEEDER", True))


def _next_seq() -> int:
    global _SEQ
    with _SEQ_LOCK:
        _SEQ += 1
        return _SEQ


@dataclass(frozen=True, slots=True)
class FeederEnv:
    api_base_url: str
    wiremock_base_url: str
    minio_endpoint: str
    minio_bucket_visible: str
    minio_bucket_validation: str
    minio_access_key: str
    minio_secret_key: str
    minio_prefix_visible: str
    minio_prefix_validation: str
    pg_fixture_url: str
    mysql_fixture_url: str
    mariadb_fixture_url: str
    sftp_host: str
    sftp_port: int
    sftp_user: str
    sftp_password: str
    scp_host: str
    scp_port: int
    scp_user: str
    scp_password: str


def _load_feeder_env() -> FeederEnv:
    from app.config import settings

    default_api = "http://127.0.0.1:8000"
    if bool(getattr(settings, "GDC_RUNTIME_IN_CONTAINER", False)):
        default_api = "http://api:8000"
    api = (os.environ.get("LAB_THROUGHPUT_API_BASE_URL") or default_api).rstrip("/")
    pg = (
        os.environ.get("SOURCE_E2E_PG_FIXTURE_URL")
        or f"postgresql://gdc_fixture:gdc_fixture_pw@{settings.DEV_VALIDATION_PG_QUERY_HOST}:{int(settings.DEV_VALIDATION_PG_QUERY_PORT)}/gdc_query_fixture"
    )
    my_host = str(settings.DEV_VALIDATION_MYSQL_QUERY_HOST).strip()
    my_port = int(settings.DEV_VALIDATION_MYSQL_QUERY_PORT)
    ma_host = str(settings.DEV_VALIDATION_MARIADB_QUERY_HOST).strip()
    ma_port = int(settings.DEV_VALIDATION_MARIADB_QUERY_PORT)
    visible_bucket = (os.environ.get("SOURCE_E2E_MINIO_BUCKET") or "gdc-source-e2e").strip()
    validation_bucket = str(settings.MINIO_BUCKET).strip() or "gdc-test-logs"
    return FeederEnv(
        api_base_url=api,
        wiremock_base_url=str(settings.DEV_VALIDATION_WIREMOCK_BASE_URL).rstrip("/"),
        minio_endpoint=str(settings.MINIO_ENDPOINT).rstrip("/"),
        minio_bucket_visible=visible_bucket,
        minio_bucket_validation=validation_bucket,
        minio_access_key=str(settings.MINIO_ACCESS_KEY).strip(),
        minio_secret_key=str(settings.MINIO_SECRET_KEY).strip(),
        minio_prefix_visible=LAB_S3_VISIBLE_ACTIVE_PREFIX,
        minio_prefix_validation=LAB_S3_VALIDATION_ACTIVE_PREFIX,
        pg_fixture_url=pg,
        mysql_fixture_url=f"mysql+pymysql://gdc_fixture:gdc_fixture_pw@{my_host}:{my_port}/gdc_query_fixture",
        mariadb_fixture_url=f"mysql+pymysql://gdc_fixture:gdc_fixture_pw@{ma_host}:{ma_port}/gdc_query_fixture",
        sftp_host=str(settings.DEV_VALIDATION_SFTP_HOST).strip(),
        sftp_port=int(settings.DEV_VALIDATION_SFTP_PORT),
        sftp_user=str(settings.DEV_VALIDATION_SFTP_USER).strip(),
        sftp_password=str(settings.DEV_VALIDATION_SFTP_PASSWORD or "").strip(),
        scp_host=str(settings.DEV_VALIDATION_SSH_SCP_HOST).strip(),
        scp_port=int(settings.DEV_VALIDATION_SSH_SCP_PORT),
        scp_user=str(settings.DEV_VALIDATION_SSH_SCP_USER).strip(),
        scp_password=str(settings.DEV_VALIDATION_SSH_SCP_PASSWORD or "").strip(),
    )


def _lab_dispatch_chunk_size() -> int:
    from app.config import settings

    return max(1, int(getattr(settings, "GDC_LAB_FEED_DISPATCH_CHUNK_SIZE", 25) or 25))


def _insert_postgres_rows(url: str, *, table: str, count: int) -> None:
    """Insert fixture rows in small chunks then discard (bounded feeder RAM)."""

    if count <= 0:
        return
    chunk = _lab_dispatch_chunk_size()
    remaining = int(count)
    while remaining > 0:
        n = min(chunk, remaining)
        _insert_postgres_rows_chunk(url, table=table, count=n)
        remaining -= n


def _insert_postgres_rows_chunk(url: str, *, table: str, count: int) -> None:
    if count <= 0:
        return
    try:
        from sqlalchemy import create_engine, text

        engine = create_engine(url, pool_pre_ping=True)
        now = datetime.now(timezone.utc).isoformat()
        seq = _next_seq()
        if table == "source_e2e_rows":
            payload = [
                {
                    "event_id": f"lab-src-{seq}-{i}-{uuid.uuid4().hex[:8]}",
                    "message": f"lab feeder {seq}-{i}",
                    "severity": "low",
                    "event_ts": now,
                    "ordering_seq": seq * 100 + i,
                }
                for i in range(count)
            ]
            stmt = text(
                "INSERT INTO source_e2e_rows (event_id, message, severity, event_ts, ordering_seq) "
                "VALUES (:event_id, :message, :severity, :event_ts, :ordering_seq)"
            )
        else:
            payload = [
                {
                    "event_id": f"lab-feed-{seq}-{i}-{uuid.uuid4().hex[:8]}",
                    "message": f"lab feeder {seq}-{i}",
                    "severity": "info",
                }
                for i in range(count)
            ]
            stmt = text(
                f"INSERT INTO {table} (event_id, message, severity) "
                "VALUES (:event_id, :message, :severity)"
            )
        with engine.begin() as conn:
            conn.execute(stmt, payload)
        del payload
    except Exception as exc:
        logger.debug(
            "%s",
            {"stage": "lab_throughput_feed_pg_failed", "table": table, "error_type": type(exc).__name__, "message": str(exc)},
        )


def _insert_mysql_rows(url: str, *, count: int) -> None:
    if count <= 0:
        return
    chunk = _lab_dispatch_chunk_size()
    remaining = int(count)
    while remaining > 0:
        n = min(chunk, remaining)
        _insert_mysql_rows_chunk(url, count=n)
        remaining -= n


def _insert_mysql_rows_chunk(url: str, *, count: int) -> None:
    if count <= 0:
        return
    try:
        from sqlalchemy import create_engine, text

        engine = create_engine(url, pool_pre_ping=True)
        seq = _next_seq()
        payload = [
            {
                "event_id": f"lab-feed-{seq}-{i}-{uuid.uuid4().hex[:8]}",
                "message": f"lab feeder {seq}-{i}",
                "severity": "info",
            }
            for i in range(count)
        ]
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO security_events (event_id, message, severity) "
                    "VALUES (:event_id, :message, :severity)"
                ),
                payload,
            )
        del payload
    except Exception as exc:
        logger.debug(
            "%s",
            {"stage": "lab_throughput_feed_mysql_failed", "error_type": type(exc).__name__, "message": str(exc)},
        )


def _s3_client(env: FeederEnv):
    import boto3
    from botocore.client import Config as BotoConfig

    session = boto3.session.Session(
        aws_access_key_id=env.minio_access_key,
        aws_secret_access_key=env.minio_secret_key,
        region_name="us-east-1",
    )
    return session.client(
        "s3",
        endpoint_url=env.minio_endpoint,
        use_ssl=env.minio_endpoint.lower().startswith("https://"),
        config=BotoConfig(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def _prune_s3_lab_feed_objects(client: Any, *, bucket: str, prefix: str, max_objects: int) -> int:
    """Keep at most ``max_objects`` lab-feed-* keys under prefix; delete oldest excess.

    Pages through ListObjects so large historical backlogs are drained across ticks
    (bounded by ``_S3_PRUNE_BATCH_DELETE`` per call). Returns number of keys deleted.
    """

    feed_prefix = f"{prefix}lab-feed-"
    keep = max(1, int(max_objects))
    deleted_total = 0
    try:
        contents: list[dict[str, Any]] = []
        token: str | None = None
        while True:
            kwargs: dict[str, Any] = {"Bucket": bucket, "Prefix": feed_prefix, "MaxKeys": 1000}
            if token:
                kwargs["ContinuationToken"] = token
            resp = client.list_objects_v2(**kwargs)
            contents.extend(list(resp.get("Contents") or []))
            if not resp.get("IsTruncated"):
                break
            token = resp.get("NextContinuationToken")
            if not token:
                break
            # Bound inventory work per prune call; remaining pages drain on later ticks.
            if len(contents) >= keep + _S3_PRUNE_BATCH_DELETE:
                break
        if len(contents) <= keep:
            return 0
        contents.sort(
            key=lambda item: (
                item.get("LastModified") is None,
                item.get("LastModified"),
                str(item.get("Key") or ""),
            )
        )
        excess = min(_S3_PRUNE_BATCH_DELETE, len(contents) - keep)
        if excess <= 0:
            return 0
        to_delete = [str(item.get("Key") or "") for item in contents[:excess] if str(item.get("Key") or "")]
        for i in range(0, len(to_delete), 1000):
            chunk = to_delete[i : i + 1000]
            client.delete_objects(
                Bucket=bucket,
                Delete={"Objects": [{"Key": key} for key in chunk], "Quiet": True},
            )
            deleted_total += len(chunk)
        if deleted_total:
            logger.info(
                "%s",
                {
                    "stage": "lab_throughput_feed_s3_pruned",
                    "bucket": bucket,
                    "prefix": feed_prefix,
                    "deleted": deleted_total,
                    "retained_cap": keep,
                },
            )
    except Exception as exc:
        logger.debug(
            "%s",
            {
                "stage": "lab_throughput_feed_s3_prune_failed",
                "bucket": bucket,
                "prefix": feed_prefix,
                "error_type": type(exc).__name__,
                "message": str(exc),
            },
        )
    return deleted_total


def _prune_remote_lab_files(
    *,
    host: str,
    port: int,
    username: str,
    password: str,
    remote_directory: str,
    file_pattern_prefix: str,
    max_files: int,
) -> int:
    """Keep at most ``max_files`` lab-* files under remote_directory; delete oldest excess."""

    if not password:
        return 0
    keep = max(1, int(max_files))
    deleted = 0
    try:
        import paramiko

        transport = paramiko.Transport((host, int(port)))
        transport.connect(username=username, password=password)
        sftp = paramiko.SFTPClient.from_transport(transport)
        assert sftp is not None
        try:
            entries = []
            for attr in sftp.listdir_attr(remote_directory):
                name = str(getattr(attr, "filename", "") or "")
                if not name.startswith(file_pattern_prefix):
                    continue
                mtime = float(getattr(attr, "st_mtime", 0) or 0)
                entries.append((mtime, name))
            if len(entries) <= keep:
                return 0
            entries.sort(key=lambda item: (item[0], item[1]))
            for _, name in entries[: len(entries) - keep]:
                remote_path = f"{remote_directory.rstrip('/')}/{name}"
                try:
                    sftp.remove(remote_path)
                    deleted += 1
                except Exception:
                    pass
        finally:
            sftp.close()
            transport.close()
        if deleted:
            logger.info(
                "%s",
                {
                    "stage": "lab_throughput_feed_remote_pruned",
                    "host": host,
                    "directory": remote_directory,
                    "deleted": deleted,
                    "retained_cap": keep,
                },
            )
    except Exception as exc:
        logger.debug(
            "%s",
            {
                "stage": "lab_throughput_feed_remote_prune_failed",
                "host": host,
                "error_type": type(exc).__name__,
                "message": str(exc),
            },
        )
    return deleted


def _prune_fixture_db_rows(url: str, *, table: str, max_rows: int, dialect: str = "postgres") -> int:
    """Keep newest ``max_rows`` in a fixture table; delete older rows by id.

    Fixture DBs exist only to feed E2E polling — not to archive events.
    """

    _ = dialect
    keep = max(1, int(max_rows))
    try:
        from sqlalchemy import create_engine, text

        engine = create_engine(url, pool_pre_ping=True)
        with engine.begin() as conn:
            cutoff = conn.execute(
                text(f"SELECT id FROM {table} ORDER BY id DESC LIMIT 1 OFFSET :keep"),
                {"keep": keep},
            ).fetchone()
            if cutoff is None:
                return 0
            result = conn.execute(
                text(f"DELETE FROM {table} WHERE id <= :cutoff"),
                {"cutoff": int(cutoff[0])},
            )
            deleted = int(result.rowcount or 0)
            if deleted:
                logger.info(
                    "%s",
                    {
                        "stage": "lab_throughput_feed_db_pruned",
                        "table": table,
                        "deleted": deleted,
                        "retained_cap": keep,
                    },
                )
            return deleted
    except Exception as exc:
        logger.debug(
            "%s",
            {
                "stage": "lab_throughput_feed_db_prune_failed",
                "table": table,
                "error_type": type(exc).__name__,
                "message": str(exc),
            },
        )
        return 0


def _maybe_prune_s3_buckets(env: FeederEnv) -> None:
    if _FEEDER_TICK_COUNT % _S3_PRUNE_EVERY_TICKS != 0:
        return
    if not env.minio_access_key or not env.minio_secret_key:
        return
    try:
        client = _s3_client(env)
        for bucket, prefix in (
            (env.minio_bucket_visible, env.minio_prefix_visible),
            (env.minio_bucket_validation, env.minio_prefix_validation),
        ):
            if not bucket:
                continue
            _prune_s3_lab_feed_objects(
                client,
                bucket=bucket,
                prefix=prefix,
                max_objects=LAB_S3_FEED_MAX_OBJECTS,
            )
    except Exception as exc:
        logger.debug(
            "%s",
            {
                "stage": "lab_throughput_feed_s3_prune_tick_failed",
                "error_type": type(exc).__name__,
                "message": str(exc),
            },
        )


def _maybe_prune_remote_hosts(env: FeederEnv) -> None:
    if _FEEDER_TICK_COUNT % _REMOTE_PRUNE_EVERY_TICKS != 0:
        return
    if env.sftp_password:
        _prune_remote_lab_files(
            host=env.sftp_host,
            port=env.sftp_port,
            username=env.sftp_user,
            password=env.sftp_password,
            remote_directory="upload",
            file_pattern_prefix="lab-",
            max_files=LAB_REMOTE_FEED_MAX_FILES,
        )
    if env.scp_password:
        _prune_remote_lab_files(
            host=env.scp_host,
            port=env.scp_port,
            username=env.scp_user,
            password=env.scp_password,
            remote_directory="upload",
            file_pattern_prefix="lab-",
            max_files=LAB_REMOTE_FEED_MAX_FILES,
        )


def _maybe_prune_fixture_databases(env: FeederEnv) -> None:
    if _FEEDER_TICK_COUNT % _DB_PRUNE_EVERY_TICKS != 0:
        return
    for url, table, dialect in (
        (env.pg_fixture_url, "security_events", "postgres"),
        (env.pg_fixture_url, "source_e2e_rows", "postgres"),
        (env.mysql_fixture_url, "security_events", "mysql"),
        (env.mariadb_fixture_url, "security_events", "mysql"),
    ):
        _prune_fixture_db_rows(url, table=table, max_rows=LAB_DB_FEED_MAX_ROWS, dialect=dialect)


def _upload_s3_ndjson(env: FeederEnv, *, bucket: str, prefix: str, count: int) -> None:
    """Upload ``count`` NDJSON objects into one bucket/prefix only (never cross-upload)."""

    if count <= 0 or not bucket or not env.minio_access_key or not env.minio_secret_key:
        return
    try:
        client = _s3_client(env)
        try:
            client.create_bucket(Bucket=bucket)
        except Exception:
            pass
        seq = _next_seq()
        # Timestamp prefix keeps ListObjects StartAfter monotonic across feeder restarts
        # (plain ``seq`` alone reset to 1 and sorted *before* prior checkpoints → 0 EPS).
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
        for i in range(count):
            key = f"{prefix}lab-feed-{ts}-{seq:08d}-{i}-{uuid.uuid4().hex[:8]}.ndjson"
            lines = [
                json.dumps(
                    {"id": f"s3-{seq}-{i}", "message": f"s3 lab feed {seq}-{i}", "severity": "info"}
                )
            ]
            # LAB_S3_LINES_PER_OBJECT total lines (1 header + remaining).
            for j in range(max(0, int(LAB_S3_LINES_PER_OBJECT) - 1)):
                lines.append(
                    json.dumps(
                        {
                            "id": f"s3-{seq}-{i}-line-{j}",
                            "message": "ndjson line",
                            "severity": "low",
                        }
                    )
                )
            body = ("\n".join(lines)).encode()
            client.put_object(Bucket=bucket, Key=key, Body=body, ContentType="application/x-ndjson")
    except Exception as exc:
        logger.debug(
            "%s",
            {
                "stage": "lab_throughput_feed_s3_failed",
                "bucket": bucket,
                "prefix": prefix,
                "error_type": type(exc).__name__,
                "message": str(exc),
            },
        )


def _upload_remote_file(
    env: FeederEnv,
    *,
    host: str,
    port: int,
    username: str,
    password: str,
    remote_directory: str,
    file_pattern_prefix: str,
    parser_suffix: str,
    count: int,
    ndjson_lines_per_file: int = 3,
    json_events_per_file: int = 1,
) -> None:
    if count <= 0 or not password:
        return
    try:
        import paramiko

        seq = _next_seq()
        transport = paramiko.Transport((host, int(port)))
        transport.connect(username=username, password=password)
        sftp = paramiko.SFTPClient.from_transport(transport)
        assert sftp is not None
        try:
            for i in range(count):
                name = f"{file_pattern_prefix}{seq}-{i}-{uuid.uuid4().hex[:6]}{parser_suffix}"
                remote_path = f"{remote_directory.rstrip('/')}/{name}"
                if parser_suffix == ".json":
                    events_in_file = max(1, int(json_events_per_file))
                    payload = json.dumps(
                        [
                            {
                                "id": f"scp-{seq}-{i}-{j}",
                                "message": "lab scp feed",
                                "severity": "info",
                            }
                            for j in range(events_in_file)
                        ]
                    ).encode()
                else:
                    line_count = max(1, int(ndjson_lines_per_file))
                    lines = [
                        json.dumps({"id": f"rf-{seq}-{i}-{j}", "message": "lab rf feed", "severity": "info"})
                        for j in range(line_count)
                    ]
                    payload = ("\n".join(lines) + "\n").encode()
                with sftp.file(remote_path, "w") as fh:
                    fh.write(payload)
        finally:
            sftp.close()
            transport.close()
    except Exception as exc:
        logger.debug(
            "%s",
            {"stage": "lab_throughput_feed_remote_failed", "error_type": type(exc).__name__, "message": str(exc)},
        )


def _deliver_webhook_lab_events(*, count: int) -> None:
    """Run webhook lab events through StreamRunner in small chunks (fetch/send/discard)."""

    if count <= 0:
        return
    chunk = _lab_dispatch_chunk_size()
    remaining = int(count)
    while remaining > 0:
        n = min(chunk, remaining)
        _deliver_webhook_lab_events_chunk(count=n)
        remaining -= n


def _deliver_webhook_lab_events_chunk(*, count: int) -> None:
    if count <= 0:
        return
    seq = _next_seq()
    payload = [
        {
            "id": f"wh-{seq}-{i}-{uuid.uuid4().hex[:8]}",
            "message": f"lab webhook feed {seq}-{i}",
            "severity": "LOW",
        }
        for i in range(count)
    ]
    body = json.dumps(payload).encode("utf-8")
    del payload
    try:
        from app.database import SessionLocal
        from app.runners.webhook_receiver import WebhookReceiver

        db = SessionLocal()
        try:
            WebhookReceiver().dispatch(
                db,
                receiver_key=VISIBLE_E2E_WEBHOOK_RECEIVER_KEY,
                headers={
                    "Content-Type": "application/json",
                    "X-GDC-Webhook-Secret": VISIBLE_E2E_WEBHOOK_SHARED_SECRET,
                },
                body=body,
                content_type="application/json",
            )
            db.commit()
        finally:
            db.close()
            del body
    except Exception as exc:
        logger.debug(
            "%s",
            {"stage": "lab_throughput_feed_webhook_error", "error_type": type(exc).__name__, "message": str(exc)},
        )


def _post_webhook_events(env: FeederEnv, *, count: int) -> None:
    _ = env
    _deliver_webhook_lab_events(count=count)


def run_lab_throughput_feed_tick(*, high_volume: bool = True) -> None:
    """One feeder cycle: DB rows, S3 objects, remote files, webhook events."""

    global _FEEDER_TICK_COUNT
    from concurrent.futures import ThreadPoolExecutor

    from app.dev_validation_lab.lab_resource_guardrail import lab_generation_should_pause

    paused, pause_reason = lab_generation_should_pause()
    if paused:
        logger.warning(
            "%s",
            {
                "stage": "lab_throughput_feeder_paused",
                "reason": pause_reason,
                "message": "skipping lab fixture generation; core platform unaffected",
            },
        )
        return

    _FEEDER_TICK_COUNT += 1
    env = _load_feeder_env()
    tick = max(0.5, float(os.environ.get("LAB_THROUGHPUT_FEEDER_TICK_SECONDS", "1") or "1"))
    rates = lab_feed_tick_rates(high_volume=high_volume, tick_seconds=tick)
    db_rows = int(rates["db_rows"])
    s3_count = int(rates["s3_objects"])
    rf_count = int(rates["remote_files"])
    wh_count = int(rates["webhook_events"])
    ndjson_lines = int(rates["remote_ndjson_lines_per_file"])
    json_events = int(rates["remote_json_events_per_file"])

    _insert_postgres_rows(env.pg_fixture_url, table="security_events", count=db_rows)
    _insert_postgres_rows(env.pg_fixture_url, table="source_e2e_rows", count=db_rows)

    with ThreadPoolExecutor(max_workers=6) as pool:
        wh_future = pool.submit(_post_webhook_events, env, count=wh_count)
        bg_futures = [
            pool.submit(_insert_mysql_rows, env.mysql_fixture_url, count=db_rows),
            pool.submit(_insert_mysql_rows, env.mariadb_fixture_url, count=db_rows),
            pool.submit(
                _upload_s3_ndjson,
                env,
                bucket=env.minio_bucket_visible,
                prefix=env.minio_prefix_visible,
                count=s3_count,
            ),
            pool.submit(
                _upload_s3_ndjson,
                env,
                bucket=env.minio_bucket_validation,
                prefix=env.minio_prefix_validation,
                count=s3_count,
            ),
        ]
        if env.sftp_password:
            bg_futures.append(
                pool.submit(
                    _upload_remote_file,
                    env,
                    host=env.sftp_host,
                    port=env.sftp_port,
                    username=env.sftp_user,
                    password=env.sftp_password,
                    remote_directory="upload",
                    file_pattern_prefix="lab-",
                    parser_suffix=".ndjson",
                    count=rf_count,
                    ndjson_lines_per_file=ndjson_lines,
                )
            )
        if env.scp_password:
            bg_futures.append(
                pool.submit(
                    _upload_remote_file,
                    env,
                    host=env.scp_host,
                    port=env.scp_port,
                    username=env.scp_user,
                    password=env.scp_password,
                    remote_directory="upload",
                    file_pattern_prefix="lab-",
                    parser_suffix=".json",
                    count=rf_count,
                    json_events_per_file=json_events,
                )
            )
        wh_future.result(timeout=90)
        for fut in bg_futures:
            try:
                fut.result(timeout=0.1)
            except Exception:
                pass
    # Retention: E2E fixtures are for flow verification only — prune after each tick.
    _maybe_prune_s3_buckets(env)
    _maybe_prune_remote_hosts(env)
    _maybe_prune_fixture_databases(env)


def _maybe_resync_lab_wiremock_stubs() -> None:
    if _FEEDER_TICK_COUNT % _WIREMOCK_RESYNC_EVERY_TICKS != 0:
        return
    try:
        from app.dev_validation_lab.runtime import sync_lab_wiremock_throughput_stubs

        sync_lab_wiremock_throughput_stubs()
    except Exception as exc:  # pragma: no cover - fail-open
        logger.debug(
            "%s",
            {
                "stage": "lab_throughput_feeder_wiremock_resync_failed",
                "error_type": type(exc).__name__,
                "message": str(exc),
            },
        )


def _feeder_loop() -> None:
    tick = max(0.5, float(os.environ.get("LAB_THROUGHPUT_FEEDER_TICK_SECONDS", "1") or "1"))
    from app.config import settings

    pause_backoff = float(getattr(settings, "GDC_LAB_PAUSE_BACKOFF_SECONDS", 30.0) or 30.0)
    logger.info(
        "%s",
        {
            "stage": "lab_throughput_feeder_started",
            "tick_seconds": tick,
            "s3_feed_max_objects": LAB_S3_FEED_MAX_OBJECTS,
            "remote_feed_max_files": LAB_REMOTE_FEED_MAX_FILES,
            "db_feed_max_rows": LAB_DB_FEED_MAX_ROWS,
            "s3_prune_every_ticks": _S3_PRUNE_EVERY_TICKS,
        },
    )
    while not _FEEDER_STOP.is_set():
        try:
            from app.dev_validation_lab.lab_resource_guardrail import lab_generation_should_pause

            paused, pause_reason = lab_generation_should_pause()
            if paused:
                logger.warning(
                    "%s",
                    {
                        "stage": "lab_throughput_feeder_budget_paused",
                        "reason": pause_reason,
                        "backoff_seconds": pause_backoff,
                    },
                )
                _FEEDER_STOP.wait(timeout=pause_backoff)
                continue
            run_lab_throughput_feed_tick(high_volume=True)
            _maybe_resync_lab_wiremock_stubs()
        except Exception as exc:  # pragma: no cover - fail-open
            logger.warning(
                "%s",
                {"stage": "lab_throughput_feeder_tick_failed", "error_type": type(exc).__name__, "message": str(exc)},
            )
        _FEEDER_STOP.wait(timeout=tick)
    logger.info("%s", {"stage": "lab_throughput_feeder_stopped"})


def start_lab_throughput_feeder_background() -> bool:
    """Start daemon thread feeder (idempotent)."""

    global _FEEDER_THREAD
    if not lab_throughput_feeder_enabled():
        logger.info("%s", {"stage": "lab_throughput_feeder_skipped", "reason": "disabled"})
        return False
    if _FEEDER_THREAD is not None and _FEEDER_THREAD.is_alive():
        return True
    _FEEDER_STOP.clear()
    _FEEDER_THREAD = threading.Thread(target=_feeder_loop, name="lab-throughput-feeder", daemon=True)
    _FEEDER_THREAD.start()
    return True


def stop_lab_throughput_feeder_background() -> None:
    global _FEEDER_THREAD
    _FEEDER_STOP.set()
    if _FEEDER_THREAD is not None and _FEEDER_THREAD.is_alive():
        _FEEDER_THREAD.join(timeout=5.0)
    _FEEDER_THREAD = None


def main() -> int:
    import argparse

    p = argparse.ArgumentParser(description="Run continuous lab throughput feeder (foreground).")
    p.add_argument("--once", action="store_true", help="Run a single tick and exit.")
    p.add_argument("--tick-seconds", type=float, default=1.0)
    args = p.parse_args()
    if args.once:
        run_lab_throughput_feed_tick(high_volume=True)
        return 0
    _FEEDER_STOP.clear()
    os.environ["LAB_THROUGHPUT_FEEDER_TICK_SECONDS"] = str(args.tick_seconds)
    _feeder_loop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
