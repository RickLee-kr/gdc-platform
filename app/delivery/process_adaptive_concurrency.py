"""Process-wide destination adaptive concurrency shared by runtime workers."""

from __future__ import annotations

from app.delivery.adaptive_concurrency import DestinationAdaptiveConcurrency

_controller = DestinationAdaptiveConcurrency()


def get_process_destination_adaptive_concurrency() -> DestinationAdaptiveConcurrency:
    return _controller


def reset_process_destination_adaptive_concurrency_for_tests() -> None:
    global _controller
    _controller = DestinationAdaptiveConcurrency()
