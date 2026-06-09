"""Window KPI counts backed by the incremental delivery_logs read model (S4-14)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app.logs import incremental_aggregates as incremental
from app.quarantine.metrics import QUARANTINE_EVENT_CREATED_STAGE
from app.replay.metrics import REPLAY_EVENT_REPLAYED_STAGE

CLASSIFICATION_COMPLETE_STAGE = "classification_complete"
PROTECTION_COMPLETE_STAGE = "protection_complete"
POLICY_EVALUATION_COMPLETE_STAGE = "policy_evaluation_complete"


def get_window_kpi_counts(
    db: Session,
    *,
    since: datetime,
    until: datetime,
) -> dict[str, int]:
    """Return dashboard KPI counters for a time window using the cumulative cache."""

    success, failure = incremental.delivery_outcome_totals(
        db,
        start_at=since,
        end_at=until,
    )
    facts = incremental.delivery_log_aggregate_facts(db, start_at=since, end_at=until)
    classified = protected = quarantined = replayed = policy = 0
    for fact in facts:
        if fact.stage == CLASSIFICATION_COMPLETE_STAGE:
            classified += 1
        elif fact.stage == PROTECTION_COMPLETE_STAGE:
            protected += int(fact.protected_event_count)
        elif fact.stage == QUARANTINE_EVENT_CREATED_STAGE:
            quarantined += 1
        elif fact.stage == REPLAY_EVENT_REPLAYED_STAGE:
            replayed += 1
        elif fact.stage == POLICY_EVALUATION_COMPLETE_STAGE:
            policy += 1
    return {
        "success_count": int(success),
        "failure_count": int(failure),
        "replay_count": int(replayed),
        "quarantine_count": int(quarantined),
        "classified_events": int(classified),
        "protected_events": int(protected),
        "policy_evaluations": int(policy),
        "replayed_events": int(replayed),
        "quarantined_events": int(quarantined),
    }
