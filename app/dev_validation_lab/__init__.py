"""Development-only validation lab: additive WireMock-backed entities (see docs/testing/dev-validation-lab.md)."""

from __future__ import annotations

from app.dev_validation_lab.runtime import run_dev_validation_lab_startup
from app.dev_validation_lab.seeder import seed_dev_validation_lab

__all__ = ["run_dev_validation_lab_startup", "seed_dev_validation_lab"]
