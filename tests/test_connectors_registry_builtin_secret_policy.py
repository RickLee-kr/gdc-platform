"""Builtin connector secret-policy coverage."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from app.connectors_registry.loader import load_connector_modules


def _write_module(root: Path, sample: dict[str, object]) -> tuple[Path, str]:
    connector_id = "secret-policy-test"
    module_dir = root / connector_id
    module_dir.mkdir(parents=True)
    (module_dir / "manifest.yaml").write_text(
        yaml.safe_dump(
            {
                "id": connector_id,
                "name": "Secret Policy Test",
                "vendor": "Acme",
                "version": "1.0.0",
                "source_type": "HTTP_API_POLLING",
                "auth": {"type": "api_key"},
                "streams": [{"id": "events", "name": "Events"}],
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    samples_dir = module_dir / "samples"
    samples_dir.mkdir()
    (samples_dir / "config.json").write_text(json.dumps(sample), encoding="utf-8")
    return module_dir, connector_id


@pytest.mark.parametrize(
    "sample",
    [
        {"api_key": "${API_KEY}"},
        {"password": "${PASSWORD}"},
        {"client_secret": "<redacted>"},
        {"api_key": None, "password": ""},
        {"region": "us-east-1", "endpoint": "https://api.example.test/events"},
        {"api_key": "{{api_key}}", "client_secret": "REPLACE_ME"},
        {"credential_ref": "cred://team/acme", "secret_ref": "vault://acme"},
    ],
)
def test_builtin_secret_placeholders_and_normal_samples_pass(
    tmp_path: Path,
    sample: dict[str, object],
) -> None:
    root = tmp_path / "connectors"
    _module_dir, connector_id = _write_module(root, sample)

    result = load_connector_modules(root=root)

    assert result.modules[connector_id].status == "valid"
    assert not any(issue.rule_id == "SMP-002" for issue in result.issues)


@pytest.mark.parametrize(
    ("sample", "expected_rule"),
    [
        ({"api_key": "sk-live-abcdefghijklmnopqrstuvwxyz"}, "secret_field:api_key"),
        ({"password": "literal-password-value"}, "secret_field:password"),
        (
            {"headers": {"custom": "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456"}},
            "authorization_bearer",
        ),
    ],
)
def test_builtin_literal_secrets_are_validation_issues(
    tmp_path: Path,
    sample: dict[str, object],
    expected_rule: str,
) -> None:
    root = tmp_path / "connectors"
    _module_dir, connector_id = _write_module(root, sample)

    result = load_connector_modules(root=root)
    entry = result.modules[connector_id]
    secret_issues = [issue for issue in entry.errors if issue.rule_id == "SMP-002"]

    assert entry.status == "invalid"
    assert secret_issues
    assert expected_rule in secret_issues[0].message
    assert "samples/config.json" in secret_issues[0].message
    assert json.dumps(sample) not in secret_issues[0].message


def test_builtin_private_key_is_validation_issue_without_secret_value(tmp_path: Path) -> None:
    root = tmp_path / "connectors"
    module_dir, connector_id = _write_module(root, {"region": "us-east-1"})
    private_key_body = (
        "-----BEGIN PRIVATE KEY-----\n"
        "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSj\n"
        "-----END PRIVATE KEY-----\n"
    )
    (module_dir / "fixture.pem").write_text(private_key_body, encoding="utf-8")

    result = load_connector_modules(root=root)
    entry = result.modules[connector_id]
    secret_issues = [issue for issue in entry.errors if issue.rule_id == "SMP-002"]

    assert entry.status == "invalid"
    assert any("private_key_pem" in issue.message for issue in secret_issues)
    assert all("MIIEvQIBADANBg" not in issue.message for issue in secret_issues)
