"""Thin bridge from StreamRunner to quarantine (minimal runner touch)."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.quarantine.service import try_policy_quarantine_for_batch

__all__ = ["try_policy_quarantine_for_batch"]
