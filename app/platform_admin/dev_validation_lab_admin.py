"""Administrator read-only snapshot for development validation lab + fixture probes."""

from __future__ import annotations

import logging
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

logger = logging.getLogger(__name__)


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


def _lab_resource_metrics(db: Session) -> dict[str, Any]:
    """Best-effort lab resource / retention / budget snapshot for admin status."""

    from app.dev_validation_lab.lab_retention import lab_retention_settings, last_lab_cleanup_snapshot
    from app.dev_validation_lab.lab_resource_guardrail import (
        check_lab_resource_budget,
        lab_pause_snapshot,
        lab_resource_guardrail_enabled,
    )

    out: dict[str, Any] = {
        "recent_eps": None,
        "delivery_logs_rows": None,
        "delivery_logs_rows_last_10m": None,
        "delivery_logs_estimated_size": None,
        "alert_history_rows": None,
        "replay_event_rows": None,
        "wiremock_journal_entries": None,
        "retention_enabled": False,
        "last_cleanup_at": None,
        "last_cleanup_result": None,
        "warnings": [],
        "resource_guardrail_enabled": False,
        "resource_budget_status": "ok",
        "exceeded_reasons": [],
        "should_pause_lab": False,
        "lab_paused": False,
        "lab_pause_reason": None,
        "next_retry_after": None,
        "recommended_action": "none",
        "auto_remediation_enabled": False,
        "auto_cleanup_enabled": False,
        "auto_cleanup_last_run_at": None,
        "auto_cleanup_last_result": None,
        "auto_cleanup_deleted_rows": 0,
        "auto_cleanup_recovered_budget": False,
        "auto_cleanup_cooldown_until": None,
        "destructive_cleanup_required": False,
        "partition_drop_candidates": [],
        "recoverability_status": None,
        "auto_cleanup_cycles_estimated": None,
        "destructive_cleanup_recommended": False,
    }
    cfg = lab_retention_settings()
    out["retention_enabled"] = bool(cfg.get("enabled"))
    snap = last_lab_cleanup_snapshot()
    out["last_cleanup_at"] = snap.get("last_cleanup_at")
    out["last_cleanup_result"] = snap.get("last_cleanup_result")

    # Lab on + retention off → growth risk (do not change EPS; warn only).
    if bool(cfg.get("lab_effective")) and not bool(cfg.get("enabled")):
        warn = (
            "lab_effective=true but GDC_LAB_RETENTION_ENABLED=false; "
            "delivery_logs / alert_history / replay_events may grow without lab TTL"
        )
        out["warnings"].append(warn)
        logger.warning("%s", {"stage": "lab_retention_disabled_while_lab_on", "message": warn})

    out["resource_guardrail_enabled"] = bool(lab_resource_guardrail_enabled())
    try:
        from app.dev_validation_lab.lab_auto_remediation import auto_remediation_snapshot

        budget = check_lab_resource_budget(db, force=True, attempt_wiremock_reset=False)
        out["resource_budget_status"] = str(budget.get("status") or "ok")
        out["exceeded_reasons"] = list(budget.get("exceeded_reasons") or [])
        out["should_pause_lab"] = bool(budget.get("should_pause_lab"))
        out["lab_paused"] = bool(budget.get("lab_paused"))
        out["lab_pause_reason"] = budget.get("lab_pause_reason")
        out["next_retry_after"] = budget.get("next_retry_after")
        out["recommended_action"] = str(budget.get("recommended_action") or "none")
        out["recent_eps"] = budget.get("recent_eps")
        out["delivery_logs_rows"] = budget.get("delivery_logs_rows")
        out["delivery_logs_rows_last_10m"] = budget.get("delivery_logs_rows_last_10m")
        out["delivery_logs_estimated_size"] = budget.get("delivery_logs_estimated_size")
        out["alert_history_rows"] = budget.get("alert_history_rows")
        out["replay_event_rows"] = budget.get("replay_event_rows")
        out["wiremock_journal_entries"] = budget.get("wiremock_journal_entries")
        rem = auto_remediation_snapshot()
        # Prefer fields from the just-completed check when present.
        out["auto_remediation_enabled"] = bool(
            budget.get("auto_remediation_enabled", rem.get("auto_remediation_enabled"))
        )
        out["auto_cleanup_enabled"] = bool(
            budget.get("auto_cleanup_enabled", rem.get("auto_cleanup_enabled"))
        )
        out["auto_cleanup_last_run_at"] = budget.get("auto_cleanup_last_run_at") or rem.get(
            "auto_cleanup_last_run_at"
        )
        out["auto_cleanup_last_result"] = budget.get("auto_cleanup_last_result") or rem.get(
            "auto_cleanup_last_result"
        )
        out["auto_cleanup_deleted_rows"] = budget.get("auto_cleanup_deleted_rows")
        if out["auto_cleanup_deleted_rows"] is None:
            out["auto_cleanup_deleted_rows"] = rem.get("auto_cleanup_deleted_rows")
        out["auto_cleanup_recovered_budget"] = bool(
            budget.get("auto_cleanup_recovered_budget", rem.get("auto_cleanup_recovered_budget"))
        )
        out["auto_cleanup_cooldown_until"] = budget.get("auto_cleanup_cooldown_until") or rem.get(
            "auto_cleanup_cooldown_until"
        )
        out["destructive_cleanup_required"] = bool(
            budget.get("destructive_cleanup_required", rem.get("destructive_cleanup_required"))
        )
        out["partition_drop_candidates"] = list(
            budget.get("partition_drop_candidates")
            or rem.get("partition_drop_candidates")
            or []
        )
        # Recoverability assessment for operator guidance (never executes DROP).
        try:
            from app.dev_validation_lab.lab_cleanup_recoverability import (
                assess_lab_cleanup_recoverability,
                enrich_partition_drop_candidates,
            )
            from app.dev_validation_lab.lab_retention import lab_retention_settings as _lrs

            cands = out["partition_drop_candidates"]
            if not cands:
                cands = enrich_partition_drop_candidates(
                    db,
                    retention_days=int(_lrs().get("delivery_log_retention_days") or 7),
                    cheap=True,
                )
                out["partition_drop_candidates"] = cands
            eligible = None
            last = out.get("auto_cleanup_last_result") or {}
            for row in (last.get("cleanup") or {}).get("outcomes") or []:
                if row.get("table") == "delivery_logs":
                    eligible = int(row.get("matched_count") or 0)
                    break
            recover = assess_lab_cleanup_recoverability(
                budget=budget,
                delivery_logs_eligible_rows=eligible,
                partition_candidates=cands,
                remediation_recovered=bool(out.get("auto_cleanup_recovered_budget")),
                remediation_still_exceeded=bool(out.get("should_pause_lab") or out.get("lab_paused")),
                remediation_errors=list((last or {}).get("errors") or []),
            )
            out["recoverability_status"] = budget.get("recoverability_status") or recover.get(
                "recoverability_status"
            )
            out["auto_cleanup_cycles_estimated"] = budget.get("auto_cleanup_cycles_estimated")
            if out["auto_cleanup_cycles_estimated"] is None:
                out["auto_cleanup_cycles_estimated"] = recover.get("auto_cleanup_cycles_estimated")
            out["destructive_cleanup_recommended"] = bool(
                budget.get("destructive_cleanup_recommended", recover.get("destructive_cleanup_recommended"))
            )
            if not out.get("destructive_cleanup_required"):
                out["destructive_cleanup_required"] = bool(recover.get("destructive_cleanup_required"))
            # Prefer remediation/budget action when present; else recoverability guidance.
            action = budget.get("recommended_action") or recover.get("recommended_action")
            if action and action not in {"none", "guardrail_disabled"}:
                out["recommended_action"] = action
            elif recover.get("recommended_action"):
                out["recommended_action"] = recover.get("recommended_action")
        except Exception:
            out.setdefault("recoverability_status", budget.get("recoverability_status"))
            out.setdefault("auto_cleanup_cycles_estimated", budget.get("auto_cleanup_cycles_estimated"))
            out.setdefault("destructive_cleanup_recommended", False)

        for w in budget.get("warning_reasons") or []:
            out["warnings"].append(str(w))
        if budget.get("should_pause_lab"):
            out["warnings"].append(
                f"lab generation paused: {budget.get('lab_pause_reason') or 'budget_exceeded'}"
            )
    except Exception as exc:
        logger.warning(
            "%s",
            {
                "stage": "lab_resource_budget_status_error",
                "error_type": type(exc).__name__,
                "message": str(exc)[:300],
            },
        )
        pause = lab_pause_snapshot()
        out["lab_paused"] = bool(pause.get("lab_paused"))
        out["lab_pause_reason"] = pause.get("lab_pause_reason")
        out["next_retry_after"] = pause.get("next_retry_after")
        try:
            db.rollback()
        except Exception:
            pass

    # Soft growth warn (legacy) when budget check did not already cover rows_10m.
    growth_warn_rows = int(getattr(settings, "GDC_LAB_DELIVERY_LOG_GROWTH_WARN_ROWS_10M", 50000) or 50000)
    rows_10m = out.get("delivery_logs_rows_last_10m")
    if isinstance(rows_10m, int) and rows_10m >= growth_warn_rows:
        grow_msg = (
            f"delivery_logs grew by {rows_10m} rows in last 10m "
            f"(warn threshold={growth_warn_rows}); check retention/cleanup"
        )
        if grow_msg not in out["warnings"]:
            out["warnings"].append(grow_msg)

    return out


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
    resource = _lab_resource_metrics(db) if api_reachable else {
        "recent_eps": None,
        "delivery_logs_rows": None,
        "delivery_logs_rows_last_10m": None,
        "delivery_logs_estimated_size": None,
        "alert_history_rows": None,
        "replay_event_rows": None,
        "wiremock_journal_entries": None,
        "retention_enabled": False,
        "last_cleanup_at": None,
        "last_cleanup_result": None,
        "warnings": [],
        "resource_guardrail_enabled": False,
        "resource_budget_status": "ok",
        "exceeded_reasons": [],
        "should_pause_lab": False,
        "lab_paused": False,
        "lab_pause_reason": None,
        "next_retry_after": None,
        "recommended_action": "none",
        "auto_remediation_enabled": False,
        "auto_cleanup_enabled": False,
        "auto_cleanup_last_run_at": None,
        "auto_cleanup_last_result": None,
        "auto_cleanup_deleted_rows": 0,
        "auto_cleanup_recovered_budget": False,
        "auto_cleanup_cooldown_until": None,
        "destructive_cleanup_required": False,
        "partition_drop_candidates": [],
        "recoverability_status": None,
        "auto_cleanup_cycles_estimated": None,
        "destructive_cleanup_recommended": False,
    }
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
        "recent_eps": resource.get("recent_eps"),
        "delivery_logs_rows": resource.get("delivery_logs_rows"),
        "delivery_logs_rows_last_10m": resource.get("delivery_logs_rows_last_10m"),
        "delivery_logs_estimated_size": resource.get("delivery_logs_estimated_size"),
        "alert_history_rows": resource.get("alert_history_rows"),
        "replay_event_rows": resource.get("replay_event_rows"),
        "wiremock_journal_entries": resource.get("wiremock_journal_entries"),
        "retention_enabled": resource.get("retention_enabled"),
        "last_cleanup_at": resource.get("last_cleanup_at"),
        "last_cleanup_result": resource.get("last_cleanup_result"),
        "resource_warnings": list(resource.get("warnings") or []),
        "resource_guardrail_enabled": resource.get("resource_guardrail_enabled"),
        "resource_budget_status": resource.get("resource_budget_status"),
        "exceeded_reasons": list(resource.get("exceeded_reasons") or []),
        "should_pause_lab": resource.get("should_pause_lab"),
        "lab_paused": resource.get("lab_paused"),
        "lab_pause_reason": resource.get("lab_pause_reason"),
        "next_retry_after": resource.get("next_retry_after"),
        "recommended_action": resource.get("recommended_action"),
        "auto_remediation_enabled": resource.get("auto_remediation_enabled"),
        "auto_cleanup_enabled": resource.get("auto_cleanup_enabled"),
        "auto_cleanup_last_run_at": resource.get("auto_cleanup_last_run_at"),
        "auto_cleanup_last_result": resource.get("auto_cleanup_last_result"),
        "auto_cleanup_deleted_rows": resource.get("auto_cleanup_deleted_rows"),
        "auto_cleanup_recovered_budget": resource.get("auto_cleanup_recovered_budget"),
        "auto_cleanup_cooldown_until": resource.get("auto_cleanup_cooldown_until"),
        "destructive_cleanup_required": resource.get("destructive_cleanup_required"),
        "partition_drop_candidates": list(resource.get("partition_drop_candidates") or []),
        "recoverability_status": resource.get("recoverability_status"),
        "auto_cleanup_cycles_estimated": resource.get("auto_cleanup_cycles_estimated"),
        "destructive_cleanup_recommended": resource.get("destructive_cleanup_recommended"),
    }


__all__ = ["build_dev_validation_admin_status"]
