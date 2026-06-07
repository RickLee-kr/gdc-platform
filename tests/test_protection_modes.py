"""M6 protection modes — unit tests."""

from __future__ import annotations

import pytest

from app.protection.modes import (
    apply_protection_mode,
    full_mask_value,
    hash_mask_value,
    partial_mask_value,
)
from app.protection.models import PROTECTION_MODE_FULL_MASK, PROTECTION_MODE_HASH, PROTECTION_MODE_PARTIAL_MASK

_KEY = b"test-salt-key"


def test_full_mask_string() -> None:
    assert full_mask_value("secret-token") == "********"


def test_full_mask_number_and_bool() -> None:
    assert full_mask_value(42) is None
    assert full_mask_value(True) is False


def test_full_mask_object_and_array() -> None:
    assert full_mask_value({"a": 1}) == {}
    assert full_mask_value([1, 2]) == []


def test_partial_mask_email() -> None:
    assert partial_mask_value("alice@example.com") == "a***@e***.com"


def test_partial_mask_phone() -> None:
    assert partial_mask_value("+1-555-123-4567") == "***4567"


def test_partial_mask_generic() -> None:
    assert partial_mask_value("abcdefghij") == "*******ghij"


def test_partial_mask_non_string_fallback() -> None:
    assert partial_mask_value(99) is None


def test_hash_deterministic() -> None:
    a = hash_mask_value("same", stream_id=7, hmac_key=_KEY)
    b = hash_mask_value("same", stream_id=7, hmac_key=_KEY)
    assert a == b
    assert str(a).startswith("sha256:")
    assert len(str(a)) == len("sha256:") + 64


def test_hash_differs_by_value() -> None:
    a = hash_mask_value("a", stream_id=1, hmac_key=_KEY)
    b = hash_mask_value("b", stream_id=1, hmac_key=_KEY)
    assert a != b


def test_apply_protection_mode_unknown() -> None:
    with pytest.raises(ValueError):
        apply_protection_mode("x", "nope", stream_id=1, hmac_key=_KEY)
