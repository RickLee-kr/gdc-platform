"""Wall-clock timing trace for one StreamRunner cycle (S4-11)."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

_STANDARD_PHASES = (
    "source_fetch",
    "parse",
    "mapping",
    "enrichment",
    "schema_drift",
    "sensitive_detection",
    "classification",
    "protection",
    "policy",
    "routing",
    "destination_send",
    "checkpoint",
)


@dataclass
class RunTimingTrace:
    """Accumulates per-phase milliseconds for a single stream run."""

    _run_start: float = field(default_factory=time.monotonic)
    _phase_starts: dict[str, float] = field(default_factory=dict)
    phases_ms: dict[str, int] = field(default_factory=dict)

    def start_phase(self, name: str) -> None:
        self._phase_starts[name] = time.monotonic()

    def end_phase(self, name: str) -> None:
        started = self._phase_starts.pop(name, None)
        if started is None:
            return
        self.add_ms(name, max(0, int((time.monotonic() - started) * 1000)))

    def add_ms(self, name: str, ms: int) -> None:
        delta = max(0, int(ms))
        if delta <= 0:
            return
        self.phases_ms[name] = int(self.phases_ms.get(name, 0)) + delta

    def finalize(self) -> dict[str, Any]:
        run_total = max(0, int((time.monotonic() - self._run_start) * 1000))
        trace = {name: int(self.phases_ms.get(name, 0)) for name in _STANDARD_PHASES}
        trace["run_total"] = run_total
        return {
            "run_duration_ms": run_total,
            "timing_trace_ms": trace,
        }


class PhaseTimer:
    """Context manager that records wall-clock time for one named phase."""

    __slots__ = ("_name", "_trace")

    def __init__(self, trace: RunTimingTrace | None, name: str) -> None:
        self._trace = trace
        self._name = name

    def __enter__(self) -> PhaseTimer:
        if self._trace is not None:
            self._trace.start_phase(self._name)
        return self

    def __exit__(self, exc_type: object, exc: object, tb: object) -> None:
        if self._trace is not None:
            self._trace.end_phase(self._name)
