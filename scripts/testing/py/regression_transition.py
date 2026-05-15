"""Detect coarse PASS/FAIL transition labels for watch mode (stdlib only)."""

from __future__ import annotations


def overall_status_from_counts(*, failed: int, tests: int, error: str | None) -> str:
    if error or tests == 0:
        return "FAIL"
    return "PASS" if failed == 0 else "FAIL"


def describe_transition(prev: str, curr: str) -> str | None:
    prev_n = prev.strip().upper()
    curr_n = curr.strip().upper()
    if prev_n not in {"PASS", "FAIL"} or curr_n not in {"PASS", "FAIL"}:
        return None
    if prev_n == curr_n:
        return None
    if prev_n == "PASS" and curr_n == "FAIL":
        return "REGRESSION: PASS → FAIL"
    return "RECOVERY: FAIL → PASS"
