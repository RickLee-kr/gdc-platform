"""Validation and runtime helpers for published reverse-proxy network ports."""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from app.config import settings

DEFAULT_HTTP_PORT = 18080
DEFAULT_HTTPS_PORT = 18443
MIN_TCP_PORT = 1
MAX_TCP_PORT = 65535

# Existing platform host-published ports and container-reserved service ports.
# Ports 80 and 443 intentionally remain allowed for production-style hosts.
RESERVED_PLATFORM_PORTS = frozenset({5432, 55432, 8000, 8080, 8099, 5514})
REPO_ROOT = Path(__file__).resolve().parents[2]
PLATFORM_ENV_PATH = REPO_ROOT / ".env"
REVERSE_PROXY_RECREATE_COMMAND = (
    "docker",
    "compose",
    "-f",
    "docker-compose.platform.yml",
    "up",
    "-d",
    "--force-recreate",
    "reverse-proxy",
)
REVERSE_PROXY_RECREATE_COMMAND_TEXT = " ".join(REVERSE_PROXY_RECREATE_COMMAND)


@dataclass(frozen=True)
class NetworkPortConfig:
    http_port: int
    https_port: int


@dataclass(frozen=True)
class EnvUpdateResult:
    env_path: Path
    backup_path: Path


@dataclass(frozen=True)
class ReverseProxyApplyResult:
    success: bool
    command: str
    stdout: str
    stderr: str
    exit_code: int


class NetworkPortValidationError(ValueError):
    """Raised when reverse-proxy host port settings are invalid."""


def parse_tcp_port(value: object, *, field_name: str) -> int:
    """Parse a TCP port from API/env input without accepting compose mappings."""

    if isinstance(value, bool):
        raise NetworkPortValidationError(f"{field_name} must be a numeric TCP port.")
    if isinstance(value, int):
        port = value
    elif isinstance(value, str):
        raw = value.strip()
        if not raw.isdigit():
            raise NetworkPortValidationError(f"{field_name} must be a numeric TCP port.")
        port = int(raw, 10)
    else:
        raise NetworkPortValidationError(f"{field_name} must be a numeric TCP port.")

    if port < MIN_TCP_PORT or port > MAX_TCP_PORT:
        raise NetworkPortValidationError(f"{field_name} must be between 1 and 65535.")
    return port


def validate_network_ports(http_port: object, https_port: object) -> NetworkPortConfig:
    """Validate externally published HTTP/HTTPS reverse-proxy ports."""

    http = parse_tcp_port(http_port, field_name="http_port")
    https = parse_tcp_port(https_port, field_name="https_port")

    if http == https:
        raise NetworkPortValidationError("http_port and https_port cannot be identical.")

    for field_name, port in (("http_port", http), ("https_port", https)):
        if port in RESERVED_PLATFORM_PORTS:
            raise NetworkPortValidationError(
                f"{field_name} conflicts with a reserved platform service port ({port})."
            )

    return NetworkPortConfig(http_port=http, https_port=https)


def _env_backup_path(env_path: Path) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
    return env_path.with_name(f"{env_path.name}.bak-{stamp}")


def update_platform_env_ports(
    cfg: NetworkPortConfig,
    *,
    env_path: Path | None = None,
) -> EnvUpdateResult:
    """Update only the reverse-proxy port keys in the platform .env file."""

    env_path = Path(env_path or settings.GDC_PLATFORM_ENV_PATH or PLATFORM_ENV_PATH)
    env_path.parent.mkdir(parents=True, exist_ok=True)
    backup_path = _env_backup_path(env_path)
    original_stat = env_path.stat() if env_path.exists() else None
    if env_path.exists():
        shutil.copy2(env_path, backup_path)
        original = env_path.read_text(encoding="utf-8")
    else:
        backup_path.write_text("", encoding="utf-8")
        original = ""

    replacements = {
        "GDC_HTTP_PORT": str(cfg.http_port),
        "GDC_HTTPS_PORT": str(cfg.https_port),
    }
    seen: set[str] = set()
    lines = original.splitlines(keepends=True)
    updated: list[str] = []
    for line in lines:
        stripped = line.lstrip()
        prefix_len = len(line) - len(stripped)
        key = stripped.split("=", 1)[0].strip() if "=" in stripped else ""
        if key in replacements and not stripped.startswith("#"):
            newline = "\n" if line.endswith("\n") else ""
            updated.append(f"{line[:prefix_len]}{key}={replacements[key]}{newline}")
            seen.add(key)
        else:
            updated.append(line)

    if updated and not updated[-1].endswith("\n"):
        updated[-1] = f"{updated[-1]}\n"
    for key, value in replacements.items():
        if key not in seen:
            updated.append(f"{key}={value}\n")

    content = "".join(updated)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{env_path.name}.", dir=str(env_path.parent), text=True)
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(content)
            fh.flush()
            os.fsync(fh.fileno())
        if original_stat is not None:
            os.chmod(tmp_path, stat.S_IMODE(original_stat.st_mode))
            try:
                os.chown(tmp_path, original_stat.st_uid, original_stat.st_gid)
            except PermissionError:
                pass
        else:
            os.chmod(tmp_path, 0o664)
        os.replace(tmp_path, env_path)
    finally:
        if tmp_path.exists():
            tmp_path.unlink()
    return EnvUpdateResult(env_path=env_path, backup_path=backup_path)


def apply_reverse_proxy_recreate(
    *,
    cwd: Path | None = None,
    timeout_seconds: int = 120,
    http_port: int | None = None,
    https_port: int | None = None,
) -> ReverseProxyApplyResult:
    """Run the one allowed Docker Compose operation for applying published ports."""

    env = os.environ.copy()
    if http_port is not None:
        env["GDC_HTTP_PORT"] = str(http_port)
    if https_port is not None:
        env["GDC_HTTPS_PORT"] = str(https_port)
    try:
        completed = subprocess.run(
            list(REVERSE_PROXY_RECREATE_COMMAND),
            cwd=str(cwd or settings.GDC_PLATFORM_COMPOSE_ROOT or REPO_ROOT),
            env=env,
            capture_output=True,
            text=True,
            check=False,
            timeout=timeout_seconds,
        )
        return ReverseProxyApplyResult(
            success=completed.returncode == 0,
            command=REVERSE_PROXY_RECREATE_COMMAND_TEXT,
            stdout=completed.stdout or "",
            stderr=completed.stderr or "",
            exit_code=int(completed.returncode),
        )
    except subprocess.TimeoutExpired as exc:
        return ReverseProxyApplyResult(
            success=False,
            command=REVERSE_PROXY_RECREATE_COMMAND_TEXT,
            stdout=exc.stdout or "",
            stderr=(exc.stderr or "") + f"\nTimed out after {timeout_seconds} seconds.",
            exit_code=-1,
        )
    except OSError as exc:
        return ReverseProxyApplyResult(
            success=False,
            command=REVERSE_PROXY_RECREATE_COMMAND_TEXT,
            stdout="",
            stderr=str(exc),
            exit_code=-1,
        )
