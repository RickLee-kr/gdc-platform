"""Idempotent migration: encrypt plaintext auth_json secrets at rest.

Safe to run repeatedly. Skips rows that already have only encrypted (or empty)
secret fields. Does not overwrite a row when encryption fails mid-row.

Usage (from repo root / app container)::

    python -m app.security.migrate_encrypt_auth_json

Or call :func:`migrate_encrypt_auth_json_secrets` from an operator notebook /
maintenance session with an open SQLAlchemy ``Session``.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from app.security.auth_json_crypto import (
    auth_json_for_storage,
    contains_plaintext_secrets,
)
from app.security.encryption import EncryptionError, EncryptionKeyError

logger = logging.getLogger(__name__)


def migrate_encrypt_auth_json_secrets(db: Session) -> dict[str, Any]:
    """Encrypt plaintext secrets on ``credentials`` and ``sources`` auth_json.

    Returns counts for observability. Each successful row is flushed independently
    so a later failure does not roll back earlier encrypted rows when the caller
    commits periodically (caller controls commit).
    """

    from app.credentials.models import Credential
    from app.sources.models import Source

    summary: dict[str, Any] = {
        "credentials_scanned": 0,
        "credentials_updated": 0,
        "credentials_skipped": 0,
        "credentials_failed": 0,
        "sources_scanned": 0,
        "sources_updated": 0,
        "sources_skipped": 0,
        "sources_failed": 0,
        "errors": [],
    }

    # Commit per successful row so partial failures do not undo earlier work.
    credentials = db.query(Credential).order_by(Credential.id.asc()).all()
    for row in credentials:
        summary["credentials_scanned"] += 1
        try:
            raw = dict(row.auth_json or {})
            if not contains_plaintext_secrets(raw):
                summary["credentials_skipped"] += 1
                continue
            encrypted = auth_json_for_storage(raw)
            if contains_plaintext_secrets(encrypted):
                raise EncryptionError("encryption left plaintext secrets behind")
            row.auth_json = encrypted
            db.commit()
            summary["credentials_updated"] += 1
        except (EncryptionError, EncryptionKeyError) as exc:
            db.rollback()
            summary["credentials_failed"] += 1
            summary["errors"].append({"table": "credentials", "id": int(row.id), "error": str(exc)})
            logger.warning(
                "migrate_encrypt_credential_failed",
                extra={"credential_id": int(row.id), "error": str(exc)},
            )

    sources = db.query(Source).order_by(Source.id.asc()).all()
    for row in sources:
        summary["sources_scanned"] += 1
        try:
            raw = dict(row.auth_json or {})
            if not contains_plaintext_secrets(raw):
                summary["sources_skipped"] += 1
                continue
            encrypted = auth_json_for_storage(raw)
            if contains_plaintext_secrets(encrypted):
                raise EncryptionError("encryption left plaintext secrets behind")
            row.auth_json = encrypted
            db.commit()
            summary["sources_updated"] += 1
        except (EncryptionError, EncryptionKeyError) as exc:
            db.rollback()
            summary["sources_failed"] += 1
            summary["errors"].append({"table": "sources", "id": int(row.id), "error": str(exc)})
            logger.warning(
                "migrate_encrypt_source_failed",
                extra={"source_id": int(row.id), "error": str(exc)},
            )

    return summary


def main() -> int:
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        summary = migrate_encrypt_auth_json_secrets(db)
        print(summary)
        if summary["credentials_failed"] or summary["sources_failed"]:
            return 2
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
