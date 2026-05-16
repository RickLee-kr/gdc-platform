"""Administrator read-only snapshot for development validation lab + fixture probes."""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.config import settings
from app.dev_validation_lab import templates as T
from app.dev_validation_lab.seeder import lab_effective
from app.routes.models import Route
from app.streams.models import Stream
from app.validation.models import ContinuousValidation, ValidationRun


def _ms(t0: float) -> float:
    return round((time.perf_counter() - t0) * 1000.0, 2)


def _http_probe(url: str, *, timeout: float = 3.0) -> dict[str, Any]:
    t0 = time.perf_counter()
    out: dict[str, Any] = {"reachable": False, "latency_ms": None, "detail": None}
    try:
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            r = client.get(url)
        out["reachable"] = 200 <= r.status_code < 300
        out["latency_ms"] = _ms(t0)
        out["detail"] = f"HTTP {r.status_code}"[:120]
        if not out["reachable"]:
            out["detail"] = (out["detail"] or "") + f" body[:80]={(r.text or '')[:80]!r}"
    except Exception as exc:
        out["latency_ms"] = _ms(t0)
        out["detail"] = f"{type(exc).__name__}: {str(exc)[:160]}"
    return out


def _minio_probe() -> dict[str, Any]:
    t0 = time.perf_counter()
    out: dict[str, Any] = {"reachable": False, "latency_ms": None, "detail": None}
    if not bool(getattr(settings, "ENABLE_DEV_VALIDATION_S3", False)):
        out["detail"] = "ENABLE_DEV_VALIDATION_S3=false"
        return out
    ak = str(getattr(settings, "MINIO_ACCESS_KEY", "") or "").strip()
    sk = str(getattr(settings, "MINIO_SECRET_KEY", "") or "").strip()
    if not ak or not sk:
        out["detail"] = "MINIO_ACCESS_KEY / MINIO_SECRET_KEY not set"
        return out
    try:
        import boto3  # noqa: PLC0415 — optional heavy import path
        from botocore.config import Config  # noqa: PLC0415

        ep = str(getattr(settings, "MINIO_ENDPOINT", "") or "").strip().rstrip("/")
        bucket = str(getattr(settings, "MINIO_BUCKET", "") or "gdc-test-logs").strip()
        client = boto3.client(
            "s3",
            endpoint_url=ep,
            aws_access_key_id=ak,
            aws_secret_access_key=sk,
            config=Config(connect_timeout=3, read_timeout=5, retries={"max_attempts": 1}),
        )
        client.head_bucket(Bucket=bucket)
        out["reachable"] = True
        out["latency_ms"] = _ms(t0)
        out["detail"] = f"head_bucket ok ({bucket})"
    except Exception as exc:
        out["latency_ms"] = _ms(t0)
        out["detail"] = f"{type(exc).__name__}: {str(exc)[:200]}"
    return out


def _postgresql_fixture_probe() -> dict[str, Any]:
    t0 = time.perf_counter()
    out: dict[str, Any] = {"reachable": False, "latency_ms": None, "detail": None, "label": "postgresql"}
    host = str(getattr(settings, "DEV_VALIDATION_PG_QUERY_HOST", "127.0.0.1")).strip()
    port = int(getattr(settings, "DEV_VALIDATION_PG_QUERY_PORT", 55433) or 55433)
    try:
        import psycopg2  # noqa: PLC0415

        conn = psycopg2.connect(
            host=host,
            port=port,
            dbname="gdc_query_fixture",
            user="gdc_fixture",
            password="gdc_fixture_pw",
            connect_timeout=3,
        )
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
        finally:
            conn.close()
        out["reachable"] = True
        out["latency_ms"] = _ms(t0)
        out["detail"] = "SELECT 1 ok"
    except Exception as exc:
        out["latency_ms"] = _ms(t0)
        out["detail"] = f"{type(exc).__name__}: {str(exc)[:200]}"
    return out


def _mysql_family_probe(*, host: str, port: int, label: str) -> dict[str, Any]:
    t0 = time.perf_counter()
    out: dict[str, Any] = {"reachable": False, "latency_ms": None, "detail": None, "label": label}
    try:
        import pymysql  # noqa: PLC0415

        conn = pymysql.connect(
            host=host,
            port=int(port),
            user="gdc_fixture",
            password="gdc_fixture_pw",
            database="gdc_query_fixture",
            connect_timeout=3,
            read_timeout=5,
        )
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
        finally:
            conn.close()
        out["reachable"] = True
        out["latency_ms"] = _ms(t0)
        out["detail"] = "SELECT 1 ok"
    except Exception as exc:
        out["latency_ms"] = _ms(t0)
        out["detail"] = f"{type(exc).__name__}: {str(exc)[:200]}"
    return out


def _sftp_probe() -> dict[str, Any]:
    t0 = time.perf_counter()
    out: dict[str, Any] = {"reachable": False, "latency_ms": None, "detail": None}
    pw = str(getattr(settings, "DEV_VALIDATION_SFTP_PASSWORD", "") or "").strip()
    if not pw:
        out["detail"] = "DEV_VALIDATION_SFTP_PASSWORD not set"
        return out
    host = str(getattr(settings, "DEV_VALIDATION_SFTP_HOST", "127.0.0.1")).strip()
    port = int(getattr(settings, "DEV_VALIDATION_SFTP_PORT", 22222) or 22222)
    user = str(getattr(settings, "DEV_VALIDATION_SFTP_USER", "gdc")).strip()
    try:
        import paramiko  # noqa: PLC0415

        t = paramiko.Transport((host, port))
        t.banner_timeout = 5
        t.auth_timeout = 8
        t.connect(username=user, password=pw)
        t.close()
        out["reachable"] = True
        out["latency_ms"] = _ms(t0)
        out["detail"] = "transport auth ok"
    except Exception as exc:
        out["latency_ms"] = _ms(t0)
        out["detail"] = f"{type(exc).__name__}: {str(exc)[:200]}"
    return out


def _fixture_requirements() -> list[dict[str, Any]]:
    req: list[dict[str, Any]] = []
    if not lab_effective():
        return req
    req.append(
        {
            "id": "wiremock",
            "name": "WireMock (HTTP lab upstream)",
            "required": True,
            "config_hint": "DEV_VALIDATION_WIREMOCK_BASE_URL",
            "endpoint": str(getattr(settings, "DEV_VALIDATION_WIREMOCK_BASE_URL", "") or "").rstrip("/"),
        }
    )
    req.append(
        {
            "id": "webhook_echo",
            "name": "Lab webhook echo (HTTP sink)",
            "required": True,
            "config_hint": "DEV_VALIDATION_WEBHOOK_BASE_URL",
            "endpoint": str(getattr(settings, "DEV_VALIDATION_WEBHOOK_BASE_URL", "") or "").rstrip("/"),
        }
    )
    if bool(getattr(settings, "ENABLE_DEV_VALIDATION_S3", False)):
        req.append(
            {
                "id": "minio",
                "name": "MinIO S3 (object polling slice)",
                "required": True,
                "config_hint": "MINIO_ENDPOINT + MINIO_ACCESS_KEY/MINIO_SECRET_KEY + MINIO_BUCKET",
                "endpoint": str(getattr(settings, "MINIO_ENDPOINT", "") or "").rstrip("/"),
            }
        )
    if bool(getattr(settings, "ENABLE_DEV_VALIDATION_DATABASE_QUERY", False)):
        req.append(
            {
                "id": "postgresql_fixture",
                "name": "PostgreSQL fixture DB (gdc_query_fixture)",
                "required": True,
                "config_hint": "DEV_VALIDATION_PG_QUERY_HOST / DEV_VALIDATION_PG_QUERY_PORT",
                "endpoint": f"{getattr(settings, 'DEV_VALIDATION_PG_QUERY_HOST', '127.0.0.1')}:{int(getattr(settings, 'DEV_VALIDATION_PG_QUERY_PORT', 55433) or 55433)}",
            }
        )
        req.append(
            {
                "id": "mysql_fixture",
                "name": "MySQL fixture DB (gdc_query_fixture)",
                "required": True,
                "config_hint": "DEV_VALIDATION_MYSQL_QUERY_HOST / DEV_VALIDATION_MYSQL_QUERY_PORT",
                "endpoint": f"{getattr(settings, 'DEV_VALIDATION_MYSQL_QUERY_HOST', '127.0.0.1')}:{int(getattr(settings, 'DEV_VALIDATION_MYSQL_QUERY_PORT', 33306) or 33306)}",
            }
        )
        req.append(
            {
                "id": "mariadb_fixture",
                "name": "MariaDB fixture DB (gdc_query_fixture)",
                "required": True,
                "config_hint": "DEV_VALIDATION_MARIADB_QUERY_HOST / DEV_VALIDATION_MARIADB_QUERY_PORT",
                "endpoint": f"{getattr(settings, 'DEV_VALIDATION_MARIADB_QUERY_HOST', '127.0.0.1')}:{int(getattr(settings, 'DEV_VALIDATION_MARIADB_QUERY_PORT', 33307) or 33307)}",
            }
        )
    if bool(getattr(settings, "ENABLE_DEV_VALIDATION_REMOTE_FILE", False)):
        req.append(
            {
                "id": "sftp_fixture",
                "name": "SFTP fixture (REMOTE_FILE_POLLING)",
                "required": bool(str(getattr(settings, "DEV_VALIDATION_SFTP_PASSWORD", "") or "").strip()),
                "config_hint": "DEV_VALIDATION_SFTP_* + password",
                "endpoint": f"{getattr(settings, 'DEV_VALIDATION_SFTP_HOST', '127.0.0.1')}:{int(getattr(settings, 'DEV_VALIDATION_SFTP_PORT', 22222) or 22222)}",
            }
        )
    return req


def _readiness_probes() -> dict[str, Any]:
    wm = str(getattr(settings, "DEV_VALIDATION_WIREMOCK_BASE_URL", "") or "").rstrip("/")
    wh = str(getattr(settings, "DEV_VALIDATION_WEBHOOK_BASE_URL", "") or "").rstrip("/")
    probes: dict[str, Any] = {
        "wiremock": _http_probe(f"{wm}/__admin/mappings", timeout=3.0) if wm else {"reachable": False, "detail": "DEV_VALIDATION_WIREMOCK_BASE_URL empty"},
        "webhook_echo": _http_probe(wh, timeout=3.0) if wh else {"reachable": False, "detail": "DEV_VALIDATION_WEBHOOK_BASE_URL empty"},
        "minio": _minio_probe(),
    }
    if bool(getattr(settings, "ENABLE_DEV_VALIDATION_DATABASE_QUERY", False)):
        probes["postgresql_fixture"] = _postgresql_fixture_probe()
        my_host = str(getattr(settings, "DEV_VALIDATION_MYSQL_QUERY_HOST", "127.0.0.1")).strip()
        my_port = int(getattr(settings, "DEV_VALIDATION_MYSQL_QUERY_PORT", 33306) or 33306)
        ma_host = str(getattr(settings, "DEV_VALIDATION_MARIADB_QUERY_HOST", "127.0.0.1")).strip()
        ma_port = int(getattr(settings, "DEV_VALIDATION_MARIADB_QUERY_PORT", 33307) or 33307)
        probes["mysql_fixture"] = _mysql_family_probe(host=my_host, port=my_port, label="mysql")
        probes["mariadb_fixture"] = _mysql_family_probe(host=ma_host, port=ma_port, label="mariadb")
    if bool(getattr(settings, "ENABLE_DEV_VALIDATION_REMOTE_FILE", False)):
        probes["sftp_fixture"] = _sftp_probe()
    return probes


def _readiness_badge(probes: dict[str, Any], requirements: list[dict[str, Any]]) -> str:
    if not lab_effective():
        return "DISABLED"
    needed = [r["id"] for r in requirements if r.get("required")]
    if not needed:
        return "OK"
    for nid in needed:
        p = probes.get(nid)
        if not isinstance(p, dict) or not p.get("reachable"):
            return "NOT_READY"
    return "OK"


def _lab_streams_dependency_missing(db: Session) -> list[dict[str, Any]]:
    prefix = T.LAB_NAME_PREFIX
    rows = db.query(Stream).filter(Stream.name.startswith(prefix)).order_by(Stream.id.asc()).all()
    out: list[dict[str, Any]] = []
    stype = (lambda s: str(s or "").strip().upper())
    for row in rows:
        reasons: list[str] = []
        rt = stype(row.stream_type)
        if rt == "S3_OBJECT_POLLING":
            if not bool(getattr(settings, "ENABLE_DEV_VALIDATION_S3", False)):
                reasons.append("ENABLE_DEV_VALIDATION_S3_disabled")
            elif not str(getattr(settings, "MINIO_ACCESS_KEY", "") or "").strip():
                reasons.append("minio_credentials_missing")
        elif rt == "DATABASE_QUERY":
            if not bool(getattr(settings, "ENABLE_DEV_VALIDATION_DATABASE_QUERY", False)):
                reasons.append("ENABLE_DEV_VALIDATION_DATABASE_QUERY_disabled")
        elif rt == "REMOTE_FILE_POLLING":
            if not bool(getattr(settings, "ENABLE_DEV_VALIDATION_REMOTE_FILE", False)):
                reasons.append("ENABLE_DEV_VALIDATION_REMOTE_FILE_disabled")
        n_routes = int(
            db.query(func.count(Route.id)).filter(Route.stream_id == int(row.id)).scalar() or 0
        )
        if n_routes == 0:
            reasons.append("no_routes")
        if reasons:
            out.append({"stream_id": int(row.id), "name": row.name, "stream_type": row.stream_type, "reasons": reasons})
    return out


def _lab_seeded_stream_counts(db: Session) -> dict[str, int]:
    prefix = T.LAB_NAME_PREFIX
    rows = (
        db.query(Stream.stream_type, func.count(Stream.id))
        .filter(Stream.name.startswith(prefix))
        .group_by(Stream.stream_type)
        .all()
    )
    return {str(st or "UNKNOWN"): int(cnt) for st, cnt in rows}


def _validation_lab_summary(db: Session) -> dict[str, Any]:
    q = db.query(ContinuousValidation).filter(ContinuousValidation.template_key.startswith(T.LAB_TEMPLATE_KEY_PREFIX))
    total = int(q.count())
    healthy = int(q.filter(ContinuousValidation.last_status == "HEALTHY").count())
    failing = int(q.filter(ContinuousValidation.last_status.in_(("FAILING", "DEGRADED"))).count())

    last_run_row = (
        db.query(ValidationRun)
        .join(ContinuousValidation, ContinuousValidation.id == ValidationRun.validation_id)
        .filter(ContinuousValidation.template_key.startswith(T.LAB_TEMPLATE_KEY_PREFIX))
        .order_by(ValidationRun.created_at.desc())
        .first()
    )
    last_run: dict[str, Any] | None = None
    if last_run_row is not None:
        last_run = {
            "id": int(last_run_row.id),
            "validation_id": int(last_run_row.validation_id),
            "status": last_run_row.status,
            "stage": last_run_row.validation_stage,
            "created_at": last_run_row.created_at,
            "message": str(last_run_row.message or "")[:400],
        }
    last_success = db.query(func.max(ContinuousValidation.last_success_at)).filter(
        ContinuousValidation.template_key.startswith(T.LAB_TEMPLATE_KEY_PREFIX)
    ).scalar()
    return {
        "lab_validation_definitions_total": total,
        "last_status_healthy_count": healthy,
        "last_status_failing_or_degraded_count": failing,
        "last_success_at_max": last_success,
        "last_validation_run": last_run,
        "last_validation_run_success": bool(last_run and str(last_run.get("status") or "").upper() == "PASS"),
    }


def build_dev_validation_admin_status(db: Session) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    requirements = _fixture_requirements()
    probes = _readiness_probes()
    badge = _readiness_badge(probes, requirements)

    api_reachable = False
    api_detail = None
    t0 = time.perf_counter()
    try:
        db.execute(text("SELECT 1"))
        api_reachable = True
        api_detail = f"postgresql_ok latency_ms={_ms(t0)}"
    except Exception as exc:
        api_detail = f"{type(exc).__name__}: {str(exc)[:160]}"

    stream_counts = _lab_seeded_stream_counts(db) if api_reachable else {}
    defaults_meta = dict(getattr(settings, "dev_validation_lab_defaults_meta", None) or {})
    return {
        "generated_at": now,
        "lab_effective": lab_effective(),
        "enable_dev_validation_lab": bool(getattr(settings, "ENABLE_DEV_VALIDATION_LAB", False)),
        "app_env": str(getattr(settings, "APP_ENV", "") or ""),
        "fixture_flags": {
            "ENABLE_DEV_VALIDATION_S3": bool(getattr(settings, "ENABLE_DEV_VALIDATION_S3", False)),
            "ENABLE_DEV_VALIDATION_DATABASE_QUERY": bool(getattr(settings, "ENABLE_DEV_VALIDATION_DATABASE_QUERY", False)),
            "ENABLE_DEV_VALIDATION_REMOTE_FILE": bool(getattr(settings, "ENABLE_DEV_VALIDATION_REMOTE_FILE", False)),
            "ENABLE_DEV_VALIDATION_PERFORMANCE": bool(getattr(settings, "ENABLE_DEV_VALIDATION_PERFORMANCE", False)),
        },
        "lab_defaults_applied": bool(defaults_meta.get("applied")),
        "lab_defaults_meta": defaults_meta,
        "seeded_lab_streams_by_type": stream_counts,
        "seeded_lab_streams_total": int(sum(stream_counts.values())),
        "platform_catalog_db": {"reachable": api_reachable, "detail": api_detail},
        "fixtures_required": requirements,
        "fixture_readiness": probes,
        "fixture_readiness_badge": badge,
        "streams_dependency_missing": _lab_streams_dependency_missing(db) if api_reachable else [],
        "validation_lab": _validation_lab_summary(db) if api_reachable else None,
    }


__all__ = ["build_dev_validation_admin_status"]
