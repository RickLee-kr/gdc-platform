"""Connector/API Health — read-only synthesis from existing runtime truth.

Reuses auth-check metadata, credential status, delivery_logs (source_fetch /
source_rate_limited), and stream health aggregates. Does not run probes,
mutate config/checkpoints, or introduce a parallel health engine.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.connectors.api_health_schemas import (
    ConnectorApiFailureKind,
    ConnectorApiHealthAction,
    ConnectorApiHealthEvidence,
    ConnectorApiHealthResponse,
    ConnectorApiHealthStatus,
    ConnectorApiHealthStreamRef,
)
from app.connectors.models import Connector
from app.connectors.operations_service import read_operational_config
from app.credentials.models import (
    CREDENTIAL_STATUS_EXPIRED,
    CREDENTIAL_STATUS_NEEDS_RECONNECT,
    Credential,
)
from app.credentials.oauth2_auth_code import parse_expires_at
from app.credentials.service import load_credential_auth_json
from app.logs.models import DeliveryLog
from app.runtime.errors import PreviewRequestError
from app.sources.models import Source
from app.streams.models import Stream

_SOURCE_FAIL_STAGES = frozenset({"source_fetch_failed", "source_rate_limited", "run_failed"})
_AUTH_HTTP = frozenset({401, 403})
_RATE_HTTP = frozenset({429})


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    raw = str(value).strip()
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _classify_text(
    *,
    message: str | None,
    error_code: str | None,
    http_status: int | None,
    stage: str | None = None,
) -> ConnectorApiFailureKind:
    stage_l = (stage or "").strip().lower()
    if stage_l == "source_rate_limited" or (http_status is not None and int(http_status) in _RATE_HTTP):
        return "rate_limit"

    code = (error_code or "").strip().lower()
    msg = (message or "").strip().lower()
    blob = f"{code} {msg}"

    if http_status is not None and int(http_status) in _AUTH_HTTP:
        return "authentication"
    if any(
        token in blob
        for token in (
            "auth",
            "unauthorized",
            "forbidden",
            "401",
            "403",
            "credential",
            "token",
            "login",
        )
    ):
        return "authentication"

    if "timeout" in blob or "timed out" in blob:
        return "timeout"
    if any(
        token in blob
        for token in (
            "connection",
            "connect",
            "unreachable",
            "refused",
            "dns",
            "network",
            "name or service not known",
        )
    ):
        return "connectivity"

    if http_status is not None and int(http_status) >= 400:
        return "http_api"
    if re.search(r"\bhttp\s*[45]\d\d\b", blob) or "target_http" in blob:
        return "http_api"

    if stage_l in _SOURCE_FAIL_STAGES or "source_fetch" in blob or "runtime" in blob:
        return "runtime"
    return "runtime"


def _action_for_kind(kind: ConnectorApiFailureKind) -> str:
    if kind == "authentication":
        return "Verify credentials and run Test Connection on this connector."
    if kind == "credential_expiration":
        return "Reconnect or renew the credential, then run Test Connection."
    if kind == "connectivity":
        return "Check network reachability, DNS, proxy, and base URL, then retry."
    if kind == "timeout":
        return "Check vendor API latency / timeout settings, then retry the request."
    if kind == "rate_limit":
        return "Reduce poll rate or raise the vendor rate limit; wait for throttling to clear."
    if kind == "http_api":
        return "Inspect the vendor HTTP status and endpoint configuration, then retest."
    if kind == "runtime":
        return "Open affected stream Data Flow Troubleshooter for source-fetch evidence."
    return "No action required."


def _problem_for_kind(kind: ConnectorApiFailureKind, detail: str) -> str:
    if kind == "authentication":
        return detail or "Authentication failed"
    if kind == "credential_expiration":
        return detail or "Credential expired or needs reconnect"
    if kind == "connectivity":
        return detail or "Connectivity failure"
    if kind == "timeout":
        return detail or "Request timed out"
    if kind == "rate_limit":
        return detail or "Vendor API rate limited"
    if kind == "http_api":
        return detail or "Vendor API / HTTP error"
    if kind == "runtime":
        return detail or "Source request failed"
    return "No connector/API problem detected"


def build_connector_api_health(
    db: Session,
    connector_id: int,
    *,
    limit: int = 100,
) -> ConnectorApiHealthResponse:
    """Build a read-only Connector/API Health snapshot from existing evidence."""

    lim = min(max(int(limit), 1), 500)
    cid = int(connector_id)

    connector = db.query(Connector).filter(Connector.id == cid).first()
    if connector is None:
        raise PreviewRequestError(
            404,
            {"error_code": "CONNECTOR_NOT_FOUND", "message": f"Connector {cid} not found"},
        )

    sources = (
        db.query(Source)
        .filter(Source.connector_id == cid)
        .order_by(Source.id.asc())
        .all()
    )
    source = next((s for s in sources if str(s.source_type) == "HTTP_API_POLLING"), None)
    if source is None and sources:
        source = sources[0]

    streams = (
        db.query(Stream)
        .filter(Stream.connector_id == cid)
        .order_by(Stream.id.asc())
        .all()
    )
    stream_ids = [int(s.id) for s in streams]
    stream_by_id = {int(s.id): s for s in streams}

    op = read_operational_config(
        source.config_json if source is not None and isinstance(source.config_json, dict) else {}
    )
    last_auth_at = _parse_dt(op.get("last_auth_check_at"))
    last_auth_status = op.get("last_auth_check_status")
    if last_auth_status not in (None, "success", "failed"):
        last_auth_status = None
    last_auth_error = str(op.get("last_auth_error") or "") or None

    credentials = (
        db.query(Credential)
        .filter(Credential.connector_id == cid)
        .order_by(Credential.id.asc())
        .all()
    )
    credential_status: str | None = None
    credential_expires_at: datetime | None = None
    expired_credential: Credential | None = None
    for cred in credentials:
        status = str(cred.status or "").strip().upper()
        if credential_status is None:
            credential_status = status or None
        expires: datetime | None = None
        try:
            auth = load_credential_auth_json(cred)
            expires = parse_expires_at(auth.get("expires_at"))
        except Exception:
            expires = None
        if expires is not None and (credential_expires_at is None or expires < credential_expires_at):
            credential_expires_at = expires
        if status in {CREDENTIAL_STATUS_EXPIRED, CREDENTIAL_STATUS_NEEDS_RECONNECT}:
            expired_credential = cred
            credential_status = status
            break
        if expires is not None and expires <= _utc_now():
            expired_credential = cred
            credential_status = CREDENTIAL_STATUS_EXPIRED
            break

    logs: list[DeliveryLog] = []
    if stream_ids:
        logs = (
            db.query(DeliveryLog)
            .filter(DeliveryLog.stream_id.in_(stream_ids))
            .filter(DeliveryLog.stage.in_(sorted(_SOURCE_FAIL_STAGES | {"source_fetch"})))
            .order_by(DeliveryLog.created_at.desc(), DeliveryLog.id.desc())
            .limit(lim)
            .all()
        )

    rate_limited = [r for r in logs if r.stage == "source_rate_limited"]
    fetch_failed = [r for r in logs if r.stage == "source_fetch_failed"]
    problem_logs = [r for r in logs if r.stage in _SOURCE_FAIL_STAGES]

    last_success_at: datetime | None = None
    last_failure_at: datetime | None = None
    for row in logs:
        if row.created_at is None:
            continue
        if row.stage == "source_fetch":
            if last_success_at is None or row.created_at > last_success_at:
                last_success_at = row.created_at
        elif row.stage in _SOURCE_FAIL_STAGES:
            if last_failure_at is None or row.created_at > last_failure_at:
                last_failure_at = row.created_at

    if last_auth_status == "success" and last_auth_at is not None:
        if last_success_at is None or last_auth_at > last_success_at:
            last_success_at = last_auth_at
    if last_auth_status == "failed" and last_auth_at is not None:
        if last_failure_at is None or last_auth_at > last_failure_at:
            last_failure_at = last_auth_at

    connector_status = str(connector.status or "").strip().upper() or "STOPPED"
    health: ConnectorApiHealthStatus = "IDLE"
    failure_kind: ConnectorApiFailureKind = "none"
    problem = "No connector/API problem detected"
    cause = "No recent source/API failure evidence"
    detail = ""
    evidence: list[ConnectorApiHealthEvidence] = []
    affected: list[ConnectorApiHealthStreamRef] = []

    if connector_status in {"STOPPED", "PAUSED", "DISABLED"}:
        health = "IDLE"
        problem = "Connector is stopped"
        cause = "Connector status is not running — API health is idle"
        failure_kind = "none"
    elif expired_credential is not None:
        health = "UNHEALTHY"
        failure_kind = "credential_expiration"
        detail = f"Credential status {credential_status}"
        if credential_expires_at is not None:
            detail = f"{detail}; expires_at={credential_expires_at.isoformat()}"
        problem = _problem_for_kind(failure_kind, detail)
        cause = "Stored credential is expired or requires reconnect"
        evidence.append(
            ConnectorApiHealthEvidence(
                kind="credential",
                id=int(expired_credential.id),
                stage="credential",
                message=cause,
                created_at=None,
                error_code=str(credential_status or "EXPIRED"),
            )
        )
    elif last_auth_status == "failed":
        failure_kind = _classify_text(
            message=last_auth_error,
            error_code=None,
            http_status=_extract_http_status(last_auth_error),
        )
        if failure_kind == "runtime":
            failure_kind = "authentication"
        health = "UNHEALTHY"
        detail = last_auth_error or "Authentication check failed"
        problem = _problem_for_kind(failure_kind, detail)
        cause = "Last Test Connection / auth check failed"
        evidence.append(
            ConnectorApiHealthEvidence(
                kind="auth_check",
                id=cid,
                stage="auth_check",
                message=detail[:240],
                created_at=last_auth_at,
                http_status=_extract_http_status(last_auth_error),
                error_code=failure_kind,
            )
        )
    elif problem_logs:
        newest = problem_logs[0]
        failure_kind = _classify_text(
            message=newest.message,
            error_code=newest.error_code,
            http_status=newest.http_status,
            stage=newest.stage,
        )
        # Repeated rate limiting → warning unless auth also failing (handled above)
        if failure_kind == "rate_limit" and len(rate_limited) >= 2:
            health = "WARNING"
        elif failure_kind == "rate_limit":
            health = "WARNING"
        else:
            health = "UNHEALTHY"
        detail = (newest.message or newest.error_code or newest.stage or "").strip()
        if newest.http_status is not None and str(newest.http_status) not in detail:
            detail = f"HTTP {int(newest.http_status)} {detail}".strip()
        problem = _problem_for_kind(failure_kind, detail or newest.stage)
        cause = f"Recent source evidence: {newest.stage}"
        evidence.append(
            ConnectorApiHealthEvidence(
                kind="delivery_log",
                id=int(newest.id),
                stage=str(newest.stage),
                message=(newest.message or "")[:240],
                created_at=newest.created_at,
                http_status=newest.http_status,
                error_code=newest.error_code,
            )
        )
        seen_streams: set[int] = set()
        for row in problem_logs:
            sid = int(row.stream_id) if row.stream_id is not None else 0
            if sid <= 0 or sid in seen_streams:
                continue
            seen_streams.add(sid)
            stream = stream_by_id.get(sid)
            affected.append(
                ConnectorApiHealthStreamRef(
                    stream_id=sid,
                    stream_name=str(stream.name if stream is not None else f"Stream #{sid}"),
                    status=str(stream.status if stream is not None else ""),
                    primary_issue=problem,
                )
            )
            if len(affected) >= 8:
                break
    elif last_auth_status == "success" or (last_success_at is not None and not fetch_failed):
        health = "HEALTHY"
        problem = "Connector/API healthy"
        cause = (
            "Last auth verification succeeded"
            if last_auth_status == "success"
            else "Recent source fetch success without source failures"
        )
        failure_kind = "none"
        if last_auth_status == "success":
            evidence.append(
                ConnectorApiHealthEvidence(
                    kind="auth_check",
                    id=cid,
                    stage="auth_check",
                    message="Last auth check succeeded",
                    created_at=last_auth_at,
                    error_code=None,
                )
            )
    else:
        health = "IDLE"
        problem = "No recent connector/API activity"
        cause = "No auth verification or source-fetch evidence in the recent window"
        failure_kind = "none"

    recommended_action = _action_for_kind(failure_kind)
    actions: list[ConnectorApiHealthAction] = []
    if failure_kind in {"authentication", "credential_expiration", "connectivity", "timeout", "http_api"}:
        actions.append(
            ConnectorApiHealthAction(
                id="test_connection",
                label="Test Connection",
                href_hint="connector_auth_test",
            )
        )
    if affected:
        actions.append(
            ConnectorApiHealthAction(
                id="open_troubleshooter",
                label="Open Data Flow Troubleshooter",
                href_hint=f"stream_troubleshoot:{affected[0].stream_id}",
            )
        )
    actions.append(
        ConnectorApiHealthAction(
            id="view_evidence",
            label="View Evidence",
            href_hint="delivery_logs",
        )
    )
    if failure_kind == "none" and health == "HEALTHY":
        actions = [
            ConnectorApiHealthAction(
                id="test_connection",
                label="Test Connection",
                href_hint="connector_auth_test",
            ),
            ConnectorApiHealthAction(
                id="view_evidence",
                label="View Evidence",
                href_hint="delivery_logs",
            ),
        ]

    return ConnectorApiHealthResponse(
        connector_id=cid,
        connector_name=str(connector.name or ""),
        connector_status=connector_status,
        health=health,
        problem=problem,
        cause=cause,
        failure_kind=failure_kind,
        recommended_action=recommended_action,
        last_success_at=last_success_at,
        last_failure_at=last_failure_at,
        last_auth_check_at=last_auth_at,
        last_auth_check_status=last_auth_status,  # type: ignore[arg-type]
        last_auth_error=last_auth_error,
        credential_status=credential_status,
        credential_expires_at=credential_expires_at,
        source_rate_limited_count=len(rate_limited),
        source_fetch_failed_count=len(fetch_failed),
        affected_streams=affected,
        evidence=evidence,
        actions=actions,
        generated_at=_utc_now(),
        evidence_limit=lim,
    )


def _extract_http_status(message: str | None) -> int | None:
    if not message:
        return None
    m = re.match(r"^\s*(\d{3})\b", message.strip())
    if not m:
        m = re.search(r"\bHTTP\s+(\d{3})\b", message, flags=re.IGNORECASE)
    if not m:
        return None
    try:
        code = int(m.group(1))
    except ValueError:
        return None
    return code if 100 <= code <= 599 else None
