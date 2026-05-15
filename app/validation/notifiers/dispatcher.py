"""Fire-and-forget HTTP notification dispatch with retry/backoff (never raises to caller)."""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

import httpx

from app.config import settings
from app.security.secrets import mask_secrets
from app.validation.alerts import HTTP_NOTIFY_TIMEOUT_SEC, NOTIFICATION_BACKOFF_SEC
from app.validation.notifiers import pagerduty, slack, webhook
from app.validation.notifiers.base import mask_url_for_log

logger = logging.getLogger(__name__)

PAGERDUTY_EVENTS_URL = "https://events.pagerduty.com/v2/enqueue"


def _post_with_retries(url: str, json_body: dict[str, Any]) -> None:
    masked = mask_url_for_log(url)
    safe_body = mask_secrets(json_body)
    last_exc: Exception | None = None
    for attempt, delay in enumerate([0.0, *NOTIFICATION_BACKOFF_SEC]):
        if delay:
            time.sleep(delay)
        try:
            with httpx.Client(timeout=HTTP_NOTIFY_TIMEOUT_SEC) as client:
                r = client.post(url, json=json_body, headers={"Content-Type": "application/json"})
                if r.status_code >= 400:
                    logger.warning(
                        "%s",
                        {
                            "stage": "validation_notify_http_error",
                            "url": masked,
                            "status_code": r.status_code,
                            "attempt": attempt,
                        },
                    )
                    continue
                logger.info(
                    "%s",
                    {"stage": "validation_notify_delivered", "url": masked, "status_code": r.status_code},
                )
                return
        except Exception as exc:  # pragma: no cover - network variability
            last_exc = exc
            logger.warning(
                "%s",
                {
                    "stage": "validation_notify_transport_error",
                    "url": masked,
                    "attempt": attempt,
                    "error_type": type(exc).__name__,
                    "message": str(exc),
                },
            )
    if last_exc is not None:
        logger.error(
            "%s",
            {
                "stage": "validation_notify_exhausted",
                "url": masked,
                "error_type": type(last_exc).__name__,
                "message": str(last_exc),
            },
        )


def _split_urls(raw: str) -> list[str]:
    return [u.strip() for u in (raw or "").split(",") if u.strip()]


def dispatch_validation_notifications_sync(payload: dict[str, Any]) -> None:
    """Deliver to all configured channels (fail-open; logs only)."""

    body_generic = webhook.body_for_generic_webhook(payload)
    for u in _split_urls(settings.VALIDATION_ALERT_NOTIFY_GENERIC_URLS):
        _post_with_retries(u, body_generic)

    slack_body = slack.body_for_slack_webhook(payload)
    for u in _split_urls(settings.VALIDATION_ALERT_NOTIFY_SLACK_URLS):
        _post_with_retries(u, slack_body)

    for key in _split_urls(settings.VALIDATION_ALERT_NOTIFY_PAGERDUTY_ROUTING_KEYS):
        pd_body = pagerduty.body_for_pagerduty_v2(routing_key=key, payload=payload)
        _post_with_retries(PAGERDUTY_EVENTS_URL, pd_body)


def schedule_validation_notifications(payload: dict[str, Any]) -> None:
    """Run HTTP notifications off-thread so validation never blocks on I/O."""

    def _run() -> None:
        try:
            dispatch_validation_notifications_sync(payload)
        except Exception as exc:  # pragma: no cover
            logger.error(
                "%s",
                {
                    "stage": "validation_notify_unexpected_error",
                    "error_type": type(exc).__name__,
                    "message": str(exc),
                },
            )

    t = threading.Thread(target=_run, name="validation-notifications", daemon=True)
    t.start()
