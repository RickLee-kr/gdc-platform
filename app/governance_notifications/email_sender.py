"""SMTP abstraction for governance notifications (M20.2).

No real SMTP server dependency — mock-friendly interface for tests and MVP.
"""

from __future__ import annotations

from typing import Protocol


class EmailSender(Protocol):
    def send_email(self, *, recipients: list[str], subject: str, body: str) -> bool:
        """Deliver email; return True on success."""


class MockEmailSender:
    """In-memory email sender for MVP and unit tests."""

    def __init__(self) -> None:
        self.sent: list[dict[str, object]] = []
        self.should_fail = False

    def send_email(self, *, recipients: list[str], subject: str, body: str) -> bool:
        if self.should_fail:
            return False
        self.sent.append(
            {
                "recipients": list(recipients),
                "subject": subject,
                "body": body,
            }
        )
        return True


_default_email_sender = MockEmailSender()


def get_email_sender() -> EmailSender:
    return _default_email_sender


def set_email_sender(sender: EmailSender) -> None:
    global _default_email_sender
    _default_email_sender = sender


def reset_email_sender() -> None:
    global _default_email_sender
    _default_email_sender = MockEmailSender()
