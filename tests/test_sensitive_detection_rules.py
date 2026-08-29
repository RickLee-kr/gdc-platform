"""M5 sensitive detection — field-name rules and false-positive policy."""

from __future__ import annotations

import pytest

from app.sensitive_detection.path_rules import evaluate_field_name_rules, leaf_segment
from app.sensitive_detection.pattern_rules import evaluate_pattern_rules


def test_leaf_segment_strips_array_markers() -> None:
    assert leaf_segment("$.items[].password") == "password"


def test_fp1_standalone_id_no_match() -> None:
    assert evaluate_field_name_rules("$.id") == []
    assert evaluate_field_name_rules("$.uuid") == []


def test_fp2_user_id_no_secret() -> None:
    assert evaluate_field_name_rules("$.user_id") == []


def test_fp4_session_token_no_secret() -> None:
    assert evaluate_field_name_rules("$.session_token") == []


def test_fp4_access_token_tier_a() -> None:
    hits = evaluate_field_name_rules("$.access_token")
    assert any(h["sensitivity_class"] == "secret" for h in hits)


def test_fp6_cookie_count_no_match() -> None:
    assert evaluate_field_name_rules("$.cookie_count") == []


def test_fp6_cookie_exact_secret() -> None:
    hits = evaluate_field_name_rules("$.cookie")
    assert any(h["sensitivity_class"] == "secret" for h in hits)


def test_fp7_user_alone_no_pii() -> None:
    assert evaluate_field_name_rules("$.user") == []


def test_pii_compound_user_email() -> None:
    hits = evaluate_field_name_rules("$.user_email")
    assert any(h["sensitivity_class"] == "pii" for h in hits)


def test_security_metadata_auth_exact() -> None:
    hits = evaluate_field_name_rules("$.auth")
    assert any(h["sensitivity_class"] == "security_metadata" for h in hits)


def test_security_metadata_author_no_match() -> None:
    assert evaluate_field_name_rules("$.author") == []


def test_secret_tier_b_apikey_substring() -> None:
    hits = evaluate_field_name_rules("$.vendor_apikey")
    assert any(h["sensitivity_class"] == "secret" for h in hits)


def test_pattern_pem_secret() -> None:
    pem = "-----BEGIN RSA PRIVATE KEY-----\nX\n-----END RSA PRIVATE KEY-----"
    hit = evaluate_pattern_rules("$.tls_key_pem", inferred_type="string", sample_value=pem)
    assert hit is not None
    assert hit["sensitivity_class"] == "secret"
    assert hit["matched_rule"] == "pattern.pem"


def test_pattern_email_requires_pii_leaf() -> None:
    hit = evaluate_pattern_rules(
        "$.user_id",
        inferred_type="string",
        sample_value="user@example.com",
    )
    assert hit is None


def test_pattern_email_on_email_leaf() -> None:
    hit = evaluate_pattern_rules(
        "$.email",
        inferred_type="string",
        sample_value="ops@example.com",
    )
    assert hit is not None
    assert hit["matched_rule"] == "pattern.email"


@pytest.mark.parametrize(
    "value",
    [
        "4111111111111111",
        "4111-1111-1111-1111",
        "4111 1111 1111 1111",
        "5555555555554444",
        "378282246310005",
    ],
)
def test_pattern_credit_card_valid_luhn(value: str) -> None:
    hit = evaluate_pattern_rules("$.payload.pan", inferred_type="string", sample_value=value)
    assert hit is not None
    assert hit["matched_rule"] == "pattern.credit_card"
    assert hit["pattern"] == "credit_card"


@pytest.mark.parametrize(
    "value",
    [
        "4111111111111112",  # fails Luhn
        "1234567890123",
        "1234",
        "41111111111111111111",  # 20 digits
        "not-a-card",
        "4111-1111-1111-111X",
    ],
)
def test_pattern_credit_card_invalid_or_near_match(value: str) -> None:
    assert evaluate_pattern_rules("$.payload.pan", inferred_type="string", sample_value=value) is None


def test_pattern_credit_card_blocked_on_id_leaf() -> None:
    assert (
        evaluate_pattern_rules(
            "$.id",
            inferred_type="string",
            sample_value="4111111111111111",
        )
        is None
    )


def test_pattern_ssn_dashed_valid_on_ssn_leaf() -> None:
    hit = evaluate_pattern_rules("$.ssn", inferred_type="string", sample_value="856-45-6789")
    assert hit is not None
    assert hit["matched_rule"] == "pattern.ssn"


@pytest.mark.parametrize(
    "value",
    [
        "000-12-3456",
        "666-12-3456",
        "123-00-4567",
        "123-45-0000",
        "111-11-1111",
        "123-45-6789",  # placeholder 123456789
        "078-05-1120",
    ],
)
def test_pattern_ssn_invalidated(value: str) -> None:
    assert evaluate_pattern_rules("$.ssn", inferred_type="string", sample_value=value) is None


def test_pattern_ssn_compact_on_ssn_leaf() -> None:
    hit = evaluate_pattern_rules("$.ssn", inferred_type="string", sample_value="856456789")
    assert hit is not None
    assert hit["pattern"] == "ssn"


def test_pattern_ssn_compact_not_on_order_id() -> None:
    assert (
        evaluate_pattern_rules(
            "$.order_number",
            inferred_type="string",
            sample_value="856456789",
        )
        is None
    )


def test_pattern_ssn_dashed_high_precision_on_non_ssn_leaf() -> None:
    hit = evaluate_pattern_rules("$.payload.ref", inferred_type="string", sample_value="856-45-6789")
    assert hit is not None
    assert hit["pattern"] == "ssn"


@pytest.mark.parametrize(
    "value,expect_hit",
    [
        ("ops@example.com", True),
        ("<ops@example.com>", True),
        ('"ops@example.com"', True),
        ("ops@example.com.", True),
        ("user@", False),
        ("@example.com", False),
        ("user@localhost", False),
        ("user name@example.com", False),
        ("not-an-email", False),
    ],
)
def test_pattern_email_quality(value: str, expect_hit: bool) -> None:
    hit = evaluate_pattern_rules("$.email", inferred_type="string", sample_value=value)
    if expect_hit:
        assert hit is not None
        assert hit["matched_rule"] == "pattern.email"
    else:
        assert hit is None


def test_pattern_pem_still_before_email() -> None:
    pem = "-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----"
    hit = evaluate_pattern_rules("$.email", inferred_type="string", sample_value=pem)
    assert hit is not None
    assert hit["matched_rule"] == "pattern.pem"


@pytest.mark.parametrize(
    "path,expected_class",
    [
        ("$.password", "secret"),
        ("$.roles", "security_metadata"),
        ("$.email_verified", "pii"),
        ("$.credit_card", "pii"),
        ("$.card_number", "pii"),
    ],
)
def test_field_name_classes(path: str, expected_class: str) -> None:
    hits = evaluate_field_name_rules(path)
    assert any(h["sensitivity_class"] == expected_class for h in hits)
