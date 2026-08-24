"""Process-wide destination circuit breaker shared by runtime workers."""

from __future__ import annotations

from app.delivery.circuit_breaker import DestinationCircuitBreaker

_breaker = DestinationCircuitBreaker()


def get_process_destination_circuit_breaker() -> DestinationCircuitBreaker:
    return _breaker


def reset_process_destination_circuit_breaker_for_tests() -> None:
    global _breaker
    _breaker = DestinationCircuitBreaker()
