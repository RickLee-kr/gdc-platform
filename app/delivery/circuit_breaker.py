"""Destination-scoped circuit breaker (CLOSED → OPEN → HALF_OPEN → CLOSED).

Separate from HTTP Resilience (per-request retry/backoff) and from Queue
Backpressure (source progression under queue pressure). Failover remains the
path for Active/Standby secondary selection — this module only suppresses
repeated Destination network I/O during prolonged outages.

State is process-local and keyed by ``destination_id``. Durable Queue items
survive restart; circuit state intentionally resets to CLOSED on process
restart (no new DB table). Undelivered queue items re-trip the breaker after
restart if the destination is still failing.

HTTP 429 / RATE_LIMIT and fatal 4xx are **not** circuit failures — they are
not destination outages (aligned with failover eligibility and HttpOutcome).
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from enum import Enum
from typing import Any

from app.http.resilience import HttpOutcome
from app.runtime.errors import DestinationSendError

DEFAULT_FAILURE_THRESHOLD = 5
DEFAULT_OPEN_SECONDS = 60.0

CIRCUIT_STATE_CLOSED = "CLOSED"
CIRCUIT_STATE_OPEN = "OPEN"
CIRCUIT_STATE_HALF_OPEN = "HALF_OPEN"


class CircuitState(str, Enum):
    CLOSED = CIRCUIT_STATE_CLOSED
    OPEN = CIRCUIT_STATE_OPEN
    HALF_OPEN = CIRCUIT_STATE_HALF_OPEN


class CircuitDecision(str, Enum):
    """Result of ``allow()`` before Destination network I/O."""

    ALLOW = "allow"
    ALLOW_PROBE = "allow_probe"
    BLOCK = "block"


@dataclass(frozen=True, slots=True)
class CircuitBreakerConfig:
    """Minimal destination circuit policy (destination.config_json.circuit_breaker)."""

    failure_threshold: int = DEFAULT_FAILURE_THRESHOLD
    open_seconds: float = DEFAULT_OPEN_SECONDS

    def __post_init__(self) -> None:
        threshold = int(self.failure_threshold)
        if threshold < 1:
            threshold = 1
        open_s = float(self.open_seconds)
        if open_s < 0.0:
            open_s = 0.0
        object.__setattr__(self, "failure_threshold", threshold)
        object.__setattr__(self, "open_seconds", open_s)


@dataclass(frozen=True, slots=True)
class CircuitAllowResult:
    decision: CircuitDecision
    state: CircuitState
    consecutive_failures: int
    transitioned_to_half_open: bool = False


@dataclass(frozen=True, slots=True)
class CircuitTransition:
    """Optional state transition emitted after record_success / record_failure."""

    from_state: CircuitState
    to_state: CircuitState
    event: str  # observability conceptual name


def _get(data: Any, key: str, default: Any = None) -> Any:
    if isinstance(data, dict):
        return data.get(key, default)
    return getattr(data, key, default)


def resolve_circuit_breaker_config(destination_or_config: Any) -> CircuitBreakerConfig:
    """Read ``failure_threshold`` / ``open_seconds`` from destination config."""

    cfg = destination_or_config
    if not isinstance(cfg, dict) or (
        "circuit_breaker" not in cfg
        and "failure_threshold" not in cfg
        and "open_seconds" not in cfg
    ):
        nested_cfg = _get(destination_or_config, "config", None)
        if not isinstance(nested_cfg, dict):
            nested_cfg = _get(destination_or_config, "config_json", None)
        if isinstance(nested_cfg, dict):
            cfg = nested_cfg
        elif not isinstance(cfg, dict):
            cfg = {}

    nested = cfg.get("circuit_breaker") if isinstance(cfg, dict) else None
    src = nested if isinstance(nested, dict) else (cfg if isinstance(cfg, dict) else {})

    raw_threshold = src.get("failure_threshold", DEFAULT_FAILURE_THRESHOLD)
    raw_open = src.get("open_seconds", DEFAULT_OPEN_SECONDS)
    try:
        threshold = int(raw_threshold)
    except (TypeError, ValueError):
        threshold = DEFAULT_FAILURE_THRESHOLD
    try:
        open_seconds = float(raw_open)
    except (TypeError, ValueError):
        open_seconds = DEFAULT_OPEN_SECONDS
    return CircuitBreakerConfig(failure_threshold=threshold, open_seconds=open_seconds)


def is_circuit_failure_outcome(outcome: HttpOutcome | str) -> bool:
    """True when the classified send outcome counts toward opening the circuit.

    Counts: connection / timeout / 5xx (HttpOutcome.RETRY).
    Does not count: RATE_LIMIT (429), FATAL (typical 4xx), SUCCESS.
    """

    value = outcome.value if isinstance(outcome, HttpOutcome) else str(outcome).strip().lower()
    return value == HttpOutcome.RETRY.value


def is_circuit_failure_error(error: BaseException) -> bool:
    """Classify a raised Destination error for circuit failure counting."""

    from app.delivery_queue.outcome import classify_destination_send_error

    return is_circuit_failure_outcome(classify_destination_send_error(error).outcome)


class CircuitOpenError(DestinationSendError):
    """Raised when Destination I/O is blocked because the circuit is OPEN/HALF_OPEN.

    Failover-eligible (bare DestinationSendError path) so Active/Standby can
    proceed to secondary without waiting on primary network I/O.
    """

    def __init__(self, message: str = "destination circuit open; network I/O suppressed") -> None:
        super().__init__(message)


@dataclass
class _DestinationCircuit:
    state: CircuitState = CircuitState.CLOSED
    consecutive_failures: int = 0
    opened_at_monotonic: float | None = None
    half_open_probe_held: bool = False


class DestinationCircuitBreaker:
    """Process-local circuit breaker registry keyed by destination_id."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._by_destination: dict[int, _DestinationCircuit] = {}

    def reset(self) -> None:
        with self._lock:
            self._by_destination.clear()

    def get_state(self, destination_id: int) -> CircuitState:
        with self._lock:
            entry = self._by_destination.get(int(destination_id))
            if entry is None:
                return CircuitState.CLOSED
            return entry.state

    def get_consecutive_failures(self, destination_id: int) -> int:
        with self._lock:
            entry = self._by_destination.get(int(destination_id))
            return int(entry.consecutive_failures) if entry is not None else 0

    def _entry(self, destination_id: int) -> _DestinationCircuit:
        key = int(destination_id)
        entry = self._by_destination.get(key)
        if entry is None:
            entry = _DestinationCircuit()
            self._by_destination[key] = entry
        return entry

    def allow(
        self,
        destination_id: int,
        config: CircuitBreakerConfig | None = None,
        *,
        now: float | None = None,
    ) -> CircuitAllowResult:
        """Decide whether Destination network I/O may proceed.

        HALF_OPEN allows exactly one concurrent probe (``ALLOW_PROBE``); other
        callers receive ``BLOCK`` until the probe succeeds or fails.
        """

        cfg = config or CircuitBreakerConfig()
        ts = time.monotonic() if now is None else float(now)
        with self._lock:
            entry = self._entry(destination_id)
            if entry.state == CircuitState.CLOSED:
                return CircuitAllowResult(
                    decision=CircuitDecision.ALLOW,
                    state=CircuitState.CLOSED,
                    consecutive_failures=entry.consecutive_failures,
                )

            if entry.state == CircuitState.OPEN:
                opened_at = entry.opened_at_monotonic
                if opened_at is not None and (ts - opened_at) >= float(cfg.open_seconds):
                    entry.state = CircuitState.HALF_OPEN
                    entry.half_open_probe_held = True
                    return CircuitAllowResult(
                        decision=CircuitDecision.ALLOW_PROBE,
                        state=CircuitState.HALF_OPEN,
                        consecutive_failures=entry.consecutive_failures,
                        transitioned_to_half_open=True,
                    )
                return CircuitAllowResult(
                    decision=CircuitDecision.BLOCK,
                    state=CircuitState.OPEN,
                    consecutive_failures=entry.consecutive_failures,
                )

            # HALF_OPEN
            if entry.half_open_probe_held:
                return CircuitAllowResult(
                    decision=CircuitDecision.BLOCK,
                    state=CircuitState.HALF_OPEN,
                    consecutive_failures=entry.consecutive_failures,
                )
            entry.half_open_probe_held = True
            return CircuitAllowResult(
                decision=CircuitDecision.ALLOW_PROBE,
                state=CircuitState.HALF_OPEN,
                consecutive_failures=entry.consecutive_failures,
            )

    def record_success(
        self,
        destination_id: int,
        *,
        was_probe: bool = False,
    ) -> CircuitTransition | None:
        with self._lock:
            entry = self._entry(destination_id)
            from_state = entry.state
            entry.consecutive_failures = 0
            entry.opened_at_monotonic = None
            entry.half_open_probe_held = False
            if from_state == CircuitState.CLOSED:
                return None
            entry.state = CircuitState.CLOSED
            event = (
                "circuit_probe_success"
                if was_probe or from_state == CircuitState.HALF_OPEN
                else "circuit_closed"
            )
            return CircuitTransition(
                from_state=from_state,
                to_state=CircuitState.CLOSED,
                event=event,
            )

    def record_failure(
        self,
        destination_id: int,
        config: CircuitBreakerConfig | None = None,
        *,
        was_probe: bool = False,
        now: float | None = None,
    ) -> CircuitTransition | None:
        """Count a transient destination failure; may OPEN or re-OPEN the circuit."""

        cfg = config or CircuitBreakerConfig()
        ts = time.monotonic() if now is None else float(now)
        with self._lock:
            entry = self._entry(destination_id)
            from_state = entry.state

            if from_state == CircuitState.HALF_OPEN or was_probe:
                entry.state = CircuitState.OPEN
                entry.opened_at_monotonic = ts
                entry.half_open_probe_held = False
                entry.consecutive_failures = max(int(entry.consecutive_failures), 1)
                return CircuitTransition(
                    from_state=from_state,
                    to_state=CircuitState.OPEN,
                    event="circuit_probe_failed",
                )

            if from_state == CircuitState.OPEN:
                # Blocked path should not call record_failure; ignore if it does.
                return None

            entry.consecutive_failures = int(entry.consecutive_failures) + 1
            if entry.consecutive_failures >= int(cfg.failure_threshold):
                entry.state = CircuitState.OPEN
                entry.opened_at_monotonic = ts
                entry.half_open_probe_held = False
                return CircuitTransition(
                    from_state=from_state,
                    to_state=CircuitState.OPEN,
                    event="circuit_opened",
                )
            return None

    def force_open_for_tests(
        self,
        destination_id: int,
        *,
        opened_at_monotonic: float | None = None,
        consecutive_failures: int | None = None,
    ) -> None:
        with self._lock:
            entry = self._entry(destination_id)
            entry.state = CircuitState.OPEN
            entry.opened_at_monotonic = (
                time.monotonic() if opened_at_monotonic is None else float(opened_at_monotonic)
            )
            if consecutive_failures is not None:
                entry.consecutive_failures = int(consecutive_failures)
            entry.half_open_probe_held = False
