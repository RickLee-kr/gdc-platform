"""Static checks for dev-validation fixture bootstrap scripts and container endpoint policy."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.dev_validation_lab import templates as T
from app.dev_validation_lab.env_defaults import _fixture_endpoint_defaults
from app.runtime.health_scoring_policy import stream_config_excluded_from_health_scoring

ROOT = Path(__file__).resolve().parents[1]


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def test_seed_database_uses_docker_compose_exec_not_host_mysql() -> None:
    seed = _read("scripts/testing/source-expansion/seed-database-fixtures.sh")
    db_exec = _read("scripts/dev-validation/lib/db-exec.sh")
    assert "db-exec.sh" in seed
    assert "_fixture_compose exec" in db_exec
    assert "mysql-query-test" in seed
    assert "mariadb-query-test" in seed
    assert "127.0.0.1 -P3306 --protocol=TCP" in db_exec
    assert "DATABASE_QUERY_PG_URL" not in seed
    assert "psql \"$PG_URL\"" not in seed


def test_bootstrap_waits_mysql_mariadb_with_select_1() -> None:
    text = _read("scripts/dev-validation/bootstrap-platform-dev-validation.sh")
    assert "_wait_sql_tcp mysql-query-test" in text
    assert "_wait_sql_tcp mariadb-query-test" in text
    assert "smoke-fixture-bootstrap.sh" in text


def test_bootstrap_does_not_invoke_host_mysql_client() -> None:
    text = _read("scripts/dev-validation/bootstrap-platform-dev-validation.sh")
    assert "mysql " not in text.replace("mysql-query-test", "")
    assert "mariadb " not in text.replace("mariadb-query-test", "")


def test_minio_seed_uses_docker_network_not_host_only() -> None:
    text = _read("scripts/dev-validation/seed-minio-fixtures.sh")
    assert "gdc-minio-test:9000" in text
    assert "docker run" in text
    assert "DEV_VALIDATION_DOCKER_NETWORK" in text


def test_platform_dev_validation_overlay_container_urls() -> None:
    text = _read("docker-compose.platform.dev-validation.yml")
    assert "http://gdc-wiremock-test:8080" in text
    assert "http://gdc-webhook-receiver-test:8080" in text
    assert "http://gdc-minio-test:9000" in text
    assert "127.0.0.1" not in text
    assert "28080" not in text
    assert "18091" not in text


def test_docker_env_defaults_use_fixture_service_names(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.dev_validation_lab.env_defaults.Path.exists", lambda self: self.as_posix() == "/.dockerenv")
    eps = _fixture_endpoint_defaults()
    assert "gdc-wiremock-test" in eps["DEV_VALIDATION_WIREMOCK_BASE_URL"]
    assert "gdc-webhook-receiver-test" in eps["DEV_VALIDATION_WEBHOOK_BASE_URL"]
    assert "gdc-minio-test" in eps["MINIO_ENDPOINT"]
    for key, val in eps.items():
        if isinstance(val, str):
            assert "127.0.0.1" not in val
            assert "localhost" not in val


def test_lab_templates_do_not_embed_host_mapped_ports() -> None:
    text = _read("app/dev_validation_lab/templates.py")
    assert "28080" not in text
    assert "18091" not in text
    assert "59000" not in text
    assert "127.0.0.1" not in text


def test_health_scoring_exclusion_flags_remain() -> None:
    cfg = {"exclude_from_health_scoring": True, "validation_expected_failure": True}
    assert stream_config_excluded_from_health_scoring(cfg) is True
    assert T.TK_OAUTH_TOKEN_EXCHANGE_FAIL in T.HEALTH_SCORING_EXCLUDED_TEMPLATE_KEYS
