"""Non-production defaults when ENABLE_DEV_VALIDATION_LAB is on (production-safe)."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

_SLICE_FLAGS = (
    "ENABLE_DEV_VALIDATION_S3",
    "ENABLE_DEV_VALIDATION_DATABASE_QUERY",
    "ENABLE_DEV_VALIDATION_REMOTE_FILE",
)

_CREDENTIAL_DEFAULTS: dict[str, str] = {
    "MINIO_ACCESS_KEY": "gdcminioaccess",
    "MINIO_SECRET_KEY": "gdcminioaccesssecret12",
    "MINIO_BUCKET": "gdc-test-logs",
    "DEV_VALIDATION_SFTP_PASSWORD": "devlab123",
    "DEV_VALIDATION_SSH_SCP_PASSWORD": "devlab456",
}


def _in_docker() -> bool:
    return Path("/.dockerenv").exists()


def _fixture_endpoint_defaults() -> dict[str, str | int]:
    if _in_docker():
        return {
            "DEV_VALIDATION_WIREMOCK_BASE_URL": "http://gdc-wiremock-test:8080",
            "DEV_VALIDATION_WEBHOOK_BASE_URL": "http://gdc-webhook-receiver-test:8080",
            "DEV_VALIDATION_SYSLOG_HOST": "gdc-syslog-test",
            "DEV_VALIDATION_SYSLOG_PORT": 5514,
            "MINIO_ENDPOINT": "http://gdc-minio-test:9000",
            "DEV_VALIDATION_PG_QUERY_HOST": "gdc-postgres-query-test",
            "DEV_VALIDATION_PG_QUERY_PORT": 5432,
            "DEV_VALIDATION_MYSQL_QUERY_HOST": "gdc-mysql-query-test",
            "DEV_VALIDATION_MYSQL_QUERY_PORT": 3306,
            "DEV_VALIDATION_MARIADB_QUERY_HOST": "gdc-mariadb-query-test",
            "DEV_VALIDATION_MARIADB_QUERY_PORT": 3306,
            "DEV_VALIDATION_SFTP_HOST": "gdc-sftp-test",
            "DEV_VALIDATION_SFTP_PORT": 22,
            "DEV_VALIDATION_SSH_SCP_HOST": "gdc-ssh-scp-test",
            "DEV_VALIDATION_SSH_SCP_PORT": 22,
        }
    return {
        "MINIO_ENDPOINT": "http://127.0.0.1:59000",
        "DEV_VALIDATION_PG_QUERY_HOST": "127.0.0.1",
        "DEV_VALIDATION_PG_QUERY_PORT": 55433,
        "DEV_VALIDATION_MYSQL_QUERY_HOST": "127.0.0.1",
        "DEV_VALIDATION_MYSQL_QUERY_PORT": 33306,
        "DEV_VALIDATION_MARIADB_QUERY_HOST": "127.0.0.1",
        "DEV_VALIDATION_MARIADB_QUERY_PORT": 33307,
        "DEV_VALIDATION_SFTP_HOST": "127.0.0.1",
        "DEV_VALIDATION_SFTP_PORT": 22222,
        "DEV_VALIDATION_SSH_SCP_HOST": "127.0.0.1",
        "DEV_VALIDATION_SSH_SCP_PORT": 22223,
    }


def _is_production_app_env(app_env: str) -> bool:
    return (app_env or "").strip().lower() in {"production", "prod"}


def lab_slice_defaults_active(*, enable_lab: bool, app_env: str) -> bool:
    return bool(enable_lab) and not _is_production_app_env(app_env)


def apply_dev_validation_lab_env_defaults(settings: Any) -> dict[str, Any]:
    """Enable optional lab slices and dev fixture credentials when the master lab flag is on.

    Only applies when ENABLE_DEV_VALIDATION_LAB is true and APP_ENV is not production/prod.
    Respects explicit environment variables (including ``false``).
    """

    meta: dict[str, Any] = {
        "applied": False,
        "slice_flags_defaulted": [],
        "credentials_defaulted": [],
        "endpoints_defaulted": [],
    }
    if not lab_slice_defaults_active(
        enable_lab=bool(getattr(settings, "ENABLE_DEV_VALIDATION_LAB", False)),
        app_env=str(getattr(settings, "APP_ENV", "") or ""),
    ):
        return meta

    meta["applied"] = True
    for flag in _SLICE_FLAGS:
        if flag not in os.environ:
            setattr(settings, flag, True)
            meta["slice_flags_defaulted"].append(flag)

    for key, value in _CREDENTIAL_DEFAULTS.items():
        if key not in os.environ and not str(getattr(settings, key, "") or "").strip():
            setattr(settings, key, value)
            meta["credentials_defaulted"].append(key)

    for key, value in _fixture_endpoint_defaults().items():
        if key not in os.environ:
            setattr(settings, key, value)
            meta["endpoints_defaulted"].append(key)

    return meta


__all__ = [
    "apply_dev_validation_lab_env_defaults",
    "lab_slice_defaults_active",
]
