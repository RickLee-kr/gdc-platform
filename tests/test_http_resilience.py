"""Unit tests for shared HTTP ResponseClassifier + RetryPolicy."""

from __future__ import annotations

import random

import httpx
import pytest

from app.http.resilience import (
    ClassificationResult,
    HttpOutcome,
    ResponseClassifier,
    RetryPolicy,
    parse_retry_after_header,
)


def _response(status: int, *, headers: dict[str, str] | None = None) -> httpx.Response:
    req = httpx.Request("GET", "https://example.test/x")
    return httpx.Response(status, request=req, headers=headers or {})


@pytest.fixture
def classifier() -> ResponseClassifier:
    return ResponseClassifier()


@pytest.mark.parametrize(
    ("status", "outcome"),
    [
        (200, HttpOutcome.SUCCESS),
        (204, HttpOutcome.SUCCESS),
        (408, HttpOutcome.RETRY),
        (429, HttpOutcome.RATE_LIMIT),
        (500, HttpOutcome.RETRY),
        (502, HttpOutcome.RETRY),
        (503, HttpOutcome.RETRY),
        (400, HttpOutcome.FATAL),
        (401, HttpOutcome.FATAL),
        (403, HttpOutcome.FATAL),
        (404, HttpOutcome.FATAL),
    ],
)
def test_classify_response_status_matrix(
    classifier: ResponseClassifier, status: int, outcome: HttpOutcome
) -> None:
    result = classifier.classify_response(_response(status))
    assert result.outcome == outcome
    assert result.status_code == status


def test_classify_429_captures_retry_after(classifier: ResponseClassifier) -> None:
    result = classifier.classify_response(_response(429, headers={"Retry-After": "7"}))
    assert result.outcome == HttpOutcome.RATE_LIMIT
    assert result.retry_after_seconds == 7.0


def test_classify_429_invalid_retry_after_falls_back(classifier: ResponseClassifier) -> None:
    result = classifier.classify_response(_response(429, headers={"Retry-After": "Fri, 31 Dec 1999"}))
    assert result.outcome == HttpOutcome.RATE_LIMIT
    assert result.retry_after_seconds is None


@pytest.mark.parametrize(
    "exc",
    [
        httpx.ConnectTimeout("connect timed out"),
        httpx.ReadTimeout("read timed out"),
        httpx.ConnectError("connection refused"),
        ConnectionError("boom"),
        TimeoutError("timed out"),
    ],
)
def test_classify_transport_errors_are_retry(classifier: ResponseClassifier, exc: Exception) -> None:
    assert classifier.classify_exception(exc).outcome == HttpOutcome.RETRY


def test_parse_retry_after_header() -> None:
    assert parse_retry_after_header("3") == 3.0
    assert parse_retry_after_header(" 1.5 ") == 1.5
    assert parse_retry_after_header(None) is None
    assert parse_retry_after_header("not-a-number") is None
    assert parse_retry_after_header("-1") is None


def test_retry_policy_prefers_retry_after() -> None:
    policy = RetryPolicy(max_attempts=3, initial_backoff_seconds=1.0)
    classified = ClassificationResult(
        outcome=HttpOutcome.RATE_LIMIT,
        status_code=429,
        retry_after_seconds=12.0,
    )
    assert policy.delay_seconds(attempt=1, classification=classified) == 12.0


def test_retry_policy_exponential_backoff_without_jitter() -> None:
    policy = RetryPolicy(max_attempts=4, initial_backoff_seconds=1.0, jitter_ratio=0.0)
    retry = ClassificationResult(outcome=HttpOutcome.RETRY, status_code=503)
    assert policy.delay_seconds(attempt=1, classification=retry) == 1.0
    assert policy.delay_seconds(attempt=2, classification=retry) == 2.0
    assert policy.delay_seconds(attempt=3, classification=retry) == 4.0


def test_retry_policy_jitter_is_bounded() -> None:
    rng = random.Random(0)
    policy = RetryPolicy(max_attempts=3, initial_backoff_seconds=10.0, jitter_ratio=1.0, rng=rng)
    retry = ClassificationResult(outcome=HttpOutcome.RETRY)
    delay = policy.delay_seconds(attempt=1, classification=retry)
    assert 0.0 <= delay <= 10.0


def test_retry_policy_attempt_limit() -> None:
    policy = RetryPolicy(max_attempts=3)
    assert policy.should_continue(1) is True
    assert policy.should_continue(2) is True
    assert policy.should_continue(3) is False
