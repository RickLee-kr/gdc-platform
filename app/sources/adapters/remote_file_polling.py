"""REMOTE_FILE_POLLING — SFTP/SCP file polling, parsers, checkpoint-friendly metadata (spec 029)."""

from __future__ import annotations

import csv
import hashlib
import io
import json
import logging
import tempfile
from datetime import datetime, timezone
from typing import Any

import paramiko
from scp import SCPClient

from app.runtime.errors import SourceFetchError
from app.sources.adapters.base import SourceAdapter
from app.sources.adapters.s3_object_polling import parse_s3_object_records
from app.sources.remote_file_ssh import iter_remote_file_candidates, open_ssh_client

logger = logging.getLogger(__name__)


def _get(data: Any, key: str, default: Any = None) -> Any:
    if isinstance(data, dict):
        return data.get(key, default)
    return getattr(data, key, default)


def _iso_utc(ts: float | int) -> str:
    dt = datetime.fromtimestamp(float(ts), tz=timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


def _parse_iso_dt(value: str | None) -> datetime | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s)


def _file_tuple(mtime: float, path: str) -> tuple[datetime, str]:
    dt = datetime.fromtimestamp(float(mtime), tz=timezone.utc)
    return dt, path


def _checkpoint_resume_fields(checkpoint: dict[str, Any] | None) -> dict[str, Any]:
    """Extract remote file checkpoint dimensions from persisted value."""

    if not isinstance(checkpoint, dict):
        return {}
    if checkpoint.get("last_processed_file") or checkpoint.get("last_processed_mtime"):
        return {
            "file": str(checkpoint.get("last_processed_file") or checkpoint.get("last_processed_key") or ""),
            "mtime": checkpoint.get("last_processed_mtime") or checkpoint.get("last_processed_last_modified"),
            "size": checkpoint.get("last_processed_size"),
            "offset": checkpoint.get("last_processed_offset"),
            "hash": checkpoint.get("last_processed_hash"),
        }
    lk = checkpoint.get("last_processed_key")
    llm = checkpoint.get("last_processed_last_modified")
    if lk is not None or llm is not None:
        return {
            "file": str(lk or ""),
            "mtime": llm,
            "size": checkpoint.get("last_processed_size"),
            "offset": checkpoint.get("last_processed_offset"),
            "hash": checkpoint.get("last_processed_hash"),
        }
    last = checkpoint.get("last_success_event")
    if isinstance(last, dict):
        return {
            "file": str(last.get("gdc_remote_path") or last.get("remote_path") or ""),
            "mtime": last.get("gdc_remote_mtime") or last.get("remote_mtime"),
            "size": last.get("gdc_remote_size") if last.get("gdc_remote_size") is not None else last.get("remote_size"),
            "offset": last.get("gdc_remote_offset"),
            "hash": last.get("gdc_remote_hash"),
        }
    return {}


def _watermark_tuple(checkpoint: dict[str, Any] | None) -> tuple[datetime | None, str | None]:
    c = _checkpoint_resume_fields(checkpoint)
    lm = c.get("mtime")
    path = c.get("file")
    if isinstance(lm, str):
        return _parse_iso_dt(lm), str(path) if path else None
    return None, str(path) if path else None


def _should_skip_file(mtime: float, path: str, w_lm: datetime | None, w_key: str | None) -> bool:
    """Return True when (mtime, path) is not after the checkpoint watermark (S3-aligned tuple order)."""

    if w_lm is None or w_key is None:
        return False
    cur = _file_tuple(mtime, path)
    w = (w_lm.astimezone(timezone.utc), w_key)
    return cur <= w


def _should_skip_entire_file(
    mtime: float,
    path: str,
    size: int,
    checkpoint: dict[str, Any] | None,
    w_lm: datetime | None,
    w_key: str | None,
) -> bool:
    c = _checkpoint_resume_fields(checkpoint)
    if str(c.get("file") or "") == path and c.get("mtime"):
        if str(c.get("mtime")).strip() == _iso_utc(mtime).strip():
            off = int(c.get("offset") or 0)
            if 0 < off < int(size):
                return False
    return _should_skip_file(mtime, path, w_lm, w_key)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _align_line_start(buf: bytes, offset: int) -> int:
    if offset <= 0:
        return 0
    if offset >= len(buf):
        return len(buf)
    if buf[offset - 1 : offset] == b"\n":
        return offset
    nl = buf.find(b"\n", offset)
    return nl + 1 if nl != -1 else len(buf)


def _normalize_parser_type(raw: str) -> str:
    s = str(raw or "ndjson").strip().upper().replace("-", "_")
    aliases = {
        "NDJSON": "NDJSON",
        "JSON_ARRAY": "JSON_ARRAY",
        "JSON_OBJECT": "JSON_OBJECT",
        "CSV": "CSV",
        "LINE_TEXT": "LINE_DELIMITED_TEXT",
        "LINE_DELIMITED_TEXT": "LINE_DELIMITED_TEXT",
    }
    return aliases.get(s, s)


def _parse_records_with_offsets(
    body: bytes,
    *,
    remote_path: str,
    parser_type: str,
    lenient_ndjson: bool,
    encoding: str,
    csv_delimiter: str,
    line_event_field: str,
    start_line_byte: int,
) -> list[tuple[dict[str, Any], int]]:
    pt = _normalize_parser_type(parser_type)
    enc = str(encoding or "utf-8").strip() or "utf-8"

    if pt == "NDJSON":
        return _ndjson_line_events_with_offsets(
            body, start=start_line_byte, object_key=remote_path, lenient_ndjson=lenient_ndjson, encoding=enc
        )

    if pt == "LINE_DELIMITED_TEXT":
        field = str(line_event_field or "line").strip() or "line"
        return _line_text_events_with_offsets(body, start=start_line_byte, field=field, encoding=enc)

    try:
        text = body.decode(enc)
    except UnicodeDecodeError as exc:
        raise SourceFetchError(f"decode failed for remote file {remote_path!r} (encoding={enc!r})") from exc

    if pt in {"JSON_ARRAY", "JSON_OBJECT"}:
        recs = parse_s3_object_records(body, object_key=remote_path, lenient_ndjson=lenient_ndjson)
        end = len(body)
        return [(dict(r), end) for r in recs]

    if pt == "CSV":
        delim = str(csv_delimiter or ",")
        if len(delim) != 1:
            raise SourceFetchError("csv_delimiter must be a single character")
        reader = csv.DictReader(io.StringIO(text), delimiter=delim)
        rows = [{k: (v if v is not None else "") for k, v in row.items()} for row in reader if row]
        end = len(body)
        return [(r, end) for r in rows]

    raise SourceFetchError(f"unsupported parser_type for REMOTE_FILE_POLLING: {parser_type!r}")


def _ndjson_line_events_with_offsets(
    body: bytes,
    *,
    start: int,
    object_key: str,
    lenient_ndjson: bool,
    encoding: str,
) -> list[tuple[dict[str, Any], int]]:
    """Return (event, exclusive_end_byte_offset_in_body) for each NDJSON object line."""

    enc = str(encoding or "utf-8").strip() or "utf-8"
    i = _align_line_start(body, start)
    out: list[tuple[dict[str, Any], int]] = []
    line_no = 0
    while i < len(body):
        if body[i : i + 1] in (b"\n", b"\r"):
            i += 1
            continue
        nl = body.find(b"\n", i)
        if nl == -1:
            chunk = body[i:]
            end = len(body)
        else:
            chunk = body[i:nl]
            end = nl + 1
        line_no += 1
        piece = chunk.decode(enc).strip()
        if not piece:
            i = end
            continue
        try:
            obj = json.loads(piece)
        except Exception as exc:
            if lenient_ndjson:
                logger.info(
                    "%s",
                    {
                        "stage": "remote_file_ndjson_line_skipped",
                        "object_key": object_key,
                        "line_no": line_no,
                        "error_type": type(exc).__name__,
                    },
                )
                i = end
                continue
            raise SourceFetchError(f"remote file {object_key!r}: invalid JSON on line {line_no}") from exc
        if not isinstance(obj, dict):
            if lenient_ndjson:
                logger.info(
                    "%s",
                    {"stage": "remote_file_ndjson_line_skipped_non_object", "object_key": object_key, "line_no": line_no},
                )
                i = end
                continue
            raise SourceFetchError(f"remote file {object_key!r}: line {line_no} must be a JSON object")
        out.append((dict(obj), end))
        i = end
    return out


def _line_text_events_with_offsets(
    body: bytes,
    *,
    start: int,
    field: str,
    encoding: str,
) -> list[tuple[dict[str, Any], int]]:
    enc = str(encoding or "utf-8").strip() or "utf-8"
    i = _align_line_start(body, start)
    out: list[tuple[dict[str, Any], int]] = []
    while i < len(body):
        if body[i : i + 1] in (b"\n", b"\r"):
            i += 1
            continue
        nl = body.find(b"\n", i)
        if nl == -1:
            line_b = body[i:]
            end = len(body)
        else:
            line_b = body[i:nl]
            end = nl + 1
        try:
            ln = line_b.decode(enc).strip()
        except UnicodeDecodeError as exc:
            raise SourceFetchError("line text decode failed") from exc
        if ln:
            out.append(({field: ln}, end))
        i = end
    return out


def _resume_start_offset(
    *,
    path: str,
    mtime: float,
    size: int,
    checkpoint: dict[str, Any] | None,
    parser_type: str,
) -> int:
    c = _checkpoint_resume_fields(checkpoint)
    if not c.get("file") or str(c["file"]) != path:
        return 0
    cp_mtime = c.get("mtime")
    cp_size = c.get("size")
    cp_off = int(c.get("offset") or 0)
    cp_hash = str(c.get("hash") or "")
    if cp_mtime is not None:
        cur_iso = _iso_utc(mtime)
        if str(cp_mtime).strip() != str(cur_iso).strip():
            return 0
    if cp_size is not None and int(cp_size) > int(size):
        return 0
    if cp_off <= 0:
        return 0
    pt = _normalize_parser_type(parser_type)
    if pt not in {"NDJSON", "LINE_DELIMITED_TEXT"}:
        return 0
    return cp_off


def _verify_prefix_hash(body: bytes, offset: int, expected: str) -> bool:
    if not expected:
        return True
    chunk = body[: min(len(body), offset)]
    return _sha256(chunk) == expected


def _fetch_via_sftp(sftp: paramiko.SFTPClient, path: str) -> tuple[bytes, int, float]:
    with sftp.open(path, "rb") as handle:
        body = handle.read()
    st = sftp.stat(path)
    return body, int(st.st_size), float(st.st_mtime)


def _fetch_via_scp(client: paramiko.SSHClient, path: str) -> bytes:
    transport = client.get_transport()
    if transport is None:
        raise SourceFetchError("SSH transport unavailable for SCP file fetch")
    with tempfile.NamedTemporaryFile() as tmp:
        with SCPClient(transport) as scp:
            scp.get(path, tmp.name)
        tmp.seek(0)
        return tmp.read()


def normalize_remote_file_transfer_protocol(raw: str | None) -> str:
    """Return ``sftp`` or ``sftp_compatible_scp``. Legacy persisted value ``scp`` maps to SFTP-compatible mode."""

    s = str(raw or "sftp").strip().lower()
    if s == "scp":
        return "sftp_compatible_scp"
    if s in {"sftp", "sftp_compatible_scp"}:
        return s
    raise SourceFetchError("source_config.protocol must be 'sftp' or 'sftp_compatible_scp' (legacy 'scp' accepted)")


class RemoteFilePollingAdapter(SourceAdapter):
    """Poll remote files over SFTP, or SFTP-compatible SCP mode (directory listing via SFTP; file bytes via SCPClient)."""

    def fetch(
        self,
        source_config: dict[str, Any],
        stream_config: dict[str, Any],
        checkpoint: dict[str, Any] | None,
    ) -> Any:
        protocol = normalize_remote_file_transfer_protocol(str(_get(source_config, "protocol") or "sftp"))

        host = str(_get(source_config, "host") or "").strip()
        if not host:
            raise SourceFetchError("REMOTE_FILE_POLLING requires host in source_config")

        remote_dir = str(_get(stream_config, "remote_directory") or "").strip()
        if not remote_dir:
            raise SourceFetchError("stream_config.remote_directory is required")

        pattern = str(_get(stream_config, "file_pattern") or "*").strip() or "*"
        recursive = bool(_get(stream_config, "recursive", False))
        parser_type = str(_get(stream_config, "parser_type") or "NDJSON").strip()
        max_files = int(_get(stream_config, "max_files_per_run", 10) or 10)
        if max_files < 1:
            max_files = 1
        max_mb = int(_get(stream_config, "max_file_size_mb", 5) or 5)
        if max_mb < 1:
            max_mb = 1
        max_bytes = max_mb * 1024 * 1024
        strict_lines = bool(_get(stream_config, "strict_json_lines", False))
        lenient_ndjson = not strict_lines
        encoding = str(_get(stream_config, "encoding") or "utf-8").strip() or "utf-8"
        csv_delimiter = str(_get(stream_config, "csv_delimiter") or ",")
        line_event_field = str(_get(stream_config, "line_event_field") or "line").strip() or "line"
        include_meta = bool(_get(stream_config, "include_file_metadata", False))

        w_lm, w_key = _watermark_tuple(checkpoint)
        ck_resume = _checkpoint_resume_fields(checkpoint)

        rs = str(_get(stream_config, "gdc_replay_start_iso") or "").strip()
        re = str(_get(stream_config, "gdc_replay_end_iso") or "").strip()
        replay_start = _parse_iso_dt(rs) if rs and re else None
        replay_end = _parse_iso_dt(re) if rs and re else None
        if replay_start is not None and replay_end is not None:
            w_lm, w_key = None, None

        client = open_ssh_client(source_config)
        sftp: paramiko.SFTPClient | None = None
        events: list[dict[str, Any]] = []
        files_fetched = 0

        try:
            try:
                sftp = client.open_sftp()
            except Exception as exc:
                raise SourceFetchError("SFTP subsystem open failed (required for directory listing)") from exc

            candidates = iter_remote_file_candidates(sftp, base=remote_dir, pattern=pattern, recursive=recursive)
            for path, mtime, size in candidates:
                if replay_start is not None and replay_end is not None:
                    mdt = datetime.fromtimestamp(float(mtime), tz=timezone.utc)
                    rsu = (
                        replay_start.astimezone(timezone.utc)
                        if replay_start.tzinfo
                        else replay_start.replace(tzinfo=timezone.utc)
                    )
                    reu = (
                        replay_end.astimezone(timezone.utc)
                        if replay_end.tzinfo
                        else replay_end.replace(tzinfo=timezone.utc)
                    )
                    if mdt < rsu or mdt > reu:
                        continue
                elif _should_skip_entire_file(mtime, path, size, checkpoint, w_lm, w_key):
                    continue
                if files_fetched >= max_files:
                    break
                if size > max_bytes:
                    logger.info(
                        "%s",
                        {
                            "stage": "remote_file_skipped_size",
                            "path": path,
                            "size": size,
                            "max_bytes": max_bytes,
                        },
                    )
                    continue

                try:
                    if protocol == "sftp_compatible_scp":
                        body = _fetch_via_scp(client, path)
                        st2 = sftp.stat(path)
                        st_size, st_mtime = int(st2.st_size), float(st2.st_mtime)
                    else:
                        body, st_size, st_mtime = _fetch_via_sftp(sftp, path)
                except FileNotFoundError as exc:
                    logger.info(
                        "%s",
                        {"stage": "remote_file_deleted_before_fetch", "path": path, "error_type": type(exc).__name__},
                    )
                    continue
                except OSError as exc:
                    logger.info(
                        "%s",
                        {"stage": "remote_file_fetch_failed", "path": path, "error_type": type(exc).__name__},
                    )
                    continue

                if st_size != size or abs(st_mtime - mtime) > 1e-3:
                    logger.info(
                        "%s",
                        {
                            "stage": "remote_file_mutated_during_fetch",
                            "path": path,
                            "listed_size": size,
                            "fetched_stat_size": st_size,
                        },
                    )

                start_off = _resume_start_offset(
                    path=path, mtime=mtime, size=st_size, checkpoint=checkpoint, parser_type=parser_type
                )
                exp_hash = str(ck_resume.get("hash") or "") if str(ck_resume.get("file") or "") == path else ""
                if start_off > 0 and exp_hash and not _verify_prefix_hash(body, start_off, exp_hash):
                    logger.info("%s", {"stage": "remote_file_prefix_hash_mismatch", "path": path})
                    start_off = 0

                mtime_iso = _iso_utc(mtime)
                file_hash = _sha256(body)
                base_meta: dict[str, Any] = {
                    "remote_path": path,
                    "remote_mtime": mtime_iso,
                    "remote_size": st_size,
                    "gdc_remote_path": path,
                    "gdc_remote_mtime": mtime_iso,
                    "gdc_remote_size": st_size,
                    "gdc_remote_protocol": protocol,
                    "gdc_remote_host": host,
                }
                if include_meta:
                    base_meta["gdc_remote_hash"] = file_hash

                try:
                    parsed = _parse_records_with_offsets(
                        body,
                        remote_path=path,
                        parser_type=parser_type,
                        lenient_ndjson=lenient_ndjson,
                        encoding=encoding,
                        csv_delimiter=csv_delimiter,
                        line_event_field=line_event_field,
                        start_line_byte=start_off,
                    )
                except SourceFetchError:
                    raise
                except Exception as exc:
                    raise SourceFetchError(f"parse failed for remote file {path!r}") from exc

                if not parsed:
                    files_fetched += 1
                    continue

                for rec, end_off in parsed:
                    row = dict(rec)
                    row.update(base_meta)
                    row["gdc_remote_offset"] = int(end_off)
                    prefix = body[: int(end_off)]
                    row["gdc_remote_hash"] = _sha256(prefix)
                    events.append(row)

                files_fetched += 1
        finally:
            try:
                if sftp is not None:
                    sftp.close()
            finally:
                client.close()

        logger.info(
            "%s",
            {
                "stage": "remote_file_poll_complete",
                "host": host,
                "protocol": protocol,
                "remote_directory": remote_dir,
                "files_fetched": files_fetched,
                "emitted_events": len(events),
            },
        )
        return events
