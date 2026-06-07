"""Record stream quarantine rows for AI Gateway quarantine decisions (no quarantine module edits)."""

from __future__ import annotations

import logging
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.ai_gateway.policy_engine import GatewayPolicyMatch
from app.quarantine.models import (
    QUARANTINE_SOURCE_POLICY,
    QUARANTINE_STATUS_QUARANTINED,
    StreamQuarantineEvent,
)

logger = logging.getLogger(__name__)


def build_quarantine_protected_payload(
    *,
    prompt_text: str,
    metadata: dict[str, Any],
    classification_level: str,
    protected_events: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build the required quarantine payload structure (protection-applied values only)."""

    protected = protected_events[0] if protected_events and isinstance(protected_events[0], dict) else {}
    protected_prompt = str(protected.get("prompt_text") or protected.get("prompt") or prompt_text)
    protected_meta = protected.get("metadata")
    if not isinstance(protected_meta, dict):
        protected_meta = deepcopy(metadata)
    return {
        "events": [
            {
                "prompt_text": protected_prompt,
                "metadata": deepcopy(protected_meta),
                "classification_level": classification_level,
            }
        ]
    }


def record_ai_gateway_quarantine_event(
    db: Session,
    *,
    stream_id: int,
    prompt_text: str,
    metadata: dict[str, Any],
    classification_level: str,
    protected_events: list[dict[str, Any]],
    matched_policies: list[GatewayPolicyMatch],
    request_id: str,
) -> StreamQuarantineEvent | None:
    payload_doc = build_quarantine_protected_payload(
        prompt_text=prompt_text,
        metadata=metadata,
        classification_level=classification_level,
        protected_events=protected_events,
    )
    if not payload_doc.get("events"):
        return None

    names = [str(p.policy_name) for p in matched_policies if p.policy_name]
    if names:
        reason = f"ai_gateway:policy:{','.join(names)}"
    elif matched_policies:
        reason = f"ai_gateway:policy:rule_{matched_policies[0].policy_id}"
    else:
        reason = "ai_gateway:policy:unknown"
    reason = reason[:256]

    now = datetime.now(timezone.utc)
    metadata_row = {
        "event_count": len(payload_doc["events"]),
        "request_id": request_id,
        "policy_ids": [int(p.policy_id) for p in matched_policies],
        "policy_names": names,
        "source": "ai_gateway",
    }
    row = StreamQuarantineEvent(
        stream_id=int(stream_id),
        quarantine_reason=reason,
        quarantine_source=QUARANTINE_SOURCE_POLICY,
        status=QUARANTINE_STATUS_QUARANTINED,
        protected_payload_json=payload_doc,
        metadata_json=metadata_row,
        created_at=now,
        updated_at=now,
    )
    try:
        db.add(row)
        db.flush()
        return row
    except Exception:
        logger.exception("ai_gateway_quarantine_record_failed stream_id=%s", stream_id)
        return None
