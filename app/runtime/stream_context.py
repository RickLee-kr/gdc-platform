"""Runtime DTO for stream execution context loaded from DB."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass(slots=True)
class StreamContext:
    """Aggregated execution context for one stream run."""

    stream: Any
    source: Any
    mapping: Any | None
    enrichment: Any | None
    routes: list[Any]
    destinations_by_route: dict[int, Any]
    checkpoint: dict[str, Any] | None
    # Operational replay (backfill): bounded time window, optional dry-run, never advance production checkpoint.
    persist_checkpoint: bool = True
    replay_start: datetime | None = None
    replay_end: datetime | None = None
    dry_run: bool = False
