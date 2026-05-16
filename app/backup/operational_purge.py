"""Remove operational pipeline configuration rows before a full snapshot restore.

Preserves platform administration tables (users, retention, HTTPS, audit), migration
metadata, and ``delivery_logs`` rows (FK references are nulled, not deleted).
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import delete, update
from sqlalchemy.orm import Session

from app.backfill.models import BackfillJob, BackfillProgressEvent
from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.destinations.models import Destination
from app.enrichments.models import Enrichment
from app.logs.models import DeliveryLog
from app.mappings.models import Mapping
from app.routes.models import Route
from app.sources.models import Source
from app.streams.models import Stream
from app.validation.models import (
    ContinuousValidation,
    ValidationAlert,
    ValidationRecoveryEvent,
    ValidationRun,
)


@dataclass(frozen=True)
class OperationalPurgeCounts:
    connectors: int = 0
    sources: int = 0
    streams: int = 0
    mappings: int = 0
    enrichments: int = 0
    destinations: int = 0
    routes: int = 0
    checkpoints: int = 0
    backfill_jobs: int = 0
    continuous_validations: int = 0
    delivery_logs_unlinked: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "connectors": self.connectors,
            "sources": self.sources,
            "streams": self.streams,
            "mappings": self.mappings,
            "enrichments": self.enrichments,
            "destinations": self.destinations,
            "routes": self.routes,
            "checkpoints": self.checkpoints,
            "backfill_jobs": self.backfill_jobs,
            "continuous_validations": self.continuous_validations,
            "delivery_logs_unlinked": self.delivery_logs_unlinked,
        }


def count_operational_entities(db: Session) -> OperationalPurgeCounts:
    return OperationalPurgeCounts(
        connectors=db.query(Connector).count(),
        sources=db.query(Source).count(),
        streams=db.query(Stream).count(),
        mappings=db.query(Mapping).count(),
        enrichments=db.query(Enrichment).count(),
        destinations=db.query(Destination).count(),
        routes=db.query(Route).count(),
        checkpoints=db.query(Checkpoint).count(),
        backfill_jobs=db.query(BackfillJob).count(),
        continuous_validations=db.query(ContinuousValidation).count(),
    )


def clear_operational_entities(db: Session) -> OperationalPurgeCounts:
    """Delete all connector/stream pipeline configuration; keep delivery_logs content."""

    before = count_operational_entities(db)

    unlinked = (
        db.execute(
            update(DeliveryLog).values(
                connector_id=None,
                stream_id=None,
                route_id=None,
                destination_id=None,
            )
        ).rowcount
        or 0
    )

    # Validation and backfill reference streams; remove before stream graph delete.
    db.execute(delete(ValidationRecoveryEvent))
    db.execute(delete(ValidationAlert))
    db.execute(delete(ValidationRun))
    db.execute(delete(ContinuousValidation))
    db.execute(delete(BackfillProgressEvent))
    db.execute(delete(BackfillJob))

    db.execute(delete(Route))
    db.execute(delete(Mapping))
    db.execute(delete(Enrichment))
    db.execute(delete(Checkpoint))
    db.execute(delete(Stream))
    db.execute(delete(Source))
    db.execute(delete(Connector))
    db.execute(delete(Destination))
    db.flush()

    return OperationalPurgeCounts(
        connectors=before.connectors,
        sources=before.sources,
        streams=before.streams,
        mappings=before.mappings,
        enrichments=before.enrichments,
        destinations=before.destinations,
        routes=before.routes,
        checkpoints=before.checkpoints,
        backfill_jobs=before.backfill_jobs,
        continuous_validations=before.continuous_validations,
        delivery_logs_unlinked=int(unlinked),
    )
