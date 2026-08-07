from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.jwt_service import issue_access_token
from app.database import get_db
from app.main import app


@pytest.fixture
def client(db_session: Session) -> TestClient:
    def _override() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def _bearer(role: str, *, user_id: int = 1) -> dict[str, str]:
    token, _ = issue_access_token(
        username=f"{role.lower()}-dv",
        user_id=user_id,
        role=role,
        token_version=1,
    )
    return {"Authorization": f"Bearer {token}"}


def test_dev_validation_status_requires_administrator(client: TestClient) -> None:
    for role in ("VIEWER", "OPERATOR"):
        r = client.get("/api/v1/admin/dev-validation/status", headers=_bearer(role))
        assert r.status_code == 403, (role, r.text)


def test_dev_validation_status_administrator_shape(client: TestClient) -> None:
    r = client.get("/api/v1/admin/dev-validation/status", headers=_bearer("ADMINISTRATOR"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert "generated_at" in body
    assert "fixture_readiness_badge" in body
    assert "fixtures_required" in body
    assert "fixture_readiness" in body
    assert "streams_dependency_missing" in body
    assert isinstance(body["fixture_readiness"], dict)


def test_dev_validation_status_trailing_slash_ok(client: TestClient) -> None:
    """Some proxies or clients append a trailing slash; both paths must resolve (Administrator)."""

    r = client.get("/api/v1/admin/dev-validation/status/", headers=_bearer("ADMINISTRATOR"))
    assert r.status_code == 200, r.text
    assert r.json().get("fixture_readiness_badge") is not None


def _collect_route_paths(routes: Any, *, prefix: str = "") -> set[str]:
    """Collect paths from flat (FastAPI <0.137) or nested (_IncludedRouter) route trees."""

    paths: set[str] = set()
    for route in routes:
        include_context = getattr(route, "include_context", None)
        original_router = getattr(route, "original_router", None)
        if include_context is not None and original_router is not None and hasattr(original_router, "routes"):
            child_prefix = f"{prefix}{getattr(include_context, 'prefix', '') or ''}"
            paths |= _collect_route_paths(original_router.routes, prefix=child_prefix)
            continue

        route_prefix = getattr(route, "prefix", None)
        nested_router = getattr(route, "router", None)
        nested_routes = getattr(route, "routes", None)
        if nested_router is not None and hasattr(nested_router, "routes"):
            child_prefix = f"{prefix}{route_prefix or ''}"
            paths |= _collect_route_paths(nested_router.routes, prefix=child_prefix)
            continue
        if nested_routes is not None and not hasattr(route, "path"):
            child_prefix = f"{prefix}{route_prefix or ''}"
            paths |= _collect_route_paths(nested_routes, prefix=child_prefix)
            continue
        path = getattr(route, "path", None)
        if isinstance(path, str):
            paths.add(f"{prefix}{path}" if prefix else path)
    return paths


def test_dev_validation_status_registered_on_app() -> None:
    from app.main import app

    paths: set[str]
    try:
        from fastapi.routing import iter_route_contexts

        paths = {
            str(ctx.path)
            for ctx in iter_route_contexts(app.routes)
            if getattr(ctx, "path", None)
        }
    except Exception:  # noqa: BLE001 — FastAPI <0.137 has no iter_route_contexts
        paths = _collect_route_paths(app.routes)

    assert "/api/v1/admin/dev-validation/status" in paths
    assert "/api/v1/admin/dev-validation/status/" in paths
