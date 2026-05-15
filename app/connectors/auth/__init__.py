"""Connector HTTP authentication strategies (registry-based dispatch)."""

from __future__ import annotations

from app.connectors.auth.base import AuthStrategy
from app.connectors.auth.normalize import normalize_connector_auth
from app.connectors.auth.registry import AuthStrategyRegistry, apply_auth_to_http_request

__all__ = [
    "AuthStrategy",
    "AuthStrategyRegistry",
    "apply_auth_to_http_request",
    "normalize_connector_auth",
]
