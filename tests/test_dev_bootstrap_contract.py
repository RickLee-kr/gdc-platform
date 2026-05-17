"""Static regression checks for the deterministic development bootstrap contract."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def test_platform_compose_contains_full_development_services() -> None:
    text = _read("docker-compose.platform.yml")
    for service in (
        "postgres:",
        "api:",
        "frontend:",
        "reverse-proxy:",
        "gdc-wiremock-test:",
        "gdc-webhook-receiver-test:",
        "gdc-syslog-test:",
    ):
        assert service in text


def test_platform_compose_uses_canonical_gdc_identity() -> None:
    text = _read("docker-compose.platform.yml")
    assert "POSTGRES_DB: ${POSTGRES_DB:-gdc}" in text
    assert "POSTGRES_USER: ${POSTGRES_USER:-gdc}" in text
    assert "POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-gdc}" in text
    assert "postgresql://${POSTGRES_USER:-gdc}:${POSTGRES_PASSWORD:-gdc}@postgres:5432/${POSTGRES_DB:-gdc}" in text
    assert "gdc_platform_postgres_data" in text
    assert "datarelay" not in text.lower()


def test_platform_compose_bootstraps_admin_with_reconciliation() -> None:
    text = _read("docker-compose.platform.yml")
    assert "GDC_SEED_ADMIN_PASSWORD: ${GDC_SEED_ADMIN_PASSWORD:-Stellar1!}" in text
    assert "python -m app.db.seed --platform-admin-only --reconcile-admin-password" in text
    assert (
        "alembic upgrade head && python -m app.db.seed --platform-admin-only --reconcile-admin-password && uvicorn"
        in text
    )


def test_root_compose_is_not_postgres_only() -> None:
    text = _read("docker-compose.yml")
    assert "service: api" in text
    assert "service: frontend" in text
    assert "service: reverse-proxy" in text
    assert "service: gdc-wiremock-test" in text
    assert "service: gdc-webhook-receiver-test" in text
    assert "service: gdc-syslog-test" in text
    assert "gdc_postgres_data" not in text


def test_canonical_start_script_runs_build_up_and_validation() -> None:
    text = _read("scripts/dev/start-platform.sh")
    assert 'docker compose -f "$COMPOSE_FILE" build' in text
    assert 'docker compose -f "$COMPOSE_FILE" up -d' in text
    assert '"$ROOT/scripts/dev/validate-platform-ready.sh"' in text
    assert 'export GDC_SEED_ADMIN_PASSWORD="${GDC_SEED_ADMIN_PASSWORD:-Stellar1!}"' in text
    assert "APP_ENV" in text
    assert "production|prod" in text


def test_validation_script_requires_real_runtime_telemetry() -> None:
    text = _read("scripts/dev/validate-platform-ready.sh")
    assert "/api/v1/runtime/status" in text
    assert "/api/v1/runtime/dashboard/summary" in text
    assert "/api/v1/runtime/logs/search" in text
    assert "/api/v1/runtime/analytics/delivery-outcomes/destinations" in text
    assert "/api/v1/runtime/streams/$stream_id/run-once" in text
    assert "SELECT count(*) FROM delivery_logs" in text
    assert "INSERT INTO DELIVERY_LOGS" not in text.upper()


def test_validation_script_requires_real_admin_login() -> None:
    text = _read("scripts/dev/validate-platform-ready.sh")
    assert 'ADMIN_USERNAME="admin"' in text
    assert 'ADMIN_PASSWORD="${GDC_SEED_ADMIN_PASSWORD:-Stellar1!}"' in text
    assert '-X POST "$API_ROOT/api/v1/auth/login"' in text
    assert "access_token" in text
    assert "admin auth validation failed" in text
    assert "[bootstrap] admin auth validation passed" in text
