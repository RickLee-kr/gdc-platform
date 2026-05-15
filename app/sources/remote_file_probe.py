"""REMOTE_FILE_POLLING connectivity probe (no passwords, keys, passphrases, or file bodies in output)."""

from __future__ import annotations

import time
from typing import Any

import paramiko

from app.sources.remote_file_ssh import iter_remote_file_candidates, normalize_known_hosts_policy, open_ssh_client

logger = __import__("logging").getLogger(__name__)


def _get(data: Any, key: str, default: Any = None) -> Any:
    if isinstance(data, dict):
        return data.get(key, default)
    return getattr(data, key, default)


def probe_remote_file_source(
    source_config: dict[str, Any],
    stream_config: dict[str, Any],
    *,
    sample_path_limit: int = 12,
) -> dict[str, Any]:
    """Return structured probe fields for connector-auth test."""

    started = time.perf_counter()
    policy_raw = str(_get(source_config, "known_hosts_policy") or "strict")
    policy_norm = normalize_known_hosts_policy(policy_raw)
    remote_dir = str(_get(stream_config, "remote_directory") or "").strip()
    pattern = str(_get(stream_config, "file_pattern") or "*").strip() or "*"
    recursive = bool(_get(stream_config, "recursive", False))

    out: dict[str, Any] = {
        "ok": False,
        "ssh_reachable": False,
        "ssh_auth_ok": False,
        "sftp_available": False,
        "remote_directory_accessible": False,
        "matched_file_count": 0,
        "sample_remote_paths": [],
        "host_key_policy": policy_norm,
        "host_key_status": policy_norm,
        "latency_ms": 0,
        "message": "",
        "error_type": None,
    }

    if not remote_dir:
        out["message"] = "stream_config.remote_directory is required for REMOTE_FILE_POLLING probe"
        out["error_type"] = "remote_file_probe_invalid_config"
        return out

    try:
        client = open_ssh_client(source_config)
    except ValueError as exc:
        out["message"] = str(exc)
        out["error_type"] = "remote_file_probe_invalid_config"
        out["latency_ms"] = int((time.perf_counter() - started) * 1000)
        return out
    except Exception as exc:
        out["message"] = f"SSH connect failed: {type(exc).__name__}"
        out["error_type"] = "ssh_connect_failed"
        out["ssh_reachable"] = True
        out["latency_ms"] = int((time.perf_counter() - started) * 1000)
        logger.info("%s", {"stage": "remote_file_probe_connect_failed", "error_type": type(exc).__name__})
        return out

    out["ssh_reachable"] = True
    out["ssh_auth_ok"] = True

    sftp: paramiko.SFTPClient | None = None
    try:
        try:
            sftp = client.open_sftp()
            out["sftp_available"] = True
        except Exception as exc:
            out["message"] = f"SFTP subsystem unavailable: {type(exc).__name__}"
            out["error_type"] = "sftp_unavailable"
            out["latency_ms"] = int((time.perf_counter() - started) * 1000)
            return out

        try:
            sftp.listdir_attr(remote_dir)
        except OSError as exc:
            out["message"] = f"remote_directory not accessible: {type(exc).__name__}"
            out["error_type"] = "remote_directory_denied"
            out["latency_ms"] = int((time.perf_counter() - started) * 1000)
            return out

        out["remote_directory_accessible"] = True
        candidates = iter_remote_file_candidates(sftp, base=remote_dir, pattern=pattern, recursive=recursive)
        paths = [p for p, _m, _s in candidates]
        out["matched_file_count"] = len(paths)
        out["sample_remote_paths"] = paths[:sample_path_limit]
        out["ok"] = True
        out["message"] = "REMOTE_FILE_POLLING probe succeeded"
    finally:
        try:
            if sftp is not None:
                sftp.close()
        except Exception:
            pass
        try:
            client.close()
        except Exception:
            pass

    out["latency_ms"] = int((time.perf_counter() - started) * 1000)
    return out
