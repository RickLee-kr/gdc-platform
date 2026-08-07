"""Contract tests for backend full-test compose isolation."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_run_backend_full_uses_compose_project_and_reuses_healthy_wiremock() -> None:
    text = (ROOT / "scripts/test/run-backend-full.sh").read_text(encoding="utf-8")
    assert 'source "$ROOT/scripts/testing/_env.sh"' in text
    assert "COMPOSE_PROJECT_NAME" in text
    assert "GDC_TEST_CONTAINER_PREFIX" in text
    assert "wiremock_already_healthy" in text
    assert "not recreating container" in text
    assert "docker rm -f" not in text
    assert 'docker compose -p "$COMPOSE_PROJECT_NAME"' in text


def test_testing_env_defaults_isolate_container_prefix() -> None:
    text = (ROOT / "scripts/testing/_env.sh").read_text(encoding="utf-8")
    assert 'GDC_TEST_CONTAINER_PREFIX="${GDC_TEST_CONTAINER_PREFIX:-gdc-smoke}"' in text
    assert "GDC_TEST_COMPOSE_PROJECT" in text
    assert "GDC_TEST_WIREMOCK_HOST_PORT" in text
    assert "SOURCE_E2E_SFTP_CONTAINER" in text
    assert "${GDC_TEST_CONTAINER_PREFIX}-sftp-test" in text


def test_source_e2e_seed_uses_prefixed_sftp_container() -> None:
    text = (ROOT / "scripts/testing/source-e2e/seed-fixtures.sh").read_text(encoding="utf-8")
    assert "SOURCE_E2E_SFTP_CONTAINER" in text
    assert "SFTP_CONTAINER" in text
    assert "gdc-sftp-test:/home/gdc/upload" not in text


def test_compose_wiremock_host_port_is_configurable() -> None:
    text = (ROOT / "docker-compose.test.yml").read_text(encoding="utf-8")
    assert "GDC_TEST_WIREMOCK_HOST_PORT" in text
    assert "gdc}-wiremock-test" in text
