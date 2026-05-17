"""Lightweight dev-validation runtime checks at API startup (fail-open, structured logs)."""

from __future__ import annotations

import logging
import socket
from pathlib import Path

from app.config import settings
from app.dev_validation_lab.runtime_gates import dev_validation_runtime_enabled

logger = logging.getLogger(__name__)

_FIXTURE_HOSTNAMES: tuple[str, ...] = (
    "gdc-wiremock-test",
    "gdc-postgres-query-test",
    "gdc-mysql-query-test",
    "gdc-mariadb-query-test",
    "gdc-minio-test",
)


def _wiremock_mappings_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "tests" / "wiremock" / "mappings"


def _resolve_hostname(host: str) -> tuple[bool, str | None]:
    try:
        socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
        return True, None
    except OSError as exc:
        return False, str(exc)


def log_dev_validation_runtime_startup_checks() -> None:
    """Emit structured JSON-friendly startup diagnostics; never raises."""

    enabled = dev_validation_runtime_enabled()
    mappings_dir = _wiremock_mappings_dir()
    mappings_ok = mappings_dir.is_dir()
    logger.info(
        "%s",
        {
            "stage": "dev_validation_runtime_ready" if enabled else "dev_validation_runtime_disabled",
            "dev_validation_enabled": enabled,
            "ENABLE_DEV_VALIDATION_LAB": bool(settings.ENABLE_DEV_VALIDATION_LAB),
            "APP_ENV": str(settings.APP_ENV or ""),
        },
    )
    if mappings_ok:
        logger.info(
            "%s",
            {
                "stage": "dev_validation_wiremock_assets_ready",
                "mappings_dir": str(mappings_dir),
                "mapping_files": len(list(mappings_dir.glob("template-*.json"))),
            },
        )
    else:
        logger.warning(
            "%s",
            {
                "stage": "dev_validation_wiremock_assets_missing",
                "mappings_dir": str(mappings_dir),
            },
        )

    if not enabled:
        return

    for host in _FIXTURE_HOSTNAMES:
        ok, err = _resolve_hostname(host)
        if ok:
            logger.info(
                "%s",
                {"stage": "dev_validation_hostname_resolved", "hostname": host},
            )
        else:
            logger.warning(
                "%s",
                {
                    "stage": "dev_validation_hostname_resolution_failed",
                    "hostname": host,
                    "message": err,
                },
            )


__all__ = ["log_dev_validation_runtime_startup_checks"]
