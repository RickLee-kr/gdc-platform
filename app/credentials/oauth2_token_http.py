"""OAuth2 token-endpoint HTTP with shared resilience classification.

Protocol 4xx (including ``invalid_grant``) is FATAL — never retried.
Transient transport / 5xx / 429 follow ``RetryPolicy``.
"""

from __future__ import annotations

import logging
import time
from typing import Any
from urllib.parse import urlencode

import httpx

from app.http.resilience import HttpOutcome, ResponseClassifier, RetryPolicy
from app.security.secrets import mask_secrets

logger = logging.getLogger(__name__)

_CLASSIFIER = ResponseClassifier()


class OAuth2ProtocolError(Exception):
    """OAuth2 token endpoint returned a non-retryable protocol failure."""

    def __init__(
        self,
        message: str,
        *,
        error: str | None = None,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.error = (error or "").strip().lower() or None
        self.status_code = status_code

    @property
    def is_invalid_grant(self) -> bool:
        return self.error == "invalid_grant"


class OAuth2TransportError(Exception):
    """Token endpoint failed after retries (transient transport / 5xx exhausted)."""


def _safe_error_body(response: httpx.Response) -> dict[str, Any]:
    try:
        body = response.json()
    except Exception:
        return {}
    if not isinstance(body, dict):
        return {}
    # Never propagate raw tokens if a misbehaving AS echoes them.
    return mask_secrets(body)


def post_oauth2_token(
    token_url: str,
    form: dict[str, str],
    *,
    client_id: str,
    client_secret: str,
    verify_ssl: bool = True,
    proxy_url: str | None = None,
    timeout_seconds: float = 30.0,
    max_attempts: int = 3,
    initial_backoff_seconds: float = 0.5,
) -> dict[str, Any]:
    """POST ``application/x-www-form-urlencoded`` to the token URL (HTTP Basic client auth)."""

    policy = RetryPolicy(max_attempts=max_attempts, initial_backoff_seconds=initial_backoff_seconds)
    last_error: Exception | None = None
    # Drop secrets from loggable form copy.
    log_form = {k: ("********" if k in {"code", "refresh_token", "client_secret", "code_verifier"} else v) for k, v in form.items()}

    with httpx.Client(verify=verify_ssl, proxy=proxy_url, timeout=timeout_seconds) as client:
        for attempt in range(1, policy.max_attempts + 1):
            try:
                response = client.post(
                    token_url,
                    data=urlencode(form),
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    auth=(client_id, client_secret),
                )
            except httpx.HTTPError as exc:
                classified = _CLASSIFIER.classify_exception(exc)
                last_error = exc
                logger.info(
                    "oauth2_token_transport_error",
                    extra={"attempt": attempt, "reason": classified.reason, "form_keys": sorted(log_form.keys())},
                )
                if classified.outcome == HttpOutcome.FATAL or not policy.should_continue(attempt):
                    raise OAuth2TransportError(f"oauth2 token request failed: {exc}") from exc
                time.sleep(max(policy.delay_seconds(attempt=attempt, classification=classified), 0))
                continue

            classified = _CLASSIFIER.classify_response(response)
            if classified.outcome == HttpOutcome.SUCCESS:
                try:
                    payload = response.json()
                except ValueError as exc:
                    raise OAuth2ProtocolError(
                        "oauth2 token response is not valid JSON",
                        status_code=int(response.status_code),
                    ) from exc
                if not isinstance(payload, dict):
                    raise OAuth2ProtocolError(
                        "oauth2 token response must be a JSON object",
                        status_code=int(response.status_code),
                    )
                return payload

            body = _safe_error_body(response)
            oauth_error = str(body.get("error") or "").strip().lower() or None
            if classified.outcome == HttpOutcome.FATAL:
                raise OAuth2ProtocolError(
                    f"oauth2 token endpoint rejected request (HTTP {response.status_code})",
                    error=oauth_error,
                    status_code=int(response.status_code),
                )

            last_error = OAuth2TransportError(
                f"oauth2 token endpoint HTTP {response.status_code}"
            )
            if not policy.should_continue(attempt):
                raise last_error
            time.sleep(max(policy.delay_seconds(attempt=attempt, classification=classified), 0))

    raise OAuth2TransportError(f"oauth2 token request failed after retries: {last_error}")
