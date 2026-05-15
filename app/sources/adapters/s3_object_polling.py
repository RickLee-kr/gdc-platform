"""S3-compatible object polling (MinIO, AWS S3) — list objects, fetch bodies, emit record events."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

import boto3
from botocore.client import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError

from app.runtime.errors import SourceFetchError
from app.sources.adapters.base import SourceAdapter

logger = logging.getLogger(__name__)


def _get(data: Any, key: str, default: Any = None) -> Any:
    if isinstance(data, dict):
        return data.get(key, default)
    return getattr(data, key, default)


def _iso_utc(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_iso_dt(value: str | None) -> datetime | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s)


def _watermark_tuple(checkpoint: dict[str, Any] | None) -> tuple[datetime | None, str | None]:
    """Resolve (last_modified, object_key) watermark from persisted checkpoint shape."""

    if not isinstance(checkpoint, dict):
        return None, None
    lk = checkpoint.get("last_processed_key")
    llm = checkpoint.get("last_processed_last_modified")
    if lk is not None or llm is not None:
        return _parse_iso_dt(str(llm) if llm is not None else None), str(lk) if lk is not None else None
    last = checkpoint.get("last_success_event")
    if isinstance(last, dict):
        sk = last.get("s3_key")
        slm = last.get("s3_last_modified")
        return _parse_iso_dt(str(slm) if slm is not None else None), str(sk) if sk is not None else None
    return None, None


def _object_tuple(last_modified: datetime, key: str) -> tuple[datetime, str]:
    lm = last_modified
    if lm.tzinfo is None:
        lm = lm.replace(tzinfo=timezone.utc)
    return lm.astimezone(timezone.utc), key


def _should_skip_object(last_modified: datetime, key: str, w_lm: datetime | None, w_key: str | None) -> bool:
    if w_lm is None or w_key is None:
        return False
    cur = _object_tuple(last_modified, key)
    w = (w_lm.astimezone(timezone.utc), w_key)
    return cur <= w


def parse_s3_object_records(
    body: bytes, *, object_key: str, lenient_ndjson: bool = True
) -> list[dict[str, Any]]:
    """Parse object bytes into a list of dict events (JSON array/object or NDJSON lines).

    When ``lenient_ndjson`` is True, invalid NDJSON lines are logged and skipped instead of failing the fetch.
    Whole-file JSON (array/object) parsing remains strict.
    """

    text = body.decode("utf-8-sig")
    stripped = text.strip()
    if not stripped:
        return []
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            out: list[dict[str, Any]] = []
            for idx, item in enumerate(parsed):
                if not isinstance(item, dict):
                    raise SourceFetchError(
                        f"S3 object {object_key!r}: JSON array item at index {idx} must be an object"
                    )
                out.append(dict(item))
            return out
        if isinstance(parsed, dict):
            return [dict(parsed)]
    except json.JSONDecodeError:
        pass
    records: list[dict[str, Any]] = []
    for line_no, line in enumerate(text.splitlines(), start=1):
        piece = line.strip()
        if not piece:
            continue
        try:
            obj = json.loads(piece)
        except json.JSONDecodeError as exc:
            if lenient_ndjson:
                logger.info(
                    "%s",
                    {
                        "stage": "s3_ndjson_line_skipped",
                        "object_key": object_key,
                        "line_no": line_no,
                        "error_type": type(exc).__name__,
                    },
                )
                continue
            raise SourceFetchError(f"S3 object {object_key!r}: invalid JSON on line {line_no}") from exc
        if not isinstance(obj, dict):
            if lenient_ndjson:
                logger.info(
                    "%s",
                    {
                        "stage": "s3_ndjson_line_skipped_non_object",
                        "object_key": object_key,
                        "line_no": line_no,
                    },
                )
                continue
            raise SourceFetchError(f"S3 object {object_key!r}: line {line_no} must be a JSON object")
        records.append(dict(obj))
    return records


class S3ObjectPollingAdapter(SourceAdapter):
    """List objects under prefix, fetch each body, flatten to one event per parsed record."""

    def fetch(
        self,
        source_config: dict[str, Any],
        stream_config: dict[str, Any],
        checkpoint: dict[str, Any] | None,
    ) -> Any:
        endpoint_url = str(_get(source_config, "endpoint_url", "") or "").strip()
        bucket = str(_get(source_config, "bucket", "") or "").strip()
        region = str(_get(source_config, "region", "") or "us-east-1").strip() or "us-east-1"
        access_key = str(_get(source_config, "access_key", "") or "").strip()
        secret_key = str(_get(source_config, "secret_key", "") or "").strip()
        prefix = str(_get(source_config, "prefix", "") or "")
        path_style = bool(_get(source_config, "path_style_access", True))
        use_ssl = bool(_get(source_config, "use_ssl", False))

        if not endpoint_url:
            raise SourceFetchError("S3 source_config.endpoint_url is required")
        if not bucket:
            raise SourceFetchError("S3 source_config.bucket is required")
        if not access_key or not secret_key:
            raise SourceFetchError("S3 source_config.access_key and secret_key are required")

        max_objects = int(_get(stream_config, "max_objects_per_run", 20) or 20)
        if max_objects < 1:
            max_objects = 1

        strict_lines = bool(_get(stream_config, "strict_json_lines", False))
        lenient_ndjson = not strict_lines

        w_lm, w_key = _watermark_tuple(checkpoint)
        rs = str(_get(stream_config, "gdc_replay_start_iso") or "").strip()
        re = str(_get(stream_config, "gdc_replay_end_iso") or "").strip()
        replay_start = _parse_iso_dt(rs) if rs and re else None
        replay_end = _parse_iso_dt(re) if rs and re else None
        if replay_start is not None and replay_end is not None:
            w_lm, w_key = None, None

        addressing = "path" if path_style else "virtual"
        boto_cfg = BotoConfig(signature_version="s3v4", s3={"addressing_style": addressing})

        try:
            session = boto3.session.Session(
                aws_access_key_id=access_key,
                aws_secret_access_key=secret_key,
                region_name=region,
            )
            client = session.client(
                "s3",
                endpoint_url=endpoint_url,
                use_ssl=use_ssl,
                config=boto_cfg,
            )
        except (BotoCoreError, ValueError) as exc:
            raise SourceFetchError("Failed to initialize S3 client") from exc

        contents: list[dict[str, Any]] = []
        token: str | None = None
        try:
            while True:
                kw: dict[str, Any] = {"Bucket": bucket, "Prefix": prefix}
                if token:
                    kw["ContinuationToken"] = token
                resp = client.list_objects_v2(**kw)
                for item in resp.get("Contents") or []:
                    key = str(item.get("Key") or "")
                    if not key or key.endswith("/"):
                        continue
                    contents.append(item)
                if not resp.get("IsTruncated"):
                    break
                token = resp.get("NextContinuationToken")
                if not token:
                    break
        except (ClientError, BotoCoreError) as exc:
            logger.info(
                "%s",
                {
                    "stage": "s3_list_objects_failed",
                    "bucket": bucket,
                    "prefix": prefix,
                    "error_type": type(exc).__name__,
                },
            )
            raise SourceFetchError("S3 ListObjectsV2 failed") from exc

        contents.sort(key=lambda it: (_object_tuple(it["LastModified"], str(it["Key"]))))

        events: list[dict[str, Any]] = []
        objects_fetched = 0
        for meta in contents:
            key = str(meta.get("Key") or "")
            lm_raw = meta.get("LastModified")
            if not isinstance(lm_raw, datetime):
                continue
            lm_utc = lm_raw.astimezone(timezone.utc) if lm_raw.tzinfo else lm_raw.replace(tzinfo=timezone.utc)
            if replay_start is not None and replay_end is not None:
                rsu = replay_start.astimezone(timezone.utc) if replay_start.tzinfo else replay_start.replace(tzinfo=timezone.utc)
                reu = replay_end.astimezone(timezone.utc) if replay_end.tzinfo else replay_end.replace(tzinfo=timezone.utc)
                if lm_utc < rsu or lm_utc > reu:
                    continue
            elif _should_skip_object(lm_raw, key, w_lm, w_key):
                continue
            if objects_fetched >= max_objects:
                break
            objects_fetched += 1
            etag_raw = str(meta.get("ETag") or "")
            etag = etag_raw.strip('"')
            size = int(meta.get("Size") or 0)
            try:
                obj = client.get_object(Bucket=bucket, Key=key)
                body_bytes: bytes = obj["Body"].read()
            except (ClientError, BotoCoreError) as exc:
                logger.info(
                    "%s",
                    {
                        "stage": "s3_get_object_failed",
                        "bucket": bucket,
                        "object_key": key,
                        "error_type": type(exc).__name__,
                    },
                )
                raise SourceFetchError(f"S3 GetObject failed for key={key!r}") from exc

            lm_iso = _iso_utc(lm_raw)
            base_meta = {
                "s3_bucket": bucket,
                "s3_key": key,
                "s3_etag": etag,
                "s3_last_modified": lm_iso,
                "s3_size": size,
            }
            for rec in parse_s3_object_records(body_bytes, object_key=key, lenient_ndjson=lenient_ndjson):
                merged = {**rec, **base_meta}
                events.append(merged)

        logger.info(
            "%s",
            {
                "stage": "s3_object_poll_complete",
                "bucket": bucket,
                "prefix": prefix,
                "listed_objects": len(contents),
                "emitted_events": len(events),
            },
        )
        return events
