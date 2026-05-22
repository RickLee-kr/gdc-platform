"""DATABASE_URL resolution for host shell vs Docker Compose."""

from __future__ import annotations

import os
from unittest.mock import patch

from app.database_url_resolution import (
    hostname_resolves,
    is_runtime_in_container,
    resolve_runtime_database_url,
)

COMPOSE_URL = "postgresql://gdc:gdc@postgres:5432/gdc"
HOST_URL = "postgresql://gdc:gdc@127.0.0.1:55432/gdc"


def test_in_container_keeps_postgres_hostname(monkeypatch) -> None:
    monkeypatch.setenv("GDC_RUNTIME_IN_CONTAINER", "true")
    monkeypatch.delenv("GDC_HOST_DATABASE_URL", raising=False)
    res = resolve_runtime_database_url(COMPOSE_URL, context="alembic")
    assert res.url == COMPOSE_URL
    assert res.source == "container_unchanged"
    assert res.in_container is True


def test_explicit_host_url_on_host_shell(monkeypatch) -> None:
    monkeypatch.delenv("GDC_RUNTIME_IN_CONTAINER", raising=False)
    monkeypatch.setattr("app.database_url_resolution.os.path.exists", lambda p: False)
    monkeypatch.setenv("GDC_HOST_DATABASE_URL", HOST_URL)
    res = resolve_runtime_database_url(COMPOSE_URL, context="alembic")
    assert res.url == HOST_URL
    assert res.source == "GDC_HOST_DATABASE_URL"


def test_host_fallback_when_postgres_does_not_resolve(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.delenv("GDC_RUNTIME_IN_CONTAINER", raising=False)
    monkeypatch.delenv("GDC_HOST_DATABASE_URL", raising=False)
    monkeypatch.delenv("DEV_DATABASE_URL", raising=False)
    monkeypatch.setenv("GDC_PLATFORM_POSTGRES_HOST_PORT", "55432")
    monkeypatch.setattr("app.database_url_resolution.os.path.exists", lambda p: False)
    monkeypatch.setattr("app.database_url_resolution.hostname_resolves", lambda h: h != "postgres")
    res = resolve_runtime_database_url(COMPOSE_URL, context="alembic")
    assert res.fallback_applied is True
    assert "@127.0.0.1:55432/" in res.url
    assert res.source == "compose_host_fallback"


def test_production_does_not_rewrite_postgres_on_host(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("GDC_RUNTIME_IN_CONTAINER", raising=False)
    monkeypatch.setattr("app.database_url_resolution.os.path.exists", lambda p: False)
    monkeypatch.setattr("app.database_url_resolution.hostname_resolves", lambda h: False)
    res = resolve_runtime_database_url(COMPOSE_URL, context="alembic")
    assert res.url == COMPOSE_URL
    assert res.source == "production_unchanged"


def test_pytest_context_prefers_test_database_url(monkeypatch) -> None:
    monkeypatch.setenv("TEST_DATABASE_URL", "postgresql://gdc:gdc@127.0.0.1:55441/gdc_pytest")
    res = resolve_runtime_database_url(COMPOSE_URL, context="pytest")
    assert "55441" in res.url
    assert res.source == "TEST_DATABASE_URL"


def test_hostname_resolves_localhost() -> None:
    assert hostname_resolves("127.0.0.1") is True
    assert hostname_resolves("localhost") is True
