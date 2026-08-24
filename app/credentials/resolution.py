"""Resolve Source auth payload: credential_id preferred, legacy auth_json fallback."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.credentials.models import CREDENTIAL_STATUS_CONNECTED, Credential
from app.credentials.oauth2_auth_code import (
    OAuth2AuthCodeError,
    ensure_fresh_oauth2_authorization_code_credential,
    is_oauth2_authorization_code,
)
from app.sources.models import Source


class CredentialAuthResolutionError(ValueError):
    """Raised when a Source.credential_id cannot be used for runtime auth."""


def resolve_source_auth_json(db: Session, source: Source) -> dict[str, Any]:
    """Return the auth dict used by runtime pollers / stream loading.

    Prefer ``Source.credential_id`` when set; otherwise fall back to legacy
    ``Source.auth_json`` so existing streams keep working.

    For ``OAUTH2_AUTHORIZATION_CODE``, ensures a usable access token (refresh +
    persist under a row lock when expired) before returning.
    """

    credential_id = getattr(source, "credential_id", None)
    if credential_id is None:
        return dict(source.auth_json or {})

    row = db.query(Credential).filter(Credential.id == int(credential_id)).first()
    if row is None:
        raise CredentialAuthResolutionError(f"credential not found: {credential_id}")
    if int(row.connector_id) != int(source.connector_id):
        raise CredentialAuthResolutionError(
            f"credential {int(credential_id)} connector mismatch for source {int(source.id)}"
        )

    if is_oauth2_authorization_code(row.auth_type):
        try:
            return ensure_fresh_oauth2_authorization_code_credential(int(row.id))
        except OAuth2AuthCodeError as exc:
            raise CredentialAuthResolutionError(str(exc)) from exc

    status = str(row.status or "").strip().upper()
    if status != CREDENTIAL_STATUS_CONNECTED:
        raise CredentialAuthResolutionError(
            f"credential {int(credential_id)} status is {status or 'UNKNOWN'}; expected CONNECTED"
        )
    auth = dict(row.auth_json or {})
    if "auth_type" not in auth and row.auth_type:
        auth["auth_type"] = str(row.auth_type).lower()
    return auth
