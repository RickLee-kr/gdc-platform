"""Development-only validation lab: additive WireMock-backed entities (see docs/testing/dev-validation-lab.md)."""

from __future__ import annotations

from typing import Any

__all__ = ["run_dev_validation_lab_startup", "seed_dev_validation_lab"]


def __getattr__(name: str) -> Any:
    if name == "run_dev_validation_lab_startup":
        from app.dev_validation_lab.runtime import run_dev_validation_lab_startup

        return run_dev_validation_lab_startup
    if name == "seed_dev_validation_lab":
        from app.dev_validation_lab.seeder import seed_dev_validation_lab

        return seed_dev_validation_lab
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
