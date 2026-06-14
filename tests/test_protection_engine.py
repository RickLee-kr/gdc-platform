"""M6 protection engine — path walk and batch."""

from __future__ import annotations

import pytest

from app.protection.engine import apply_rule_to_event, parse_field_path_segments, protect_batch
from app.protection.models import (
    PROTECTION_MODE_FULL_MASK,
    PROTECTION_MODE_HASH,
    PROTECTION_MODE_PARTIAL_MASK,
    StreamProtectionRule,
)


class _Rule:
    def __init__(
        self,
        *,
        rule_id: int = 1,
        stream_id: int = 1,
        field_path: str,
        mode: str = PROTECTION_MODE_FULL_MASK,
    ) -> None:
        self.id = rule_id
        self.stream_id = stream_id
        self.field_path = field_path
        self.protection_mode = mode
        self.enabled = True


def test_parse_path_segments() -> None:
    assert parse_field_path_segments("$.user.email") == ["user", "email"]
    assert parse_field_path_segments("$.items[].id") == ["items", "[]", "id"]


def test_apply_nested_object(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.config.settings.GDC_PROTECTION_ENABLED", True)
    event = {"user": {"email": "alice@example.com"}}
    rule = _Rule(field_path="$.user.email", mode=PROTECTION_MODE_PARTIAL_MASK)
    count, warn = apply_rule_to_event(event, rule)
    assert warn is None
    assert count == 1
    assert event["user"]["email"] == "a***@e***.com"


def test_apply_array_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.config.settings.GDC_PROTECTION_ENABLED", True)
    event = {"items": [{"token": "abc"}, {"token": "def"}]}
    rule = _Rule(field_path="$.items[].token")
    count, _ = apply_rule_to_event(event, rule)
    assert count == 2
    assert event["items"][0]["token"] == "********"


def test_protect_batch_disabled_flag_passthrough(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.config.settings.GDC_PROTECTION_ENABLED", False)
    original = {"password": "plain"}
    rules = [
        StreamProtectionRule(
            stream_id=1,
            field_path="$.password",
            sensitivity_class="secret",
            protection_mode=PROTECTION_MODE_FULL_MASK,
            enabled=True,
            created_by="test",
        )
    ]
    rules[0].id = 1
    result = protect_batch([original], rules, stream_id=1)
    assert result.events[0]["password"] == "plain"


def test_protect_batch_ephemeral_rules_skip_persisted_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.config.settings.GDC_PROTECTION_ENABLED", True)
    from app.protection.ephemeral import EphemeralProtectionRule

    original = {"email": "user@test.com", "token": "abc"}
    persisted = StreamProtectionRule(
        stream_id=1,
        field_path="$.email",
        sensitivity_class="pii",
        protection_mode=PROTECTION_MODE_HASH,
        enabled=True,
        created_by="operator",
    )
    persisted.id = 1
    ephemeral = [
        EphemeralProtectionRule(
            stream_id=1,
            field_path="$.email",
            protection_mode=PROTECTION_MODE_PARTIAL_MASK,
        ),
        EphemeralProtectionRule(
            stream_id=1,
            field_path="$.token",
            protection_mode=PROTECTION_MODE_FULL_MASK,
        ),
    ]
    result = protect_batch([original], [persisted], stream_id=1, ephemeral_rules=ephemeral)
    event = result.events[0]
    assert event["email"].startswith("sha256:")
    assert event["token"] == "********"


def test_protect_batch_does_not_mutate_input(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.config.settings.GDC_PROTECTION_ENABLED", True)
    original = {"password": "plain"}
    rules = [
        StreamProtectionRule(
            stream_id=1,
            field_path="$.password",
            sensitivity_class="secret",
            protection_mode=PROTECTION_MODE_FULL_MASK,
            enabled=True,
            created_by="test",
        )
    ]
    rules[0].id = 1
    rules[0].stream_id = 1
    result = protect_batch([original], rules, stream_id=1)
    assert original["password"] == "plain"
    assert result.events[0]["password"] == "********"
