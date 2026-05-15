"""Built-in validation template metadata (configuration hints; streams remain normal platform rows)."""

from __future__ import annotations

from typing import Any

BUILTIN_VALIDATION_TEMPLATES: list[dict[str, Any]] = [
    {
        "id": "generic_rest_polling",
        "title": "Generic REST",
        "description": "Bearer-authenticated HTTP polling against a REST API (use after template instantiate).",
        "suggested_validation_type": "FULL_RUNTIME",
    },
    {
        "id": "vendor_jwt_exchange",
        "title": "Vendor JWT",
        "description": "Vendor JWT exchange auth flow; pair with a stream using vendor_jwt_exchange auth.",
        "suggested_validation_type": "AUTH_ONLY",
    },
    {
        "id": "oauth2_client_credentials",
        "title": "OAuth2 Client Credentials",
        "description": "OAuth2 client-credentials token flow (Okta-style templates).",
        "suggested_validation_type": "AUTH_ONLY",
    },
    {
        "id": "syslog_udp",
        "title": "Syslog UDP",
        "description": "Delivery validation via SYSLOG_UDP destination and local/echo receiver.",
        "suggested_validation_type": "FULL_RUNTIME",
    },
    {
        "id": "syslog_tcp",
        "title": "Syslog TCP",
        "description": "Delivery validation via SYSLOG_TCP destination and local/echo receiver.",
        "suggested_validation_type": "FULL_RUNTIME",
    },
    {
        "id": "webhook_post",
        "title": "Webhook delivery",
        "description": "WEBHOOK_POST delivery to internal echo URL or WireMock receiver.",
        "suggested_validation_type": "FULL_RUNTIME",
    },
]


def list_builtin_templates() -> list[dict[str, Any]]:
    return list(BUILTIN_VALIDATION_TEMPLATES)
