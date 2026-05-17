"""Additive idempotent seeding of development validation lab entities (PostgreSQL ORM only)."""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.connectors.router import _build_auth_json, _build_config_json
from app.connectors.schemas import ConnectorCreate
from app.destinations.models import Destination
from app.dev_validation_lab import templates as T
from app.enrichments.models import Enrichment
from app.mappings.models import Mapping
from app.routes.models import Route
from app.sources.models import Source
from app.streams.models import Stream
from app.validation.models import ContinuousValidation

logger = logging.getLogger(__name__)


def lab_effective() -> bool:
    """True when lab seeding is allowed for this process (never in production packaging)."""

    from app.config import settings

    if not settings.ENABLE_DEV_VALIDATION_LAB:
        return False
    env = (settings.APP_ENV or "").strip().lower()
    if env in {"production", "prod"}:
        return False
    return True


def _lab(s: str) -> str:
    return f"{T.LAB_NAME_PREFIX}{s}"


def _get_connector_by_name(db: Session, name: str) -> Connector | None:
    return db.query(Connector).filter(Connector.name == name).first()


def _rename_lab_stream_if_exists(db: Session, *, old_name: str, new_name: str) -> None:
    """Rename a lab stream row when titles change (idempotent; avoids duplicate streams)."""

    if old_name == new_name:
        return
    row = db.query(Stream).filter(Stream.name == old_name).first()
    if row is None:
        return
    collision = db.query(Stream).filter(Stream.name == new_name).first()
    if collision is not None and int(collision.id) != int(row.id):
        return
    row.name = new_name
    db.flush()


def _load_http_source(db: Session, connector_id: int) -> Source | None:
    return (
        db.query(Source)
        .filter(Source.connector_id == int(connector_id), Source.source_type == "HTTP_API_POLLING")
        .order_by(Source.id.asc())
        .first()
    )


def _ensure_minio_s3_connector(db: Session, settings_obj: Any) -> tuple[Connector, Source]:
    """S3-only lab connector when ENABLE_DEV_VALIDATION_S3 and credentials are set."""

    name = _lab("MinIO S3")
    existing = _get_connector_by_name(db, name)
    if existing:
        src = (
            db.query(Source)
            .filter(Source.connector_id == int(existing.id), Source.source_type == "S3_OBJECT_POLLING")
            .order_by(Source.id.asc())
            .first()
        )
        if src is None:
            raise RuntimeError(f"lab connector {name} missing S3_OBJECT_POLLING source")
        endpoint = str(settings_obj.MINIO_ENDPOINT).rstrip("/")
        bucket = str(settings_obj.MINIO_BUCKET).strip() or "gdc-test-logs"
        cfg = dict(src.config_json or {})
        desired = {
            "endpoint_url": endpoint,
            "bucket": bucket,
            "region": "us-east-1",
            "access_key": str(settings_obj.MINIO_ACCESS_KEY).strip(),
            "secret_key": str(settings_obj.MINIO_SECRET_KEY).strip(),
            "prefix": "security/",
            "path_style_access": True,
            "use_ssl": str(endpoint).lower().startswith("https://"),
        }
        if cfg != desired:
            src.config_json = desired
            db.flush()
        return existing, src

    row = Connector(name=name, description=T.LAB_DESCRIPTION, status="RUNNING")
    db.add(row)
    db.flush()
    endpoint = str(settings_obj.MINIO_ENDPOINT).rstrip("/")
    bucket = str(settings_obj.MINIO_BUCKET).strip() or "gdc-test-logs"
    cfg = {
        "endpoint_url": endpoint,
        "bucket": bucket,
        "region": "us-east-1",
        "access_key": str(settings_obj.MINIO_ACCESS_KEY).strip(),
        "secret_key": str(settings_obj.MINIO_SECRET_KEY).strip(),
        "prefix": "security/",
        "path_style_access": True,
        "use_ssl": str(endpoint).lower().startswith("https://"),
    }
    source = Source(
        connector_id=row.id,
        source_type="S3_OBJECT_POLLING",
        config_json=cfg,
        auth_json={"auth_type": "no_auth"},
        enabled=True,
    )
    db.add(source)
    db.flush()
    logger.info("%s", {"stage": "dev_validation_lab_minio_connector_created", "connector_id": row.id, "name": name})
    return row, source


def _ensure_connector(db: Session, *, wm_base: str, label: str, auth_type: str, extra: dict[str, Any]) -> tuple[Connector, Source]:
    name = _lab(label)
    existing = _get_connector_by_name(db, name)
    if existing:
        src = _load_http_source(db, existing.id)
        if src is None:
            raise RuntimeError(f"lab connector {name} missing HTTP source")
        payload_dict: dict[str, Any] = {
            "name": name,
            "description": T.LAB_DESCRIPTION,
            "auth_type": auth_type,
            "host": wm_base,
            "verify_ssl": False,
            **extra,
        }
        cc = ConnectorCreate.model_validate(payload_dict)
        desired_cfg = _build_config_json(cc, partial=False)
        desired_auth = _build_auth_json(cc, partial=False)
        if dict(src.config_json or {}) != desired_cfg or dict(src.auth_json or {}) != desired_auth:
            src.config_json = desired_cfg
            src.auth_json = desired_auth
            db.flush()
        return existing, src

    payload_dict: dict[str, Any] = {
        "name": name,
        "description": T.LAB_DESCRIPTION,
        "auth_type": auth_type,
        "host": wm_base,
        "verify_ssl": False,
        **extra,
    }
    cc = ConnectorCreate.model_validate(payload_dict)
    row = Connector(name=cc.name.strip(), description=cc.description, status="RUNNING")
    db.add(row)
    db.flush()
    source = Source(
        connector_id=row.id,
        source_type="HTTP_API_POLLING",
        config_json=_build_config_json(cc, partial=False),
        auth_json=_build_auth_json(cc, partial=False),
        enabled=True,
    )
    db.add(source)
    db.flush()
    logger.info("%s", {"stage": "dev_validation_lab_connector_created", "connector_id": row.id, "name": name})
    return row, source


def _ensure_destination(
    db: Session,
    *,
    name: str,
    destination_type: str,
    config_json: dict[str, Any],
) -> Destination:
    full = _lab(name)
    row = db.query(Destination).filter(Destination.name == full).first()
    if row:
        if dict(row.config_json or {}) != dict(config_json):
            row.config_json = dict(config_json)
            db.flush()
        return row
    row = Destination(
        name=full,
        destination_type=destination_type,
        config_json=config_json,
        rate_limit_json={"max_events": 2000, "per_seconds": 1},
        enabled=True,
    )
    db.add(row)
    db.flush()
    logger.info("%s", {"stage": "dev_validation_lab_destination_created", "destination_id": row.id, "name": full})
    return row


def _health_scoring_exclude_config(config_json: dict[str, Any]) -> dict[str, Any]:
    out = dict(config_json)
    out["exclude_from_health_scoring"] = True
    out["validation_expected_failure"] = True
    return out


def _sync_stream_health_scoring_exclusion(db: Session, stream_id: int, *, excluded: bool) -> None:
    row = db.query(Stream).filter(Stream.id == int(stream_id)).first()
    if row is None:
        return
    cfg = dict(row.config_json or {})
    if excluded:
        cfg = _health_scoring_exclude_config(cfg)
    else:
        cfg.pop("exclude_from_health_scoring", None)
        cfg.pop("validation_expected_failure", None)
    if cfg == dict(row.config_json or {}):
        return
    row.config_json = cfg
    db.flush()


def _ensure_stream(
    db: Session,
    *,
    connector: Connector,
    source: Source,
    stream_title: str,
    config_json: dict[str, Any],
    polling_interval: int = 120,
    stream_type: str = "HTTP_API_POLLING",
    exclude_from_health_scoring: bool = False,
) -> Stream:
    name = _lab(stream_title)
    cfg = _health_scoring_exclude_config(config_json) if exclude_from_health_scoring else dict(config_json)
    row = db.query(Stream).filter(Stream.name == name).first()
    if row:
        if exclude_from_health_scoring:
            _sync_stream_health_scoring_exclusion(db, int(row.id), excluded=True)
        return row
    row = Stream(
        name=name,
        connector_id=connector.id,
        source_id=source.id,
        stream_type=str(stream_type or "HTTP_API_POLLING").strip().upper(),
        config_json=cfg,
        polling_interval=polling_interval,
        enabled=True,
        status="RUNNING",
        rate_limit_json={"max_requests": 30, "per_seconds": 60},
    )
    db.add(row)
    db.flush()
    logger.info("%s", {"stage": "dev_validation_lab_stream_created", "stream_id": row.id, "name": name})
    return row


def _ensure_mapping(
    db: Session,
    stream_id: int,
    *,
    event_array_path: str | None,
    event_root_path: str | None,
    field_mappings_json: dict[str, str],
) -> None:
    row = db.query(Mapping).filter(Mapping.stream_id == int(stream_id)).first()
    if row:
        return
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


def _ensure_enrichment(db: Session, stream_id: int, *, tag: str) -> None:
    row = db.query(Enrichment).filter(Enrichment.stream_id == int(stream_id)).first()
    ej = dict(T.DEFAULT_ENRICHMENT)
    ej["log_type"] = f"dev_validation_lab_{tag}"
    if row:
        return
    db.add(
        Enrichment(
            stream_id=int(stream_id),
            enrichment_json=ej,
            override_policy="KEEP_EXISTING",
            enabled=True,
        )
    )
    db.flush()


def _ensure_checkpoint(db: Session, stream_id: int) -> None:
    row = db.query(Checkpoint).filter(Checkpoint.stream_id == int(stream_id)).first()
    if row:
        return
    db.add(
        Checkpoint(
            stream_id=int(stream_id),
            checkpoint_type="CUSTOM_FIELD",
            checkpoint_value_json={"last_cursor": None, "last_seen_id": None},
        )
    )
    db.flush()


def _ensure_route(
    db: Session,
    *,
    stream_id: int,
    destination_id: int,
    failure_policy: str,
    formatter: dict[str, Any] | None = None,
) -> None:
    existing = (
        db.query(Route)
        .filter(Route.stream_id == int(stream_id), Route.destination_id == int(destination_id))
        .first()
    )
    if existing:
        return
    db.add(
        Route(
            stream_id=int(stream_id),
            destination_id=int(destination_id),
            enabled=True,
            failure_policy=failure_policy,
            formatter_config_json=dict(formatter or {"message_format": "json"}),
            rate_limit_json={"max_events": 500, "per_seconds": 1},
            status="ENABLED",
        )
    )
    db.flush()


def _ensure_validation(
    db: Session,
    *,
    template_key: str,
    name: str,
    validation_type: str,
    stream_id: int,
    schedule_seconds: int = 180,
    expect_checkpoint_advance: bool = True,
    enabled: bool = True,
) -> None:
    row = db.query(ContinuousValidation).filter(ContinuousValidation.template_key == template_key).first()
    if row:
        if row.target_stream_id != int(stream_id):
            row.target_stream_id = int(stream_id)
        row.enabled = bool(enabled)
        row.validation_type = str(validation_type)
        row.expect_checkpoint_advance = bool(expect_checkpoint_advance)
        row.schedule_seconds = int(schedule_seconds)
        return
    db.add(
        ContinuousValidation(
            name=_lab(name),
            enabled=enabled,
            validation_type=str(validation_type),
            target_stream_id=int(stream_id),
            template_key=template_key,
            schedule_seconds=int(schedule_seconds),
            expect_checkpoint_advance=bool(expect_checkpoint_advance),
            last_status="HEALTHY" if enabled else "DISABLED",
            consecutive_failures=0,
        )
    )
    db.flush()


def _lab_inventory_counts(db: Session) -> dict[str, int]:
    """Post-commit counts of lab-scoped rows (names / template_key prefixes)."""

    p = T.LAB_NAME_PREFIX
    tk = T.LAB_TEMPLATE_KEY_PREFIX
    conn = int(db.query(func.count(Connector.id)).filter(Connector.name.startswith(p)).scalar() or 0)
    strm = int(db.query(func.count(Stream.id)).filter(Stream.name.startswith(p)).scalar() or 0)
    dest = int(db.query(func.count(Destination.id)).filter(Destination.name.startswith(p)).scalar() or 0)
    val = int(
        db.query(func.count(ContinuousValidation.id))
        .filter(
            or_(
                ContinuousValidation.name.startswith(p),
                and_(ContinuousValidation.template_key.isnot(None), ContinuousValidation.template_key.startswith(tk)),
            )
        )
        .scalar()
        or 0
    )
    lab_stream_ids = [int(r[0]) for r in db.query(Stream.id).filter(Stream.name.startswith(p)).all()]
    routes = 0
    maps = 0
    if lab_stream_ids:
        routes = int(db.query(func.count(Route.id)).filter(Route.stream_id.in_(lab_stream_ids)).scalar() or 0)
        maps = int(db.query(func.count(Mapping.id)).filter(Mapping.stream_id.in_(lab_stream_ids)).scalar() or 0)
    return {
        "connectors_in_db": conn,
        "streams_in_db": strm,
        "destinations_in_db": dest,
        "routes_for_lab_streams": routes,
        "mappings_for_lab_streams": maps,
        "validations_lab_template_or_name": val,
    }


def seed_dev_validation_lab(db: Session) -> dict[str, Any]:
    """Create lab destinations, connectors, streams, routes, mappings, checkpoints, validations. Idempotent."""

    from app.config import settings

    if not lab_effective():
        return {"skipped": True, "reason": "lab_disabled_or_production"}

    wm = str(settings.DEV_VALIDATION_WIREMOCK_BASE_URL).rstrip("/")
    wh = str(settings.DEV_VALIDATION_WEBHOOK_BASE_URL).rstrip("/")
    sy_host = str(settings.DEV_VALIDATION_SYSLOG_HOST).strip()
    sy_port = int(settings.DEV_VALIDATION_SYSLOG_PORT)

    dest_webhook = _ensure_destination(
        db,
        name="Webhook Echo",
        destination_type="WEBHOOK_POST",
        config_json={
            "url": f"{wh}/dev-validation-lab",
            "method": "POST",
            "headers": {"Content-Type": "application/json"},
            "timeout_seconds": 30,
            "retry_count": 2,
            "retry_backoff_seconds": 0.05,
        },
    )
    dest_sys_udp = _ensure_destination(
        db,
        name="Syslog UDP",
        destination_type="SYSLOG_UDP",
        config_json={"host": sy_host, "port": sy_port, "timeout_seconds": 5},
    )
    dest_sys_tcp = _ensure_destination(
        db,
        name="Syslog TCP",
        destination_type="SYSLOG_TCP",
        config_json={"host": sy_host, "port": sy_port, "timeout_seconds": 5},
    )
    dest_wm_retry = _ensure_destination(
        db,
        name="Webhook WireMock retry",
        destination_type="WEBHOOK_POST",
        config_json={
            "url": f"{wm}/wiremock-integration/receiver-retry-once",
            "method": "POST",
            "headers": {"Content-Type": "application/json"},
            "timeout_seconds": 30,
            "retry_count": 4,
            "retry_backoff_seconds": 0.05,
        },
    )

    connectors: dict[str, tuple[Connector, Source]] = {}
    for label, auth_type, extra in T.CONNECTOR_SPECS:
        ex = dict(extra)
        if auth_type == "oauth2_client_credentials":
            tok = ex.get("oauth2_token_url")
            if tok == "__DEV_LAB_WM_TOKEN_REJECT__":
                ex["oauth2_token_url"] = f"{wm}/oauth2/default/v1/token-reject"
            elif not str(tok or "").strip():
                ex["oauth2_token_url"] = f"{wm}/oauth2/default/v1/token"
        if auth_type == "jwt_refresh_token" and not str(ex.get("token_url") or "").strip():
            ex["token_url"] = f"{wm}/oauth2/lab/refresh"
        if auth_type == "vendor_jwt_exchange" and "token_url" not in ex:
            ex["token_url"] = f"{wm}/connect/api/v1/access_token"
        if auth_type == "session_login":
            ex["login_url"] = wm
        connectors[label] = _ensure_connector(db, wm_base=wm, label=label, auth_type=auth_type, extra=ex)

    def _c(label: str) -> tuple[Connector, Source]:
        return connectors[label]

    # Canonical stream titles (rename legacy lab rows so operators keep one row per scenario).
    _rename_lab_stream_if_exists(db, old_name=_lab("Stream oauth2-system-log"), new_name=_lab("Stream OAuth2 client-credentials"))
    _rename_lab_stream_if_exists(db, old_name=_lab("s3-security-events"), new_name=_lab("Stream s3-basic"))
    _rename_lab_stream_if_exists(db, old_name=_lab("postgresql-security-events"), new_name=_lab("Stream db-query-basic"))
    _rename_lab_stream_if_exists(db, old_name=_lab("mysql-security-events"), new_name=_lab("Stream db-query-mysql"))
    _rename_lab_stream_if_exists(db, old_name=_lab("mariadb-security-events"), new_name=_lab("Stream db-query-mariadb"))
    _rename_lab_stream_if_exists(db, old_name=_lab("sftp-ndjson-security"), new_name=_lab("Stream remote-file-basic"))
    _rename_lab_stream_if_exists(db, old_name=_lab("scp-json-security"), new_name=_lab("Stream remote-file-scp-json"))

    # --- Streams (see docs/testing/dev-validation-lab.md) ---
    s_single = _ensure_stream(
        db,
        connector=_c("Generic REST")[0],
        source=_c("Generic REST")[1],
        stream_title="Stream single-object",
        config_json={"endpoint": "/api/v1/e2e-data/single-object", "method": "GET", "timeout_seconds": 45},
    )
    s_array = _ensure_stream(
        db,
        connector=_c("Generic REST")[0],
        source=_c("Generic REST")[1],
        stream_title="Stream array-response",
        config_json={"endpoint": "/api/v1/e2e-auth/no-auth-events", "method": "GET"},
    )
    s_nested = _ensure_stream(
        db,
        connector=_c("Generic REST")[0],
        source=_c("Generic REST")[1],
        stream_title="Stream nested-array",
        config_json={"endpoint": "/api/v1/e2e-data/nested-array", "method": "GET"},
    )
    s_empty = _ensure_stream(
        db,
        connector=_c("Generic REST")[0],
        source=_c("Generic REST")[1],
        stream_title="Stream empty-response",
        config_json={"endpoint": "/api/v1/e2e-data/empty-array", "method": "GET"},
        exclude_from_health_scoring=True,
    )
    s_post = _ensure_stream(
        db,
        connector=_c("Bearer")[0],
        source=_c("Bearer")[1],
        stream_title="Stream post-json-body",
        config_json={
            "endpoint": "/api/v1/e2e-data/search",
            "method": "POST",
            "body": {"q": "dev-validation-lab"},
            "timeout_seconds": 45,
        },
    )
    s_page = _ensure_stream(
        db,
        connector=_c("Basic Auth")[0],
        source=_c("Basic Auth")[1],
        stream_title="Stream pagination-sample",
        config_json={"endpoint": "/api/v1/e2e-data/paged", "method": "GET", "params": {"page": "1"}},
    )
    s_auth = _ensure_stream(
        db,
        connector=_c("API Key")[0],
        source=_c("API Key")[1],
        stream_title="Stream auth-only",
        config_json={"endpoint": "/api/v1/e2e-auth/apikey-header-events", "method": "GET"},
        exclude_from_health_scoring=True,
    )
    s_delivery = _ensure_stream(
        db,
        connector=_c("Bearer")[0],
        source=_c("Bearer")[1],
        stream_title="Stream delivery-only",
        config_json={"endpoint": "/api/v1/events", "method": "GET"},
    )
    s_vendor = _ensure_stream(
        db,
        connector=_c("Vendor JWT")[0],
        source=_c("Vendor JWT")[1],
        stream_title="Stream vendor-malop",
        config_json={
            "endpoint": "/connect/api/dataexport/anomalies/malop/_search",
            "method": "POST",
            "body": {"queryString": "", "filters": {}},
            "timeout_seconds": 60,
        },
    )
    s_okta = _ensure_stream(
        db,
        connector=_c("OAuth2")[0],
        source=_c("OAuth2")[1],
        stream_title="Stream OAuth2 client-credentials",
        config_json={"endpoint": "/api/v1/logs", "method": "GET"},
    )
    s_oauth_jwt = _ensure_stream(
        db,
        connector=_c("OAuth2 JWT refresh")[0],
        source=_c("OAuth2 JWT refresh")[1],
        stream_title="Stream OAuth2 refresh-cycle (JWT token URL)",
        config_json={"endpoint": "/api/v1/logs", "method": "GET"},
    )
    s_oauth_fail = _ensure_stream(
        db,
        connector=_c("OAuth2 token exchange failure")[0],
        source=_c("OAuth2 token exchange failure")[1],
        stream_title="Stream OAuth2 token-exchange-failure",
        config_json={"endpoint": "/api/v1/logs", "method": "GET"},
        exclude_from_health_scoring=True,
    )
    s_sess = _ensure_stream(
        db,
        connector=_c("Session Login")[0],
        source=_c("Session Login")[1],
        stream_title="Stream session-events",
        config_json={"endpoint": "/e2e-session/events", "method": "GET"},
    )

    # Mappings / enrichments / checkpoints
    _ensure_mapping(db, s_single.id, event_array_path=None, event_root_path=None, field_mappings_json=T.DEFAULT_FIELD_MAPPINGS)
    _ensure_mapping(db, s_array.id, event_array_path="$.data", event_root_path=None, field_mappings_json=T.DEFAULT_FIELD_MAPPINGS)
    _ensure_mapping(
        db, s_nested.id, event_array_path="$.outer.inner.records", event_root_path=None, field_mappings_json=T.DEFAULT_FIELD_MAPPINGS
    )
    _ensure_mapping(db, s_empty.id, event_array_path="$.data", event_root_path=None, field_mappings_json=T.DEFAULT_FIELD_MAPPINGS)
    _ensure_mapping(db, s_post.id, event_array_path="$.data", event_root_path=None, field_mappings_json=T.DEFAULT_FIELD_MAPPINGS)
    _ensure_mapping(db, s_page.id, event_array_path="$.data", event_root_path=None, field_mappings_json=T.DEFAULT_FIELD_MAPPINGS)
    _ensure_mapping(db, s_auth.id, event_array_path="$.data", event_root_path=None, field_mappings_json=T.DEFAULT_FIELD_MAPPINGS)
    _ensure_mapping(db, s_delivery.id, event_array_path="$.data", event_root_path=None, field_mappings_json=T.DEFAULT_FIELD_MAPPINGS)
    _ensure_mapping(db, s_vendor.id, event_array_path="$.data", event_root_path=None, field_mappings_json=T.MALOP_FIELD_MAPPINGS)
    _ensure_mapping(db, s_okta.id, event_array_path=None, event_root_path=None, field_mappings_json=T.OKTA_FIELD_MAPPINGS)
    _ensure_mapping(db, s_oauth_jwt.id, event_array_path=None, event_root_path=None, field_mappings_json=T.OKTA_FIELD_MAPPINGS)
    _ensure_mapping(db, s_oauth_fail.id, event_array_path=None, event_root_path=None, field_mappings_json=T.OKTA_FIELD_MAPPINGS)
    _ensure_mapping(db, s_sess.id, event_array_path="$.data", event_root_path=None, field_mappings_json=T.DEFAULT_FIELD_MAPPINGS)

    for sid, tag in (
        (s_single.id, "single"),
        (s_array.id, "array"),
        (s_nested.id, "nested"),
        (s_empty.id, "empty"),
        (s_post.id, "post"),
        (s_page.id, "page"),
        (s_auth.id, "auth"),
        (s_delivery.id, "delivery"),
        (s_vendor.id, "vendor"),
        (s_okta.id, "okta"),
        (s_oauth_jwt.id, "oauth_jwt_refresh"),
        (s_oauth_fail.id, "oauth_token_fail"),
        (s_sess.id, "session"),
    ):
        _ensure_enrichment(db, int(sid), tag=tag)
        _ensure_checkpoint(db, int(sid))

    # Routes: default webhook; delivery fan-out; vendor dual routes
    for sid in (
        s_single.id,
        s_array.id,
        s_nested.id,
        s_empty.id,
        s_post.id,
        s_page.id,
        s_auth.id,
        s_okta.id,
        s_oauth_jwt.id,
        s_oauth_fail.id,
        s_sess.id,
    ):
        _ensure_route(db, stream_id=int(sid), destination_id=int(dest_webhook.id), failure_policy="LOG_AND_CONTINUE")

    _ensure_route(db, stream_id=int(s_delivery.id), destination_id=int(dest_wm_retry.id), failure_policy="RETRY_AND_BACKOFF")
    _ensure_route(db, stream_id=int(s_delivery.id), destination_id=int(dest_sys_udp.id), failure_policy="LOG_AND_CONTINUE")
    _ensure_route(db, stream_id=int(s_delivery.id), destination_id=int(dest_sys_tcp.id), failure_policy="LOG_AND_CONTINUE")

    _ensure_route(db, stream_id=int(s_vendor.id), destination_id=int(dest_webhook.id), failure_policy="LOG_AND_CONTINUE")
    _ensure_route(db, stream_id=int(s_vendor.id), destination_id=int(dest_sys_tcp.id), failure_policy="LOG_AND_CONTINUE")

    # Continuous validations
    _ensure_validation(
        db,
        template_key=T.TK_AUTH_EMPTY,
        name="Validation AUTH empty-response",
        validation_type="AUTH_ONLY",
        stream_id=int(s_empty.id),
        expect_checkpoint_advance=False,
    )
    _ensure_validation(
        db,
        template_key=T.TK_FETCH_ARRAY,
        name="Validation FETCH array-response",
        validation_type="FETCH_ONLY",
        stream_id=int(s_array.id),
    )
    _ensure_validation(
        db,
        template_key=T.TK_AUTH_APIKEY,
        name="Validation AUTH auth-only",
        validation_type="AUTH_ONLY",
        stream_id=int(s_auth.id),
        expect_checkpoint_advance=False,
    )
    for tk, title, sid in (
        (T.TK_FULL_SINGLE, "Validation FULL single-object", s_single.id),
        (T.TK_FULL_NESTED, "Validation FULL nested-array", s_nested.id),
        (T.TK_FULL_POST, "Validation FULL post-json-body", s_post.id),
        (T.TK_FULL_PAGE, "Validation FULL pagination-sample", s_page.id),
        (T.TK_FULL_DELIVERY, "Validation FULL delivery-only", s_delivery.id),
        (T.TK_FULL_VENDOR, "Validation FULL vendor-malop", s_vendor.id),
        (T.TK_FULL_OKTA, "Validation FULL OAuth2 client-credentials", s_okta.id),
        (T.TK_OAUTH_JWT_REFRESH_FULL, "Validation FULL OAuth2 refresh-cycle (JWT)", s_oauth_jwt.id),
        (T.TK_FULL_SESSION, "Validation FULL session-events", s_sess.id),
        (T.TK_FULL_ARRAY, "Validation FULL array-response", s_array.id),
    ):
        _ensure_validation(
            db,
            template_key=tk,
            name=title,
            validation_type="FULL_RUNTIME",
            stream_id=int(sid),
            expect_checkpoint_advance=True,
        )

    _ensure_validation(
        db,
        template_key=T.TK_OAUTH_TOKEN_EXCHANGE_FAIL,
        name="Validation OAuth2 token-exchange-failure (manual)",
        validation_type="AUTH_ONLY",
        stream_id=int(s_oauth_fail.id),
        expect_checkpoint_advance=False,
        enabled=False,
        schedule_seconds=600,
    )

    s3_seeded = False
    db_query_seeded = False
    remote_file_seeded = False

    if bool(getattr(settings, "ENABLE_DEV_VALIDATION_DATABASE_QUERY", False)):

        def _ensure_db_stream(
            *,
            label: str,
            db_type: str,
            host: str,
            port: int,
            database: str,
            inner_sql: str,
            template_key: str,
            stream_title: str,
        ) -> None:
            nonlocal db_query_seeded
            cname = _lab(f"{label} query")
            row = _get_connector_by_name(db, cname)
            if row is None:
                row = Connector(name=cname, description=T.LAB_DESCRIPTION, status="RUNNING")
                db.add(row)
                db.flush()
                cfg = {
                    "connector_type": "relational_database",
                    "db_type": db_type,
                    "host": host,
                    "port": int(port),
                    "database": database,
                    "username": "gdc_fixture",
                    "password": "gdc_fixture_pw",
                    "ssl_mode": "DISABLE",
                    "connection_timeout_seconds": 30,
                }
                src = Source(
                    connector_id=row.id,
                    source_type="DATABASE_QUERY",
                    config_json=cfg,
                    auth_json={"auth_type": "no_auth"},
                    enabled=True,
                )
                db.add(src)
                db.flush()
                logger.info("%s", {"stage": "dev_validation_lab_db_connector_created", "connector_id": row.id, "name": cname})
            else:
                src = (
                    db.query(Source)
                    .filter(Source.connector_id == int(row.id), Source.source_type == "DATABASE_QUERY")
                    .order_by(Source.id.asc())
                    .first()
                )
                if src is None:
                    raise RuntimeError(f"lab connector {cname} missing DATABASE_QUERY source")

            st = _ensure_stream(
                db,
                connector=row,
                source=src,
                stream_title=stream_title,
                config_json={
                    "query": inner_sql,
                    "max_rows_per_run": 80,
                    "checkpoint_mode": "SINGLE_COLUMN",
                    "checkpoint_column": "id",
                    "query_timeout_seconds": 45,
                },
                polling_interval=120,
                stream_type="DATABASE_QUERY",
            )
            _ensure_mapping(db, st.id, event_array_path=None, event_root_path=None, field_mappings_json=T.DEFAULT_FIELD_MAPPINGS)
            _ensure_enrichment(db, int(st.id), tag=f"db_{label.lower().replace(' ', '_')}")
            _ensure_checkpoint(db, int(st.id))
            _ensure_route(db, stream_id=int(st.id), destination_id=int(dest_webhook.id), failure_policy="LOG_AND_CONTINUE")
            _ensure_validation(
                db,
                template_key=template_key,
                name=f"Validation DATABASE {label}",
                validation_type="FULL_RUNTIME",
                stream_id=int(st.id),
                expect_checkpoint_advance=True,
                schedule_seconds=120,
            )
            db_query_seeded = True

        pg_host = str(getattr(settings, "DEV_VALIDATION_PG_QUERY_HOST", "127.0.0.1")).strip()
        pg_port = int(getattr(settings, "DEV_VALIDATION_PG_QUERY_PORT", 55433) or 55433)
        my_host = str(getattr(settings, "DEV_VALIDATION_MYSQL_QUERY_HOST", "127.0.0.1")).strip()
        my_port = int(getattr(settings, "DEV_VALIDATION_MYSQL_QUERY_PORT", 33306) or 33306)
        ma_host = str(getattr(settings, "DEV_VALIDATION_MARIADB_QUERY_HOST", "127.0.0.1")).strip()
        ma_port = int(getattr(settings, "DEV_VALIDATION_MARIADB_QUERY_PORT", 33307) or 33307)

        _ensure_db_stream(
            label="PostgreSQL",
            db_type="POSTGRESQL",
            host=pg_host,
            port=pg_port,
            database="gdc_query_fixture",
            inner_sql="SELECT id, event_id, message, severity FROM security_events",
            template_key=T.TK_DB_QUERY_PG,
            stream_title="Stream db-query-basic",
        )
        _ensure_db_stream(
            label="MySQL",
            db_type="MYSQL",
            host=my_host,
            port=my_port,
            database="gdc_query_fixture",
            inner_sql="SELECT id, event_id, message, severity FROM security_events",
            template_key=T.TK_DB_QUERY_MYSQL,
            stream_title="Stream db-query-mysql",
        )
        _ensure_db_stream(
            label="MariaDB",
            db_type="MARIADB",
            host=ma_host,
            port=ma_port,
            database="gdc_query_fixture",
            inner_sql="SELECT id, event_id, message, severity FROM security_events",
            template_key=T.TK_DB_QUERY_MARIADB,
            stream_title="Stream db-query-mariadb",
        )

    if bool(getattr(settings, "ENABLE_DEV_VALIDATION_REMOTE_FILE", False)):
        sftp_pw = str(getattr(settings, "DEV_VALIDATION_SFTP_PASSWORD", "") or "").strip()
        scp_pw = str(getattr(settings, "DEV_VALIDATION_SSH_SCP_PASSWORD", "") or "").strip()
        if sftp_pw:
            sname = _lab("SFTP remote file")
            srow = _get_connector_by_name(db, sname)
            if srow is None:
                srow = Connector(name=sname, description=T.LAB_DESCRIPTION, status="RUNNING")
                db.add(srow)
                db.flush()
                scfg = {
                    "connector_type": "remote_file",
                    "protocol": "sftp",
                    "host": str(getattr(settings, "DEV_VALIDATION_SFTP_HOST", "127.0.0.1")).strip(),
                    "port": int(getattr(settings, "DEV_VALIDATION_SFTP_PORT", 22222) or 22222),
                    "username": str(getattr(settings, "DEV_VALIDATION_SFTP_USER", "gdc")).strip(),
                    "password": sftp_pw,
                    "known_hosts_policy": "INSECURE_DISABLE_VERIFICATION",
                    "connection_timeout_seconds": 25,
                }
                ssrc = Source(
                    connector_id=srow.id,
                    source_type="REMOTE_FILE_POLLING",
                    config_json=scfg,
                    auth_json={"auth_type": "no_auth"},
                    enabled=True,
                )
                db.add(ssrc)
                db.flush()
            else:
                ssrc = (
                    db.query(Source)
                    .filter(Source.connector_id == int(srow.id), Source.source_type == "REMOTE_FILE_POLLING")
                    .order_by(Source.id.asc())
                    .first()
                )
                if ssrc is None:
                    raise RuntimeError("lab SFTP connector missing REMOTE_FILE_POLLING source")
            sftp_stream = _ensure_stream(
                db,
                connector=srow,
                source=ssrc,
                stream_title="Stream remote-file-basic",
                config_json={
                    "remote_directory": "upload",
                    "file_pattern": "lab-*.ndjson",
                    "recursive": False,
                    "parser_type": "NDJSON",
                    "max_files_per_run": 15,
                    "max_file_size_mb": 8,
                },
                polling_interval=120,
                stream_type="REMOTE_FILE_POLLING",
            )
            _ensure_mapping(db, sftp_stream.id, event_array_path=None, event_root_path=None, field_mappings_json=T.DEFAULT_FIELD_MAPPINGS)
            _ensure_enrichment(db, int(sftp_stream.id), tag="remote_sftp")
            _ensure_checkpoint(db, int(sftp_stream.id))
            _ensure_route(db, stream_id=int(sftp_stream.id), destination_id=int(dest_webhook.id), failure_policy="LOG_AND_CONTINUE")
            _ensure_validation(
                db,
                template_key=T.TK_REMOTE_SFTP,
                name="Validation REMOTE_FILE SFTP",
                validation_type="FULL_RUNTIME",
                stream_id=int(sftp_stream.id),
                expect_checkpoint_advance=True,
                schedule_seconds=120,
            )
            remote_file_seeded = True

        if scp_pw:
            cname = _lab("SCP remote file")
            crow = _get_connector_by_name(db, cname)
            if crow is None:
                crow = Connector(name=cname, description=T.LAB_DESCRIPTION, status="RUNNING")
                db.add(crow)
                db.flush()
                ccfg = {
                    "connector_type": "remote_file",
                    "protocol": "sftp_compatible_scp",
                    "host": str(getattr(settings, "DEV_VALIDATION_SSH_SCP_HOST", "127.0.0.1")).strip(),
                    "port": int(getattr(settings, "DEV_VALIDATION_SSH_SCP_PORT", 22223) or 22223),
                    "username": str(getattr(settings, "DEV_VALIDATION_SSH_SCP_USER", "gdc2")).strip(),
                    "password": scp_pw,
                    "known_hosts_policy": "INSECURE_DISABLE_VERIFICATION",
                    "connection_timeout_seconds": 25,
                }
                csrc = Source(
                    connector_id=crow.id,
                    source_type="REMOTE_FILE_POLLING",
                    config_json=ccfg,
                    auth_json={"auth_type": "no_auth"},
                    enabled=True,
                )
                db.add(csrc)
                db.flush()
            else:
                csrc = (
                    db.query(Source)
                    .filter(Source.connector_id == int(crow.id), Source.source_type == "REMOTE_FILE_POLLING")
                    .order_by(Source.id.asc())
                    .first()
                )
                if csrc is None:
                    raise RuntimeError("lab SCP connector missing REMOTE_FILE_POLLING source")
            scp_stream = _ensure_stream(
                db,
                connector=crow,
                source=csrc,
                stream_title="Stream remote-file-scp-json",
                config_json={
                    "remote_directory": "upload",
                    "file_pattern": "lab-*.json",
                    "recursive": False,
                    "parser_type": "JSON_ARRAY",
                    "max_files_per_run": 10,
                    "max_file_size_mb": 8,
                },
                polling_interval=120,
                stream_type="REMOTE_FILE_POLLING",
            )
            _ensure_mapping(db, scp_stream.id, event_array_path=None, event_root_path=None, field_mappings_json=T.DEFAULT_FIELD_MAPPINGS)
            _ensure_enrichment(db, int(scp_stream.id), tag="remote_scp")
            _ensure_checkpoint(db, int(scp_stream.id))
            _ensure_route(db, stream_id=int(scp_stream.id), destination_id=int(dest_webhook.id), failure_policy="LOG_AND_CONTINUE")
            _ensure_validation(
                db,
                template_key=T.TK_REMOTE_SCP,
                name="Validation REMOTE_FILE SCP host",
                validation_type="FULL_RUNTIME",
                stream_id=int(scp_stream.id),
                expect_checkpoint_advance=True,
                schedule_seconds=120,
            )
            remote_file_seeded = True

    if bool(getattr(settings, "ENABLE_DEV_VALIDATION_S3", False)):
        ak = str(getattr(settings, "MINIO_ACCESS_KEY", "") or "").strip()
        sk = str(getattr(settings, "MINIO_SECRET_KEY", "") or "").strip()
        if ak and sk:
            s3_conn, s3_src = _ensure_minio_s3_connector(db, settings)
            s3_stream = _ensure_stream(
                db,
                connector=s3_conn,
                source=s3_src,
                stream_title="Stream s3-basic",
                config_json={"max_objects_per_run": 25},
                polling_interval=300,
                stream_type="S3_OBJECT_POLLING",
            )
            _ensure_mapping(
                db,
                s3_stream.id,
                event_array_path=None,
                event_root_path=None,
                field_mappings_json=T.DEFAULT_FIELD_MAPPINGS,
            )
            _ensure_enrichment(db, int(s3_stream.id), tag="s3_minio")
            _ensure_checkpoint(db, int(s3_stream.id))
            _ensure_route(db, stream_id=int(s3_stream.id), destination_id=int(dest_webhook.id), failure_policy="LOG_AND_CONTINUE")
            _ensure_validation(
                db,
                template_key=T.TK_S3_OBJECT_POLLING,
                name="Validation S3 object polling",
                validation_type="FULL_RUNTIME",
                stream_id=int(s3_stream.id),
                expect_checkpoint_advance=True,
                schedule_seconds=120,
            )
            s3_seeded = True

    db.commit()
    inv = _lab_inventory_counts(db)
    return {
        "skipped": False,
        "streams": int(inv["streams_in_db"]),
        "destinations": int(inv["destinations_in_db"]),
        "connectors": int(inv["connectors_in_db"]),
        "wiremock_base_url": wm,
        "inventory": inv,
        "s3_validation_seeded": s3_seeded,
        "database_query_lab_seeded": db_query_seeded,
        "remote_file_lab_seeded": remote_file_seeded,
    }
