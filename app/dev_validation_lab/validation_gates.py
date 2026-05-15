"""Gate which seeded ``dev_lab_*`` continuous validations may run (feature flags)."""

from __future__ import annotations

from app.config import settings
from app.dev_validation_lab import templates as T
from app.validation.models import ContinuousValidation


def lab_validation_should_execute(row: ContinuousValidation) -> bool:
    """Return False when a lab slice flag is off for this template_key; non-lab rows always True."""

    tk = str(row.template_key or "").strip()
    if not tk.startswith(T.LAB_TEMPLATE_KEY_PREFIX):
        return True
    if tk == T.TK_S3_OBJECT_POLLING:
        return bool(getattr(settings, "ENABLE_DEV_VALIDATION_S3", False))
    if tk in {T.TK_DB_QUERY_PG, T.TK_DB_QUERY_MYSQL, T.TK_DB_QUERY_MARIADB}:
        return bool(getattr(settings, "ENABLE_DEV_VALIDATION_DATABASE_QUERY", False))
    if tk in {T.TK_REMOTE_SFTP, T.TK_REMOTE_SCP}:
        return bool(getattr(settings, "ENABLE_DEV_VALIDATION_REMOTE_FILE", False))
    return True
