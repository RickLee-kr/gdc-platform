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
    assert "GDC_SEED_ADMIN_PASSWORD: ${GDC_SEED_ADMIN_PASSWORD:-}" in text
    assert "python -m app.db.seed --platform-admin-only --reconcile-admin-password" not in text
    assert (
        "alembic upgrade head && python -m app.db.seed --platform-admin-only && uvicorn"
        in text
    )


def test_root_compose_is_not_postgres_only() -> None:
    text = _read("docker-compose.yml")
    assert "service: api" in text
    assert "service: frontend" in text
    assert "service: reverse-proxy" in text
    assert "service: scheduler" in text
    assert "service: gdc-wiremock-test" in text
    assert "service: gdc-webhook-receiver-test" in text
    assert "service: gdc-syslog-test" in text
    assert "gdc_postgres_data" not in text
    platform = _read("docker-compose.platform.yml")
    assert 'profiles: ["lab"]' in platform
    assert "ENABLE_DEV_VALIDATION_LAB: ${ENABLE_DEV_VALIDATION_LAB:-false}" in platform


def test_canonical_start_script_runs_build_up_and_validation() -> None:
    start = _read("scripts/dev/start-platform.sh")
    assert "bootstrap-dev-platform.sh" in start
    text = _read("scripts/dev/bootstrap-dev-platform.sh")
    assert "build" in text
    assert " up " in text or "up -d" in text
    assert '"$ROOT/scripts/dev/validate-platform-ready.sh"' in text
    assert "password admin unless GDC_SEED_ADMIN_PASSWORD is set" in text
    assert "Stellar1!" not in text
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
    assert "check_scheduler_health" in text
    assert "service: scheduler" in text or "service_ok scheduler" in text
    assert "for svc in postgres api frontend reverse-proxy scheduler" in text


def test_validation_script_requires_real_admin_login() -> None:
    text = _read("scripts/dev/validate-platform-ready.sh")
    assert 'ADMIN_USERNAME="admin"' in text
    assert "resolve_admin_password" in text
    assert "env_or_file GDC_SEED_ADMIN_PASSWORD" in text
    assert '-X POST "$API_ROOT/api/v1/auth/login"' in text
    assert "access_token" in text
    assert "credential drift" in text
    assert "admin auth validated" in text
    assert "--skip-auth-check" in text
    assert "--admin-password" in text
    assert "Persisted admin passwords are never overwritten automatically" in text
    assert "password_change_required" in text
    assert "must_change_password" in text
    assert "password change required" in text
    assert "sign in to the UI and change the password" in text


def test_reset_admin_password_script_is_explicit_recovery_only() -> None:
    text = _read("scripts/admin/reset-admin-password.sh")
    assert "GDC_RECONCILE_ADMIN_PASSWORD=true" in text
    assert "python -m app.db.seed --platform-admin-only" in text
    assert "Type YES to continue" in text
    assert "GDC_SEED_ADMIN_PASSWORD" in text
    assert "delivery_logs" in text
    assert "[admin-reset]" in text
    assert "Login username:" in text
    assert "admin-password-reset.md" in text
