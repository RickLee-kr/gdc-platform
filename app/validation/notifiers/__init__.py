"""Outbound validation alert notification adapters (isolated from StreamRunner)."""

from app.validation.notifiers.dispatcher import schedule_validation_notifications

__all__ = ["schedule_validation_notifications"]
