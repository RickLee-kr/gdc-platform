"""Dev-validation startup diagnostics (structured logs, fail-open)."""

from __future__ import annotations

import logging

import pytest

from app.dev_validation_lab import startup_checks


def test_startup_checks_emit_structured_logs(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(startup_checks, "dev_validation_runtime_enabled", lambda: True)
    monkeypatch.setattr(
        startup_checks,
        "_resolve_hostname",
        lambda host: (host == "gdc-wiremock-test", "temporary failure" if host != "gdc-wiremock-test" else None),
    )
    mappings = startup_checks._wiremock_mappings_dir()
    if not mappings.is_dir():
        pytest.skip("wiremock mappings dir not present in this checkout")

    caplog.set_level(logging.INFO, logger=startup_checks.logger.name)
    startup_checks.log_dev_validation_runtime_startup_checks()

    text = caplog.text
    assert "dev_validation_runtime_ready" in text
    assert "dev_validation_wiremock_assets_ready" in text
    assert "dev_validation_hostname_resolved" in text
    assert "dev_validation_hostname_resolution_failed" in text
