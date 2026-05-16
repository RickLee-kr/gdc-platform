"""Idempotent seed for UI-visible ``[DEV E2E]`` platform entities (PostgreSQL ORM only).

Safe usage: loopback catalog DB, allow-listed database names, no deletes of non-lab rows.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.connectors.router import (
    _build_auth_json,
    _build_config_json,
    _build_database_query_config_json,
    _build_remote_file_config_json,
    _build_s3_config_json,
)
from app.connectors.schemas import ConnectorCreate
from app.destinations.config_validation import validate_destination_config
from app.destinations.models import Destination
from app.enrichments.models import Enrichment
from app.mappings.models import Mapping
from app.routes.models import Route
from app.sources.models import Source
from app.streams.models import Stream

PREFIX = "[DEV E2E] "

DESCRIPTION = (
    "Local dev UI-visible E2E fixture (WireMock, MinIO, fixture PostgreSQL, SFTP, webhook/syslog). "
    "Seeded by scripts/dev-validation/seed-visible-e2e-fixtures.sh — not for production."
)

DEFAULT_FIELD_MAPPINGS: dict[str, str] = {
    "event_id": "$.id",
    "message": "$.message",
    "severity": "$.severity",
}

DB_FIELD_MAPPINGS: dict[str, str] = {
    "event_id": "$.event_id",
    "message": "$.message",
    "severity": "$.severity",
}

_PROD_HOST_HINTS = re.compile(
    r"(amazonaws\.com|rds\.|azure\.|database\.azure|neon\.tech|supabase\.co|"
    r"elephantsql|cockroachlabs\.cloud|planetscale\.com|render\.com|herokuapp\.com)",
    re.I,
)


@dataclass(frozen=True, slots=True)
class VisibleSeedEnv:
    wiremock_base_url: str
    webhook_base_url: str
    syslog_host: str
    syslog_plain_port: int
    syslog_tls_port: int
    minio_endpoint: str
    minio_bucket: str
    minio_access_key: str
    minio_secret_key: str
    minio_prefix: str
    pg_fixture_host: str
    pg_fixture_port: int
    pg_fixture_database: str
    pg_fixture_user: str
    pg_fixture_password: str
    sftp_host: str
    sftp_port: int
    sftp_user: str
    sftp_password: str


def _env(name: str, default: str) -> str:
    return (os.environ.get(name) or default).strip()


def _env_int(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return int(default)
    return int(raw)


def assert_safe_database_url(*, local_dev_mode: bool) -> None:
    """Abort unless DATABASE_URL targets an allow-listed local PostgreSQL catalog."""

    raw = (os.environ.get("DATABASE_URL") or "").strip()
    if not raw:
        raise SystemExit("DATABASE_URL is not set.")

    app_env = (os.environ.get("APP_ENV") or "").strip().lower()
    if app_env in {"production", "prod"}:
        raise SystemExit(f"Refusing to seed: APP_ENV={app_env!r} looks like production.")

    u = urlparse(raw)
    if u.scheme not in ("postgresql", "postgres"):
        raise SystemExit(f"DATABASE_URL must be postgresql:// (got scheme={u.scheme!r}).")

    host = (u.hostname or "").lower()
    if host and _PROD_HOST_HINTS.search(host):
        raise SystemExit(f"Refusing to seed: DATABASE_URL host looks non-local ({host!r}).")

    if _PROD_HOST_HINTS.search(raw):
        raise SystemExit("Refusing to seed: DATABASE_URL looks like a managed/cloud connection string.")

    port = u.port
    user = (u.username or "").strip()
    db_name = (u.path or "").lstrip("/").split("/")[0]

    if host not in ("127.0.0.1", "localhost", "::1"):
        raise SystemExit(f"DATABASE_URL host must be loopback (got {host!r}).")

    if user != "gdc":
        raise SystemExit(f"DATABASE_URL user must be 'gdc' for this seed (got {user!r}).")

    allowed = {"datarelay", "gdc_e2e_test"}
    if local_dev_mode:
        allowed = allowed | {"gdc"}

    if db_name not in allowed:
        raise SystemExit(
            f"DATABASE_URL database must be one of {sorted(allowed)} (got {db_name!r}). "
            "Use --local-dev-mode only on a disposable local catalog named gdc."
        )

    if db_name in {"datarelay", "gdc_e2e_test"}:
        if port != 55432:
            raise SystemExit(f"DATABASE_URL port must be 55432 for datarelay/gdc_e2e_test (got {port!r}).")
    else:
        # gdc + local dev
        if port not in (5432, 55432):
            raise SystemExit(
                f"DATABASE_URL port must be 5432 or 55432 for local dev database 'gdc' (got {port!r})."
            )
        if not local_dev_mode:
            raise SystemExit("Database name 'gdc' requires --local-dev-mode (explicit local dev opt-in).")


def _load_env() -> VisibleSeedEnv:
    return VisibleSeedEnv(
        wiremock_base_url=_env("WIREMOCK_BASE_URL", "http://127.0.0.1:28080").rstrip("/"),
        webhook_base_url=_env("GDC_VISIBLE_E2E_WEBHOOK_BASE_URL", "http://127.0.0.1:18091").rstrip("/"),
        syslog_host=_env("GDC_VISIBLE_E2E_SYSLOG_HOST", "127.0.0.1"),
        syslog_plain_port=_env_int("GDC_VISIBLE_E2E_SYSLOG_PLAIN_PORT", 15514),
        syslog_tls_port=_env_int("GDC_VISIBLE_E2E_SYSLOG_TLS_PORT", 16514),
        minio_endpoint=_env("SOURCE_E2E_MINIO_ENDPOINT", "http://127.0.0.1:59000").rstrip("/"),
        minio_bucket=_env("SOURCE_E2E_MINIO_BUCKET", "gdc-source-e2e"),
        minio_access_key=_env("SOURCE_E2E_MINIO_ACCESS_KEY", "gdcminioaccess"),
        minio_secret_key=_env("SOURCE_E2E_MINIO_SECRET_KEY", "gdcminioaccesssecret12"),
        minio_prefix="e2e-s3/",
        pg_fixture_host=_env("SOURCE_E2E_PG_FIXTURE_HOST", "127.0.0.1"),
        pg_fixture_port=_env_int("SOURCE_E2E_PG_FIXTURE_PORT", 55433),
        pg_fixture_database=_env("SOURCE_E2E_PG_FIXTURE_DB", "gdc_query_fixture"),
        pg_fixture_user=_env("SOURCE_E2E_PG_FIXTURE_USER", "gdc_fixture"),
        pg_fixture_password=_env("SOURCE_E2E_PG_FIXTURE_PASSWORD", "gdc_fixture_pw"),
        sftp_host=_env("SOURCE_E2E_SFTP_HOST", "127.0.0.1"),
        sftp_port=_env_int("SOURCE_E2E_SFTP_PORT", 22222),
        sftp_user=_env("SOURCE_E2E_SFTP_USER", "gdc"),
        sftp_password=_env("SOURCE_E2E_SFTP_PASSWORD", "devlab123"),
    )


def _assert_local_service_urls(env: VisibleSeedEnv) -> None:
    """Refuse hostnames that could leave the machine (belt-and-suspenders)."""

    for label, url in (
        ("WIREMOCK_BASE_URL", env.wiremock_base_url),
        ("webhook", env.webhook_base_url),
        ("MINIO", env.minio_endpoint),
    ):
        h = urlparse(url).hostname or ""
        if h and h not in ("127.0.0.1", "localhost", "::1"):
            raise SystemExit(f"{label} must use loopback host for this seed (got {url!r}).")

    if env.syslog_host not in ("127.0.0.1", "localhost", "::1"):
        raise SystemExit(f"Syslog host must be loopback (got {env.syslog_host!r}).")

    if env.pg_fixture_host not in ("127.0.0.1", "localhost", "::1"):
        raise SystemExit(f"Fixture PostgreSQL host must be loopback (got {env.pg_fixture_host!r}).")

    if env.sftp_host not in ("127.0.0.1", "localhost", "::1"):
        raise SystemExit(f"SFTP host must be loopback (got {env.sftp_host!r}).")


def _upsert_destination(
    db: Session,
    *,
    name: str,
    destination_type: str,
    config_json: dict[str, Any],
    rate_limit_json: dict[str, Any],
) -> Destination:
    full = f"{PREFIX}{name}" if not name.startswith(PREFIX) else name
    validate_destination_config(destination_type, config_json)
    row = db.query(Destination).filter(Destination.name == full).first()
    if row is None:
        row = Destination(
            name=full,
            destination_type=destination_type,
            config_json=dict(config_json),
            rate_limit_json=dict(rate_limit_json),
            enabled=True,
        )
        db.add(row)
        db.flush()
        return row
    if not str(row.name).startswith(PREFIX):
        raise RuntimeError(f"refuse to modify non-lab destination id={row.id} name={row.name!r}")
    row.destination_type = destination_type
    row.config_json = dict(config_json)
    row.rate_limit_json = dict(rate_limit_json)
    row.enabled = True
    db.add(row)
    db.flush()
    return row


def _upsert_http_connector(db: Session, env: VisibleSeedEnv) -> tuple[Connector, Source]:
    name = f"{PREFIX}HTTP API Connector"
    row = db.query(Connector).filter(Connector.name == name).first()
    payload = ConnectorCreate.model_validate(
        {
            "name": name,
            "description": DESCRIPTION,
            "auth_type": "no_auth",
            "host": env.wiremock_base_url,
            "verify_ssl": False,
        }
    )
    if row is None:
        row = Connector(name=name, description=DESCRIPTION, status="RUNNING")
        db.add(row)
        db.flush()
        src = Source(
            connector_id=row.id,
            source_type="HTTP_API_POLLING",
            config_json=_build_config_json(payload, partial=False),
            auth_json=_build_auth_json(payload, partial=False),
            enabled=True,
        )
        db.add(src)
        db.flush()
        return row, src

    if not str(row.name).startswith(PREFIX):
        raise RuntimeError("refuse to modify connector without lab prefix")
    row.description = DESCRIPTION
    row.status = "RUNNING"
    db.add(row)
    src = (
        db.query(Source)
        .filter(Source.connector_id == int(row.id), Source.source_type == "HTTP_API_POLLING")
        .order_by(Source.id.asc())
        .first()
    )
    if src is None:
        src = Source(
            connector_id=row.id,
            source_type="HTTP_API_POLLING",
            config_json=_build_config_json(payload, partial=False),
            auth_json=_build_auth_json(payload, partial=False),
            enabled=True,
        )
        db.add(src)
    else:
        src.config_json = _build_config_json(payload, partial=False)
        src.auth_json = _build_auth_json(payload, partial=False)
        src.enabled = True
    db.add(src)
    db.flush()
    return row, src


def _upsert_s3_connector(db: Session, env: VisibleSeedEnv) -> tuple[Connector, Source]:
    name = f"{PREFIX}S3 Object Connector"
    row = db.query(Connector).filter(Connector.name == name).first()
    payload = ConnectorCreate.model_validate(
        {
            "name": name,
            "description": DESCRIPTION,
            "source_type": "S3_OBJECT_POLLING",
            "auth_type": "no_auth",
            "endpoint_url": env.minio_endpoint,
            "bucket": env.minio_bucket,
            "region": "us-east-1",
            "access_key": env.minio_access_key,
            "secret_key": env.minio_secret_key,
            "prefix": env.minio_prefix,
            "path_style_access": True,
            "use_ssl": env.minio_endpoint.lower().startswith("https://"),
        }
    )
    cfg = _build_s3_config_json(payload, partial=False)
    if row is None:
        row = Connector(name=name, description=DESCRIPTION, status="RUNNING")
        db.add(row)
        db.flush()
        src = Source(
            connector_id=row.id,
            source_type="S3_OBJECT_POLLING",
            config_json=cfg,
            auth_json={"auth_type": "no_auth"},
            enabled=True,
        )
        db.add(src)
        db.flush()
        return row, src

    row.description = DESCRIPTION
    row.status = "RUNNING"
    db.add(row)
    src = (
        db.query(Source)
        .filter(Source.connector_id == int(row.id), Source.source_type == "S3_OBJECT_POLLING")
        .order_by(Source.id.asc())
        .first()
    )
    if src is None:
        src = Source(
            connector_id=row.id,
            source_type="S3_OBJECT_POLLING",
            config_json=cfg,
            auth_json={"auth_type": "no_auth"},
            enabled=True,
        )
        db.add(src)
    else:
        src.config_json = cfg
        src.enabled = True
    db.add(src)
    db.flush()
    return row, src


def _upsert_database_connector(db: Session, env: VisibleSeedEnv) -> tuple[Connector, Source]:
    name = f"{PREFIX}Database Query Connector"
    row = db.query(Connector).filter(Connector.name == name).first()
    payload = ConnectorCreate.model_validate(
        {
            "name": name,
            "description": DESCRIPTION,
            "source_type": "DATABASE_QUERY",
            "auth_type": "no_auth",
            "db_type": "POSTGRESQL",
            "host": env.pg_fixture_host,
            "port": env.pg_fixture_port,
            "database": env.pg_fixture_database,
            "db_username": env.pg_fixture_user,
            "db_password": env.pg_fixture_password,
            "ssl_mode": "DISABLE",
            "connection_timeout_seconds": 30,
        }
    )
    cfg = _build_database_query_config_json(payload, partial=False)
    if row is None:
        row = Connector(name=name, description=DESCRIPTION, status="RUNNING")
        db.add(row)
        db.flush()
        src = Source(
            connector_id=row.id,
            source_type="DATABASE_QUERY",
            config_json=cfg,
            auth_json={"auth_type": "no_auth"},
            enabled=True,
        )
        db.add(src)
        db.flush()
        return row, src

    row.description = DESCRIPTION
    row.status = "RUNNING"
    db.add(row)
    src = (
        db.query(Source)
        .filter(Source.connector_id == int(row.id), Source.source_type == "DATABASE_QUERY")
        .order_by(Source.id.asc())
        .first()
    )
    if src is None:
        src = Source(
            connector_id=row.id,
            source_type="DATABASE_QUERY",
            config_json=cfg,
            auth_json={"auth_type": "no_auth"},
            enabled=True,
        )
        db.add(src)
    else:
        src.config_json = cfg
        src.enabled = True
    db.add(src)
    db.flush()
    return row, src


def _upsert_remote_file_connector(db: Session, env: VisibleSeedEnv) -> tuple[Connector, Source]:
    name = f"{PREFIX}Remote File Connector"
    row = db.query(Connector).filter(Connector.name == name).first()
    payload = ConnectorCreate.model_validate(
        {
            "name": name,
            "description": DESCRIPTION,
            "source_type": "REMOTE_FILE_POLLING",
            "auth_type": "no_auth",
            "host": env.sftp_host,
            "port": env.sftp_port,
            "remote_username": env.sftp_user,
            "remote_password": env.sftp_password,
            "remote_file_protocol": "sftp",
            "known_hosts_policy": "insecure_skip_verify",
            "connection_timeout_seconds": 25,
        }
    )
    cfg = _build_remote_file_config_json(payload, partial=False)
    if row is None:
        row = Connector(name=name, description=DESCRIPTION, status="RUNNING")
        db.add(row)
        db.flush()
        src = Source(
            connector_id=row.id,
            source_type="REMOTE_FILE_POLLING",
            config_json=cfg,
            auth_json={"auth_type": "no_auth"},
            enabled=True,
        )
        db.add(src)
        db.flush()
        return row, src

    row.description = DESCRIPTION
    row.status = "RUNNING"
    db.add(row)
    src = (
        db.query(Source)
        .filter(Source.connector_id == int(row.id), Source.source_type == "REMOTE_FILE_POLLING")
        .order_by(Source.id.asc())
        .first()
    )
    if src is None:
        src = Source(
            connector_id=row.id,
            source_type="REMOTE_FILE_POLLING",
            config_json=cfg,
            auth_json={"auth_type": "no_auth"},
            enabled=True,
        )
        db.add(src)
    else:
        src.config_json = cfg
        src.enabled = True
    db.add(src)
    db.flush()
    return row, src


def _upsert_stream(
    db: Session,
    *,
    connector: Connector,
    source: Source,
    stream_name: str,
    stream_type: str,
    config_json: dict[str, Any],
    polling_interval: int = 120,
) -> Stream:
    row = db.query(Stream).filter(Stream.name == stream_name).first()
    st = str(stream_type).strip().upper()
    if row is None:
        row = Stream(
            name=stream_name,
            connector_id=connector.id,
            source_id=source.id,
            stream_type=st,
            config_json=dict(config_json),
            polling_interval=int(polling_interval),
            enabled=True,
            status="RUNNING",
            rate_limit_json={"max_requests": 60, "per_seconds": 60},
        )
        db.add(row)
        db.flush()
        return row

    if not str(row.name).startswith(PREFIX):
        raise RuntimeError(f"refuse to modify stream without lab prefix: {row.name!r}")
    row.connector_id = int(connector.id)
    row.source_id = int(source.id)
    row.stream_type = st
    row.config_json = dict(config_json)
    row.polling_interval = int(polling_interval)
    row.enabled = True
    row.status = "RUNNING"
    db.add(row)
    db.flush()
    return row


def _upsert_mapping(
    db: Session,
    stream_id: int,
    *,
    event_array_path: str | None,
    event_root_path: str | None,
    field_mappings_json: dict[str, str],
) -> None:
    row = db.query(Mapping).filter(Mapping.stream_id == int(stream_id)).first()
    if row is None:
        db.add(
            Mapping(
                stream_id=int(stream_id),
                event_array_path=event_array_path,
                event_root_path=event_root_path,
                field_mappings_json=dict(field_mappings_json),
                raw_payload_mode="JSON",
            )
        )
        db.flush()
        return

    s = db.query(Stream).filter(Stream.id == int(row.stream_id)).first()
    if s is None or not str(s.name).startswith(PREFIX):
        raise RuntimeError("refuse to modify mapping for non-lab stream")
    row.event_array_path = event_array_path
    row.event_root_path = event_root_path
    row.field_mappings_json = dict(field_mappings_json)
    row.raw_payload_mode = "JSON"
    db.add(row)
    db.flush()


def _upsert_enrichment(db: Session, stream_id: int, *, tag: str) -> None:
    row = db.query(Enrichment).filter(Enrichment.stream_id == int(stream_id)).first()
    ej = {
        "vendor": "VisibleDevE2E",
        "product": "LocalLab",
        "log_type": f"visible_dev_e2e_{tag}",
        "event_source": "visible_dev_e2e",
        "collector_name": "visible-dev-e2e-seed",
        "tenant": "lab",
    }
    if row is None:
        db.add(
            Enrichment(
                stream_id=int(stream_id),
                enrichment_json=ej,
                override_policy="KEEP_EXISTING",
                enabled=True,
            )
        )
        db.flush()
        return

    s = db.query(Stream).filter(Stream.id == int(stream_id)).first()
    if s is None or not str(s.name).startswith(PREFIX):
        raise RuntimeError("refuse to modify enrichment for non-lab stream")
    row.enrichment_json = ej
    row.override_policy = "KEEP_EXISTING"
    row.enabled = True
    db.add(row)
    db.flush()


def _upsert_checkpoint(db: Session, stream_id: int) -> None:
    row = db.query(Checkpoint).filter(Checkpoint.stream_id == int(stream_id)).first()
    if row is None:
        db.add(
            Checkpoint(
                stream_id=int(stream_id),
                checkpoint_type="CUSTOM_FIELD",
                checkpoint_value_json={"last_cursor": None, "last_seen_id": None},
            )
        )
        db.flush()
        return

    s = db.query(Stream).filter(Stream.id == int(stream_id)).first()
    if s is None or not str(s.name).startswith(PREFIX):
        raise RuntimeError("refuse to modify checkpoint for non-lab stream")
    return


def _upsert_route(
    db: Session,
    *,
    stream_id: int,
    destination_id: int,
    failure_policy: str = "LOG_AND_CONTINUE",
) -> None:
    row = (
        db.query(Route)
        .filter(Route.stream_id == int(stream_id), Route.destination_id == int(destination_id))
        .first()
    )
    fmt = {"message_format": "json"}
    if row is None:
        db.add(
            Route(
                stream_id=int(stream_id),
                destination_id=int(destination_id),
                enabled=True,
                failure_policy=failure_policy,
                formatter_config_json=dict(fmt),
                rate_limit_json={"max_events": 2000, "per_seconds": 1},
                status="ENABLED",
            )
        )
        db.flush()
        return

    st = db.query(Stream).filter(Stream.id == int(stream_id)).first()
    de = db.query(Destination).filter(Destination.id == int(destination_id)).first()
    if st is None or not str(st.name).startswith(PREFIX):
        raise RuntimeError("refuse to modify route for non-lab stream")
    if de is None or not str(de.name).startswith(PREFIX):
        raise RuntimeError("refuse to modify route to non-lab destination")
    row.enabled = True
    row.failure_policy = failure_policy
    row.formatter_config_json = dict(fmt)
    row.rate_limit_json = {"max_events": 2000, "per_seconds": 1}
    row.status = "ENABLED"
    db.add(row)
    db.flush()


def seed_visible_e2e_fixtures(db: Session, *, local_dev_mode: bool) -> dict[str, Any]:
    assert_safe_database_url(local_dev_mode=local_dev_mode)
    env = _load_env()
    _assert_local_service_urls(env)

    rl = {"max_events": 2000, "per_seconds": 1}

    dest_wh = _upsert_destination(
        db,
        name="Webhook Destination",
        destination_type="WEBHOOK_POST",
        config_json={
            "url": f"{env.webhook_base_url}/dev-visible-e2e",
            "method": "POST",
            "headers": {"Content-Type": "application/json"},
            "timeout_seconds": 30,
            "retry_count": 2,
            "retry_backoff_seconds": 0.05,
        },
        rate_limit_json=rl,
    )
    dest_udp = _upsert_destination(
        db,
        name="Syslog UDP Destination",
        destination_type="SYSLOG_UDP",
        config_json={"host": env.syslog_host, "port": env.syslog_plain_port, "timeout_seconds": 5},
        rate_limit_json=rl,
    )
    dest_tcp = _upsert_destination(
        db,
        name="Syslog TCP Destination",
        destination_type="SYSLOG_TCP",
        config_json={"host": env.syslog_host, "port": env.syslog_plain_port, "timeout_seconds": 5},
        rate_limit_json=rl,
    )
    dest_tls = _upsert_destination(
        db,
        name="Syslog TLS Destination",
        destination_type="SYSLOG_TLS",
        config_json={
            "host": env.syslog_host,
            "port": env.syslog_tls_port,
            "tls_enabled": True,
            "tls_verify_mode": "insecure_skip_verify",
            "timeout_seconds": 5,
        },
        rate_limit_json=rl,
    )

    http_c, http_s = _upsert_http_connector(db, env)
    s3_c, s3_s = _upsert_s3_connector(db, env)
    db_c, db_s = _upsert_database_connector(db, env)
    rf_c, rf_s = _upsert_remote_file_connector(db, env)

    st_http = _upsert_stream(
        db,
        connector=http_c,
        source=http_s,
        stream_name=f"{PREFIX}HTTP API Stream",
        stream_type="HTTP_API_POLLING",
        config_json={"endpoint": "/api/v1/e2e-auth/no-auth-events", "method": "GET", "timeout_seconds": 45},
    )
    st_s3 = _upsert_stream(
        db,
        connector=s3_c,
        source=s3_s,
        stream_name=f"{PREFIX}S3 Object Stream",
        stream_type="S3_OBJECT_POLLING",
        config_json={"max_objects_per_run": 25},
    )
    st_db = _upsert_stream(
        db,
        connector=db_c,
        source=db_s,
        stream_name=f"{PREFIX}Database Query Stream",
        stream_type="DATABASE_QUERY",
        config_json={
            "query": (
                "SELECT id, event_id, message, severity, event_ts, ordering_seq "
                "FROM source_e2e_rows ORDER BY id"
            ),
            "max_rows_per_run": 80,
            "checkpoint_mode": "SINGLE_COLUMN",
            "checkpoint_column": "id",
            "query_timeout_seconds": 45,
        },
    )
    st_rf = _upsert_stream(
        db,
        connector=rf_c,
        source=rf_s,
        stream_name=f"{PREFIX}Remote File Stream",
        stream_type="REMOTE_FILE_POLLING",
        config_json={
            "remote_directory": "upload",
            "file_pattern": "e2e-remote.ndjson",
            "recursive": False,
            "parser_type": "NDJSON",
            "max_files_per_run": 15,
            "max_file_size_mb": 8,
        },
    )

    _upsert_mapping(
        db,
        st_http.id,
        event_array_path="$.data",
        event_root_path=None,
        field_mappings_json=DEFAULT_FIELD_MAPPINGS,
    )
    _upsert_mapping(db, st_s3.id, event_array_path=None, event_root_path=None, field_mappings_json=DEFAULT_FIELD_MAPPINGS)
    _upsert_mapping(db, st_db.id, event_array_path=None, event_root_path=None, field_mappings_json=DB_FIELD_MAPPINGS)
    _upsert_mapping(db, st_rf.id, event_array_path=None, event_root_path=None, field_mappings_json=DEFAULT_FIELD_MAPPINGS)

    _upsert_enrichment(db, int(st_http.id), tag="http")
    _upsert_enrichment(db, int(st_s3.id), tag="s3")
    _upsert_enrichment(db, int(st_db.id), tag="db")
    _upsert_enrichment(db, int(st_rf.id), tag="remote")

    for sid in (st_http.id, st_s3.id, st_db.id, st_rf.id):
        _upsert_checkpoint(db, int(sid))

    for sid in (st_http.id, st_s3.id, st_db.id, st_rf.id):
        _upsert_route(db, stream_id=int(sid), destination_id=int(dest_wh.id))

    for dest in (dest_udp, dest_tcp, dest_tls):
        _upsert_route(db, stream_id=int(st_http.id), destination_id=int(dest.id))

    db.commit()
    return {
        "ok": True,
        "connectors": [http_c.name, s3_c.name, db_c.name, rf_c.name],
        "streams": [st_http.name, st_s3.name, st_db.name, st_rf.name],
        "destinations": [dest_wh.name, dest_udp.name, dest_tcp.name, dest_tls.name],
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Seed [DEV E2E] UI-visible fixtures into the platform catalog DB.")
    p.add_argument(
        "--local-dev-mode",
        action="store_true",
        help="Allow DATABASE_URL database name 'gdc' on loopback (explicit local disposable catalog only).",
    )
    args = p.parse_args(argv)

    from app.database import SessionLocal

    assert_safe_database_url(local_dev_mode=bool(args.local_dev_mode))
    _assert_local_service_urls(_load_env())

    db = SessionLocal()
    try:
        out = seed_visible_e2e_fixtures(db, local_dev_mode=bool(args.local_dev_mode))
        print(out)
        return 0
    except Exception as exc:
        db.rollback()
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
