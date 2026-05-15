"""Backward-compatible exports for the unified operational retention scheduler.

Scheduling is implemented in ``app.retention.scheduler`` (single daemon thread).
``RetentionCleanupScheduler`` remains an alias for ``OperationalRetentionScheduler``
so existing imports and documentation references keep working.
"""

from __future__ import annotations

from app.retention.scheduler import (
    OperationalRetentionScheduler as RetentionCleanupScheduler,
    get_operational_retention_scheduler as get_cleanup_scheduler,
    register_operational_retention_scheduler as register_cleanup_scheduler,
)

__all__ = [
    "RetentionCleanupScheduler",
    "get_cleanup_scheduler",
    "register_cleanup_scheduler",
]
