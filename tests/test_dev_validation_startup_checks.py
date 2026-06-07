"""Dev-validation startup diagnostics (structured logs, fail-open)."""

from __future__ import annotations

import pytest

from app.dev_validation_lab import startup_checks


def test_startup_checks_emit_structured_logs(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(startup_checks, "dev_validation_runtime_enabled", lambda: True)
    resolved: list[str] = []
    failed: list[str] = []

    def fake_resolve(host: str) -> tuple[bool, str | None]:
        if host == "gdc-wiremock-test":
            resolved.append(host)
            return True, None
        failed.append(host)
        return False, "temporary failure"

    monkeypatch.setattr(startup_checks, "_resolve_hostname", fake_resolve)
    mappings = startup_checks._wiremock_mappings_dir()
    if not mappings.is_dir():
        pytest.skip("wiremock mappings dir not present in this checkout")

    startup_checks.log_dev_validation_runtime_startup_checks()

    assert "gdc-wiremock-test" in resolved
    assert len(resolved) == 1
    assert len(failed) == len(startup_checks._FIXTURE_HOSTNAMES) - 1
    assert mappings.is_dir()
