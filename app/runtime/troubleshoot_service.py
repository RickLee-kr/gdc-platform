"""Data Flow Troubleshooter — operator diagnosis from existing structured evidence.

Read-only synthesis of delivery_logs, checkpoint, durable queue depth, and
process-local destination circuit state. Does not introduce a parallel logger.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session, joinedload

from app.checkpoints.models import Checkpoint
from app.delivery.process_circuit_breaker import get_process_destination_circuit_breaker
from app.delivery_queue.repository import count_non_terminal_items, get_queue_operational_state
from app.logs.models import DeliveryLog
from app.runtime.errors import PreviewRequestError
from app.runtime.schemas import (
    DataFlowTroubleshootAction,
    DataFlowTroubleshootEvidenceRef,
    DataFlowTroubleshootResponse,
    DataFlowTroubleshootStage,
)
from app.routes.models import Route
from app.streams.models import Stream

# Canonical diagnosis stage labels (docs/canonical/06-USER-EXPERIENCE.md §7)
STAGE_SOURCE = "source_fetch"
STAGE_EXTRACTION = "extraction"
STAGE_TRANSFORM = "transform"
STAGE_PROTECTION = "protection"
STAGE_CLASSIFICATION = "classification"
STAGE_POLICY = "policy"
STAGE_DESTINATION = "destination"
STAGE_CHECKPOINT = "checkpoint"
STAGE_NONE = "none"

_PROBLEM_LEVELS = frozenset({"ERROR", "WARN", "WARNING", "CRITICAL"})

_STAGE_MAP: list[tuple[tuple[str, ...], str]] = [
    (("source_fetch", "source_rate_limited", "source_auth", "source_connection"), STAGE_SOURCE),
    (("parse", "extract", "extraction"), STAGE_EXTRACTION),
    (("transform", "mapping", "enrichment", "route_processing"), STAGE_TRANSFORM),
    (("protection", "mask", "redact"), STAGE_PROTECTION),
    (("classification",), STAGE_CLASSIFICATION),
    (("policy", "governance"), STAGE_POLICY),
    (
        (
            "route_send",
            "route_retry",
            "destination_rate_limited",
            "delivery",
            "failover",
            "durable_queue",
            "circuit",
        ),
        STAGE_DESTINATION,
    ),
    (("checkpoint",), STAGE_CHECKPOINT),
]

_DEST_FAIL_STAGES = frozenset(
    {
        "route_send_failed",
        "route_retry_failed",
        "route_unknown_failure_policy",
        "destination_rate_limited",
    }
)
_SOURCE_FAIL_STAGES = frozenset({"source_fetch_failed", "source_rate_limited", "run_failed"})
_CHECKPOINT_HELD_STAGES = frozenset({"checkpoint_held"})


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _map_stage(raw: str | None) -> str:
    token = (raw or "").strip().lower()
    if not token:
        return STAGE_NONE
    for prefixes, label in _STAGE_MAP:
        if any(token == p or token.startswith(p) for p in prefixes):
            return label
    return STAGE_DESTINATION if "route" in token or "dest" in token else STAGE_NONE


def _issue_label(row: DeliveryLog | None, *, fallback: str) -> str:
    if row is None:
        return fallback
    if row.http_status is not None:
        return f"HTTP {int(row.http_status)}"
    code = (row.error_code or "").strip()
    if code:
        return code
    msg = (row.message or "").strip()
    if msg:
        return msg[:160]
    return fallback


def _checkpoint_safety(
    *,
    held: bool,
    checkpoint_row: Checkpoint | None,
) -> tuple[str, str]:
    if held:
        return "held", "Checkpoint held — no confirmed data loss from this failure path"
    if checkpoint_row is None:
        return "unknown", "No checkpoint recorded for this stream"
    return "safe", "Checkpoint unchanged relative to this diagnosis window (safe / retained)"


def build_stream_data_flow_troubleshoot(
    db: Session,
    stream_id: int,
    *,
    limit: int = 100,
) -> DataFlowTroubleshootResponse:
    """Build a read-only Data Flow Troubleshooter snapshot for one stream."""

    lim = min(max(int(limit), 1), 500)
    sid = int(stream_id)

    stream = db.query(Stream).filter(Stream.id == sid).first()
    if stream is None:
        raise PreviewRequestError(404, {"error_code": "STREAM_NOT_FOUND", "message": f"Stream {sid} not found"})

    routes = (
        db.query(Route)
        .options(joinedload(Route.destination))
        .filter(Route.stream_id == sid)
        .all()
    )

    logs = (
        db.query(DeliveryLog)
        .filter(DeliveryLog.stream_id == sid)
        .order_by(DeliveryLog.created_at.desc(), DeliveryLog.id.desc())
        .limit(lim)
        .all()
    )

    checkpoint_row = db.query(Checkpoint).filter(Checkpoint.stream_id == sid).first()

    pending_events = 0
    queue_retry_wait = 0
    try:
        pending_events = int(count_non_terminal_items(db, stream_id=sid))
        qstate = get_queue_operational_state(db, stream_id=sid)
        queue_retry_wait = int(getattr(qstate, "retry_wait_depth", 0) or 0)
    except Exception:
        pending_events = 0
        queue_retry_wait = 0

    breaker = get_process_destination_circuit_breaker()
    open_circuits: list[dict[str, Any]] = []
    for route in routes:
        dest_id = int(route.destination_id)
        state = breaker.get_state(dest_id)
        if str(state.value) in ("OPEN", "HALF_OPEN"):
            open_circuits.append(
                {
                    "destination_id": dest_id,
                    "route_id": int(route.id),
                    "state": str(state.value),
                    "consecutive_failures": breaker.get_consecutive_failures(dest_id),
                }
            )

    problem_row = next(
        (
            row
            for row in logs
            if row.stage in (_DEST_FAIL_STAGES | _SOURCE_FAIL_STAGES)
            or (
                str(row.level or "").upper() in _PROBLEM_LEVELS
                and row.stage not in _CHECKPOINT_HELD_STAGES
            )
        ),
        None,
    )
    if problem_row is None:
        problem_row = next(
            (row for row in logs if row.stage in _CHECKPOINT_HELD_STAGES),
            None,
        )

    health = "IDLE"
    if not logs:
        health = "IDLE"
    else:
        has_success = any(r.stage in ("route_send_success", "route_retry_success") for r in logs)
        has_bad = any(r.stage in (_DEST_FAIL_STAGES | _SOURCE_FAIL_STAGES) for r in logs)
        if has_bad and not has_success:
            health = "UNHEALTHY"
        elif has_bad and has_success:
            health = "DEGRADED"
        elif has_success:
            health = "HEALTHY"
        else:
            health = "IDLE"

    if open_circuits and health == "HEALTHY":
        health = "DEGRADED"
    if pending_events > 0 and health == "HEALTHY":
        health = "DEGRADED"

    held = any(r.stage in _CHECKPOINT_HELD_STAGES for r in logs[:20]) or pending_events > 0

    diagnosis_stage = STAGE_NONE
    current_issue = "No active delivery problem detected"
    if open_circuits:
        circ = open_circuits[0]
        diagnosis_stage = STAGE_DESTINATION
        current_issue = f"Destination circuit {circ['state']}"
        problem_row = problem_row  # keep evidence if present
    elif problem_row is not None:
        diagnosis_stage = _map_stage(problem_row.stage)
        current_issue = _issue_label(problem_row, fallback="Delivery path error")
    elif pending_events > 0:
        diagnosis_stage = STAGE_DESTINATION
        current_issue = "Durable queue backlog"
    elif held:
        diagnosis_stage = STAGE_CHECKPOINT
        current_issue = "Checkpoint held"

    checkpoint_state, checkpoint_detail = _checkpoint_safety(held=held, checkpoint_row=checkpoint_row)

    recovery = "None required"
    if open_circuits:
        recovery = "Circuit open — next probe scheduled when open window elapses"
    elif queue_retry_wait > 0:
        recovery = f"Retry scheduled ({queue_retry_wait} item(s) in RETRY_WAIT)"
    elif pending_events > 0:
        recovery = "Durable queue drain in progress"
    elif problem_row is not None and int(problem_row.retry_count or 0) > 0:
        recovery = f"Retry in progress (attempt {int(problem_row.retry_count)})"
    elif health in ("HEALTHY", "IDLE"):
        recovery = "None required"
    else:
        recovery = "Operator review recommended"

    impact_events = max(pending_events, 0)
    if impact_events == 0 and problem_row is not None:
        # Single failure without queue: report at least the failing attempt footprint.
        impact_events = 1 if health in ("DEGRADED", "UNHEALTHY") else 0

    impact_summary = (
        f"{impact_events:,} event(s) pending or delayed"
        if impact_events > 0
        else "No delayed queue backlog"
    )

    stages: list[DataFlowTroubleshootStage] = []
    for label in (
        STAGE_SOURCE,
        STAGE_EXTRACTION,
        STAGE_TRANSFORM,
        STAGE_PROTECTION,
        STAGE_CLASSIFICATION,
        STAGE_POLICY,
        STAGE_DESTINATION,
        STAGE_CHECKPOINT,
    ):
        related = [r for r in logs if _map_stage(r.stage) == label]
        status = "ok"
        detail = "No recent evidence"
        if related:
            bad = [
                r
                for r in related
                if r.stage in (_DEST_FAIL_STAGES | _SOURCE_FAIL_STAGES | _CHECKPOINT_HELD_STAGES)
                or str(r.level or "").upper() in _PROBLEM_LEVELS
            ]
            if bad:
                status = "problem" if label == diagnosis_stage else "attention"
                newest = bad[0]
                detail = _issue_label(newest, fallback=newest.stage)
            else:
                status = "ok"
                detail = f"Last: {related[0].stage}"
        if label == STAGE_DESTINATION and open_circuits:
            status = "problem"
            detail = f"Circuit {open_circuits[0]['state']} on destination {open_circuits[0]['destination_id']}"
        if label == STAGE_CHECKPOINT and held:
            status = "attention" if status == "ok" else status
            detail = checkpoint_detail
        stages.append(DataFlowTroubleshootStage(stage=label, status=status, detail=detail))

    evidence: list[DataFlowTroubleshootEvidenceRef] = []
    if problem_row is not None:
        evidence.append(
            DataFlowTroubleshootEvidenceRef(
                kind="delivery_log",
                id=int(problem_row.id),
                stage=str(problem_row.stage),
                message=(problem_row.message or "")[:240],
                created_at=problem_row.created_at,
                http_status=problem_row.http_status,
                error_code=problem_row.error_code,
            )
        )
    for circ in open_circuits[:3]:
        evidence.append(
            DataFlowTroubleshootEvidenceRef(
                kind="circuit_breaker",
                id=int(circ["destination_id"]),
                stage=STAGE_DESTINATION,
                message=f"state={circ['state']} consecutive_failures={circ['consecutive_failures']}",
                created_at=None,
                http_status=None,
                error_code="CIRCUIT_OPEN" if circ["state"] == "OPEN" else "CIRCUIT_HALF_OPEN",
            )
        )
    if pending_events > 0:
        evidence.append(
            DataFlowTroubleshootEvidenceRef(
                kind="durable_queue",
                id=sid,
                stage=STAGE_DESTINATION,
                message=f"non_terminal_items={pending_events} retry_wait={queue_retry_wait}",
                created_at=None,
                http_status=None,
                error_code="QUEUE_BACKLOG",
            )
        )

    actions: list[DataFlowTroubleshootAction] = []
    if diagnosis_stage == STAGE_DESTINATION or open_circuits:
        actions.append(
            DataFlowTroubleshootAction(
                id="test_destination",
                label="Test Destination",
                href_hint="destination_detail",
            )
        )
    actions.append(
        DataFlowTroubleshootAction(
            id="view_evidence",
            label="View Evidence",
            href_hint="delivery_logs",
        )
    )
    if health in ("DEGRADED", "UNHEALTHY") or pending_events > 0:
        actions.append(
            DataFlowTroubleshootAction(
                id="replay_retry",
                label="Replay / Retry when applicable",
                href_hint="replay_center",
            )
        )

    return DataFlowTroubleshootResponse(
        stream_id=sid,
        stream_name=str(stream.name or ""),
        stream_status=str(stream.status or ""),
        health=health,  # type: ignore[arg-type]
        current_issue=current_issue,
        diagnosis_stage=diagnosis_stage,  # type: ignore[arg-type]
        impact_events_pending=impact_events,
        impact_summary=impact_summary,
        checkpoint_state=checkpoint_state,  # type: ignore[arg-type]
        checkpoint_detail=checkpoint_detail,
        recovery=recovery,
        stages=stages,
        evidence=evidence,
        actions=actions,
        generated_at=_utc_now(),
        evidence_limit=lim,
    )
