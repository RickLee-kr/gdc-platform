"""Resolve PostgreSQL DATABASE_URL for host shell vs Docker Compose runtime."""

from __future__ import annotations

import logging
import os
import socket
from dataclasses import dataclass
from typing import Literal
from urllib.parse import quote, unquote, urlparse, urlunparse

logger = logging.getLogger(__name__)

Context = Literal["runtime", "alembic", "pytest", "test"]

# Compose service hostnames that resolve only on the platform Docker network.
_COMPOSE_INTERNAL_DB_HOSTS = frozenset(
    {
        "postgres",
        "gdc-platform-postgres",
    }
)


@dataclass(frozen=True)
class DatabaseUrlResolution:
    """Outcome of ``resolve_runtime_database_url``."""

    url: str
    source: str
    original_host: str | None = None
    resolved_host: str | None = None
    resolved_port: int | None = None
    in_container: bool = False
    fallback_applied: bool = False


def is_runtime_in_container() -> bool:
    """True when running inside a Docker container (API / compose exec)."""

    flag = os.environ.get("GDC_RUNTIME_IN_CONTAINER", "").strip().lower()
    if flag in ("1", "true", "yes", "on"):
        return True
    return os.path.exists("/.dockerenv")


def _is_production_env() -> bool:
    env = (os.environ.get("APP_ENV") or "").strip().lower()
    return env in ("production", "prod")


def _explicit_host_database_url() -> str | None:
    for key in ("GDC_HOST_DATABASE_URL", "DEV_DATABASE_URL"):
        raw = os.environ.get(key, "").strip()
        if raw:
            return raw
    return None


def _platform_postgres_host_port() -> int:
    raw = os.environ.get("GDC_PLATFORM_POSTGRES_HOST_PORT", "55432").strip()
    try:
        port = int(raw)
    except ValueError:
        port = 55432
    return max(1, min(65535, port))


def hostname_resolves(hostname: str) -> bool:
    if not hostname or hostname in ("127.0.0.1", "localhost", "::1"):
        return True
    try:
        socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
        return True
    except OSError:
        return False


def _rewrite_netloc(parsed, *, host: str, port: int | None) -> str:
    user = unquote(parsed.username) if parsed.username else ""
    password = unquote(parsed.password) if parsed.password else ""
    auth = ""
    if user:
        auth = quote(user, safe="")
        if password:
            auth = f"{auth}:{quote(password, safe='')}"
        auth = f"{auth}@"
    port_part = f":{port}" if port is not None else ""
    netloc = f"{auth}{host}{port_part}"
    return urlunparse((parsed.scheme, netloc, parsed.path, parsed.params, parsed.query, parsed.fragment))


def resolve_runtime_database_url(
    raw_url: str | None = None,
    *,
    context: Context = "runtime",
) -> DatabaseUrlResolution:
    """Return a connectable PostgreSQL URL for the current execution environment.

    Priority:
    1. ``TEST_DATABASE_URL`` when *context* is pytest/test.
    2. Explicit ``GDC_HOST_DATABASE_URL`` / ``DEV_DATABASE_URL`` on host shell.
    3. Unchanged URL inside containers (compose ``postgres`` hostname).
    4. Development host-shell fallback: ``postgres`` → ``127.0.0.1:<published port>`` when DNS fails.
    5. Otherwise return *raw_url* unchanged (including production compose URLs).
    """

    in_container = is_runtime_in_container()

    if context in ("pytest", "test"):
        test_url = os.environ.get("TEST_DATABASE_URL", "").strip()
        if test_url:
            return DatabaseUrlResolution(url=test_url, source="TEST_DATABASE_URL", in_container=in_container)

    explicit_host = _explicit_host_database_url()
    if explicit_host and not in_container:
        return DatabaseUrlResolution(
            url=explicit_host,
            source="GDC_HOST_DATABASE_URL",
            in_container=in_container,
        )

    url = (raw_url or os.environ.get("DATABASE_URL") or "").strip()
    if not url:
        return DatabaseUrlResolution(url="", source="empty", in_container=in_container)

    if in_container:
        return DatabaseUrlResolution(url=url, source="container_unchanged", in_container=True)

    if _is_production_env():
        return DatabaseUrlResolution(url=url, source="production_unchanged", in_container=False)

    if os.environ.get("GDC_DATABASE_URL_HOST_FALLBACK", "").strip().lower() in ("0", "false", "no", "off"):
        return DatabaseUrlResolution(url=url, source="fallback_disabled", in_container=False)

    parsed = urlparse(url)
    host = (parsed.hostname or "").strip().lower()
    if host not in _COMPOSE_INTERNAL_DB_HOSTS:
        return DatabaseUrlResolution(url=url, source="unchanged", in_container=False)

    if hostname_resolves(host):
        return DatabaseUrlResolution(
            url=url,
            source="compose_hostname_resolves_on_host",
            original_host=host,
            in_container=False,
        )

    port = _platform_postgres_host_port()
    resolved = _rewrite_netloc(parsed, host="127.0.0.1", port=port)
    _log_host_fallback(host=host, port=port, context=context)
    return DatabaseUrlResolution(
        url=resolved,
        source="compose_host_fallback",
        original_host=host,
        resolved_host="127.0.0.1",
        resolved_port=port,
        in_container=False,
        fallback_applied=True,
    )


def _log_host_fallback(*, host: str, port: int, context: str) -> None:
    message = {
        "stage": "database_url_host_fallback",
        "context": context,
        "original_host": host,
        "resolved_host": "127.0.0.1",
        "resolved_port": port,
        "message": f"[database_url] resolved DATABASE_URL host fallback: {host} -> 127.0.0.1:{port}",
    }
    logger.warning("%s", message)


def apply_resolved_database_url_env(
    raw_url: str | None = None,
    *,
    context: Context = "runtime",
) -> DatabaseUrlResolution:
    """Resolve URL and mirror into ``DATABASE_URL`` for subprocesses (Alembic, scripts)."""

    resolution = resolve_runtime_database_url(raw_url, context=context)
    if resolution.url:
        os.environ["DATABASE_URL"] = resolution.url
    return resolution
