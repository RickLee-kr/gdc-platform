"""Value pattern rules for sensitive detection (PEM, credit card, SSN, IBAN, email).

Evaluation order in ``evaluate_pattern_rules`` (at most one hit per path):
PEM (secret) → credit card (Luhn) → SSN (invalidation) → IBAN (MOD-97)
→ email (PII-leaf gated).

Credit-card Luhn and US SSN invalidation are SOURCE_ADAPTATION of Microsoft
Presidio algorithms (MIT). This module does not import Presidio, spaCy, or
tldextract; it does not scan free-text spans.
"""

from __future__ import annotations

import re

from app.sensitive_detection.models import (
    DETECTION_METHOD_PATTERN,
    SENSITIVITY_CLASS_PII,
    SENSITIVITY_CLASS_SECRET,
)
from app.sensitive_detection.path_rules import (
    apply_false_positive_policy,
    leaf_allows_pattern_pii,
    leaf_allows_pattern_ssn,
    leaf_segment,
)

# ---------------------------------------------------------------------------
# Email (full-string after wrapper strip; PII-leaf gated — not free-text NER)
# ---------------------------------------------------------------------------

_EMAIL_RE = re.compile(
    r"^[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$"
)
_MAX_EMAIL_LEN = 320
_EMAIL_WRAPPER_PREFIX = frozenset("<\"'")
_EMAIL_WRAPPER_SUFFIX = frozenset(">\"'.,;")

# ---------------------------------------------------------------------------
# Credit card — Luhn adapted from Presidio CreditCardRecognizer (MIT)
# presidio-analyzer/.../generic/credit_card_recognizer.py __luhn_checksum
# Copyright (c) Presidio Contributors. Sanitize: strip '-' and spaces only.
# ---------------------------------------------------------------------------

_CREDIT_CARD_MIN_DIGITS = 13
_CREDIT_CARD_MAX_DIGITS = 19

# ---------------------------------------------------------------------------
# US SSN invalidation adapted from Presidio UsSsnRecognizer.invalidate_result
# (MIT) presidio-analyzer/.../country_specific/us/us_ssn_recognizer.py
# Copyright (c) Presidio Contributors. High-precision dashed form on
# non-SSN leaves; compact/alt delimiters only on SSN-related leaves.
# ---------------------------------------------------------------------------

_SSN_PLACEHOLDERS = frozenset({"123456789", "987654320", "078051120"})
_SSN_DASHED_RE = re.compile(r"^\d{3}-\d{2}-\d{4}$")
_SSN_SAME_DELIMITER_RE = re.compile(r"^\d{3}([ .\-])\d{2}\1\d{4}$")
_SSN_COMPACT_RE = re.compile(r"^\d{9}$")

# ---------------------------------------------------------------------------
# IBAN — ISO 13616 structure and MOD-97 checksum. Full-string only; spaces are
# removed before validation. Country-specific lengths are intentionally not
# enforced so valid allocations are not rejected as the registry evolves.
# ---------------------------------------------------------------------------

_IBAN_MIN_LENGTH = 15
_IBAN_MAX_LENGTH = 34


def pem_pattern_match(value: str) -> bool:
    return "-----BEGIN" in value and "-----END" in value


def _strip_email_wrappers(value: str) -> str:
    """Strip surrounding punctuation such as <email>, quotes, trailing . , ;"""

    text = value.strip()
    changed = True
    while changed and text:
        changed = False
        if text[0] in _EMAIL_WRAPPER_PREFIX:
            text = text[1:].lstrip()
            changed = True
            if not text:
                break
        if text[-1] in _EMAIL_WRAPPER_SUFFIX:
            text = text[:-1].rstrip()
            changed = True
    return text


def email_pattern_match(value: str) -> bool:
    if len(value) > _MAX_EMAIL_LEN:
        return False
    text = _strip_email_wrappers(value)
    if not text or len(text) > _MAX_EMAIL_LEN:
        return False
    if any(ch.isspace() for ch in text):
        return False
    if _EMAIL_RE.match(text) is None:
        return False
    local, _, domain = text.partition("@")
    if not local or not domain:
        return False
    if local.startswith(".") or local.endswith(".") or ".." in local:
        return False
    return True


def _sanitize_card_digits(value: str) -> str | None:
    text = value.strip()
    if not text:
        return None
    if not all(ch.isdigit() or ch in "- " for ch in text):
        return None
    sanitized = text.replace("-", "").replace(" ", "")
    if not sanitized.isdigit():
        return None
    if not (_CREDIT_CARD_MIN_DIGITS <= len(sanitized) <= _CREDIT_CARD_MAX_DIGITS):
        return None
    return sanitized


def luhn_checksum_valid(sanitized_digits: str) -> bool:
    """Return True when ``sanitized_digits`` passes the Luhn checksum.

    Adapted from Presidio ``CreditCardRecognizer.__luhn_checksum`` (MIT):
    odd digits from the right are summed; even digits are doubled and
    digit-summed; valid iff the total modulo 10 is 0.
    """

    digits = [int(d) for d in sanitized_digits]
    odd_digits = digits[-1::-2]
    even_digits = digits[-2::-2]
    checksum = sum(odd_digits)
    for d in even_digits:
        checksum += sum(int(x) for x in str(d * 2))
    return checksum % 10 == 0


def credit_card_pattern_match(value: str) -> bool:
    """Full-string PAN: 13–19 digits after dash/space sanitize, then Luhn."""

    sanitized = _sanitize_card_digits(value)
    if sanitized is None:
        return False
    return luhn_checksum_valid(sanitized)


def ssn_value_invalidated(pattern_text: str) -> bool:
    """Return True when the candidate cannot be a US SSN.

    Adapted from Presidio ``UsSsnRecognizer.invalidate_result`` (MIT):
    mixed delimiters, all-same digits, group 00 / serial 0000, area 000 or 666,
    and published placeholder SSNs.
    """

    delimiter_counts: dict[str, int] = {}
    for ch in pattern_text:
        if ch in (".", "-", " "):
            delimiter_counts[ch] = delimiter_counts.get(ch, 0) + 1
    if len(delimiter_counts) > 1:
        return True

    only_digits = "".join(ch for ch in pattern_text if ch.isdigit())
    if len(only_digits) != 9:
        return True
    if all(only_digits[0] == ch for ch in only_digits):
        return True
    if only_digits[3:5] == "00" or only_digits[5:] == "0000":
        return True
    if only_digits[:3] in ("000", "666"):
        return True
    if only_digits in _SSN_PLACEHOLDERS:
        return True
    return False


def ssn_pattern_match(value: str, *, ssn_like_leaf: bool) -> bool:
    """Match SSN values after invalidation.

    SSN-related leaves may use dashed, same-delimiter, or compact 9-digit forms.
    Other leaves accept only high-precision dashed ``AAA-GG-SSSS`` (never every
    9-digit string). Invalidated values never hit.
    """

    text = value.strip()
    if not text:
        return False
    if ssn_like_leaf:
        if (
            _SSN_DASHED_RE.fullmatch(text) is None
            and _SSN_SAME_DELIMITER_RE.fullmatch(text) is None
            and _SSN_COMPACT_RE.fullmatch(text) is None
        ):
            return False
        return not ssn_value_invalidated(text)
    if _SSN_DASHED_RE.fullmatch(text) is None:
        return False
    return not ssn_value_invalidated(text)


def _normalize_iban(value: str) -> str | None:
    normalized = value.replace(" ", "").upper()
    if not (_IBAN_MIN_LENGTH <= len(normalized) <= _IBAN_MAX_LENGTH):
        return None
    if not normalized.isascii() or not normalized.isalnum():
        return None
    if not normalized[:2].isalpha() or not normalized[2:4].isdigit():
        return None
    return normalized


def iban_pattern_match(value: str) -> bool:
    """Return True for a full ISO 13616 IBAN candidate with MOD-97 == 1."""

    normalized = _normalize_iban(value)
    if normalized is None:
        return False

    rearranged = normalized[4:] + normalized[:4]
    remainder = 0
    for char in rearranged:
        digits = char if char.isdigit() else str(ord(char) - ord("A") + 10)
        for digit in digits:
            remainder = (remainder * 10 + int(digit)) % 97
    return remainder == 1


def _pii_pattern_hit(*, rule: str, leaf: str, pattern: str) -> dict[str, str]:
    return {
        "sensitivity_class": SENSITIVITY_CLASS_PII,
        "detection_method": DETECTION_METHOD_PATTERN,
        "matched_rule": rule,
        "matched_segment": leaf or "value",
        "pattern": pattern,
    }


def evaluate_pattern_rules(
    field_path: str,
    *,
    inferred_type: str,
    sample_value: str | None,
) -> dict[str, str] | None:
    """At most one hit per path (PEM → credit card → SSN → IBAN → email)."""

    if inferred_type != "string" or not sample_value:
        return None
    leaf = leaf_segment(field_path)

    if pem_pattern_match(sample_value):
        if apply_false_positive_policy(leaf, sensitivity_class=SENSITIVITY_CLASS_SECRET, tier="tier_b"):
            return {
                "sensitivity_class": SENSITIVITY_CLASS_SECRET,
                "detection_method": DETECTION_METHOD_PATTERN,
                "matched_rule": "pattern.pem",
                "matched_segment": leaf or "value",
                "pattern": "pem",
            }

    if credit_card_pattern_match(sample_value):
        # Value-pattern PAN may fire on non-PII leaves (e.g. $.payload.pan).
        # FP1/FP2/FP3 still block id / *_id / metric leaves.
        if apply_false_positive_policy(leaf, sensitivity_class=SENSITIVITY_CLASS_PII, tier="tier_b"):
            return _pii_pattern_hit(rule="pattern.credit_card", leaf=leaf, pattern="credit_card")

    ssn_like = leaf_allows_pattern_ssn(leaf)
    if ssn_pattern_match(sample_value, ssn_like_leaf=ssn_like):
        if ssn_like:
            if apply_false_positive_policy(leaf, sensitivity_class=SENSITIVITY_CLASS_PII, tier="tier_a"):
                return _pii_pattern_hit(rule="pattern.ssn", leaf=leaf, pattern="ssn")
        elif apply_false_positive_policy(leaf, sensitivity_class=SENSITIVITY_CLASS_PII, tier="tier_b"):
            return _pii_pattern_hit(rule="pattern.ssn", leaf=leaf, pattern="ssn")

    if iban_pattern_match(sample_value):
        # Checksum-valid IBANs are high precision and may occur outside a named
        # account leaf. Existing tier-B policy still blocks id/user/metric leaves.
        if apply_false_positive_policy(leaf, sensitivity_class=SENSITIVITY_CLASS_PII, tier="tier_b"):
            return _pii_pattern_hit(rule="pattern.iban", leaf=leaf, pattern="iban")

    if email_pattern_match(sample_value):
        if not leaf_allows_pattern_pii(leaf):
            return None
        if apply_false_positive_policy(leaf, sensitivity_class=SENSITIVITY_CLASS_PII, tier="tier_b"):
            return _pii_pattern_hit(rule="pattern.email", leaf=leaf, pattern="email")

    return None
