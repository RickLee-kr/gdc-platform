"""Runtime DTO for stream execution context loaded from DB."""

from __future__ import annotations

from dataclasses import dataclass
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
