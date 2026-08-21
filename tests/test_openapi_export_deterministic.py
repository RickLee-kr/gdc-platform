"""OpenAPI export must succeed and be byte-stable (QA Track D)."""

from __future__ import annotations

import hashlib
import json

import pytest


def test_openapi_export_succeeds_and_is_deterministic() -> None:
    from scripts.openapi.export_openapi import dumps_deterministic, export_schema

    schema_a = export_schema()
    text_a = dumps_deterministic(schema_a)
    schema_b = export_schema()
    text_b = dumps_deterministic(schema_b)

    assert schema_a.get("openapi")
    assert "/health" in (schema_a.get("paths") or {})
    assert len(schema_a.get("paths") or {}) >= 50
    assert text_a == text_b
    assert hashlib.sha256(text_a.encode("utf-8")).hexdigest() == hashlib.sha256(
        text_b.encode("utf-8")
    ).hexdigest()

    components = schema_a.get("components") or {}
    schemes = components.get("securitySchemes") or {}
    assert "HTTPBearer" in schemes

    login = (schema_a.get("paths") or {}).get("/api/v1/auth/login") or {}
    post = login.get("post") or {}
    assert "400" in (post.get("responses") or {})

    sources = (schema_a.get("paths") or {}).get("/api/v1/sources/") or {}
    create = sources.get("post") or {}
    assert "404" in (create.get("responses") or {})
    assert create.get("security") == [{"HTTPBearer": []}]

    # Lab diagnostic must not appear in public contract.
    admin_paths = [p for p in (schema_a.get("paths") or {}) if "dev-validation" in p]
    assert admin_paths == []
