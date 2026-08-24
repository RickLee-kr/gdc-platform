"""Credential CRUD helpers."""

from __future__ import annotations

from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.connectors.auth.registry import AuthStrategyRegistry
from app.connectors.models import Connector
from app.credentials.models import (
    CREDENTIAL_STATUS_CONNECTED,
    CREDENTIAL_STATUSES,
    Credential,
)
from app.credentials.schemas import CredentialCreate, CredentialUpdate
from app.security.auth_json_crypto import auth_json_for_runtime, auth_json_for_storage
from app.security.secrets import mask_secrets, preserve_masked_secrets
from app.sources.models import Source

SUPPORTED_AUTH_TYPES: frozenset[str] = frozenset(
    {
        "NO_AUTH",
        "BASIC",
        "BEARER",
        "API_KEY",
        "OAUTH2_CLIENT_CREDENTIALS",
        "OAUTH2_AUTHORIZATION_CODE",
        "SESSION_LOGIN",
        "JWT_REFRESH_TOKEN",
        "VENDOR_JWT_EXCHANGE",
    }
)


def normalize_auth_type(auth_type: str | None) -> str:
    key = str(auth_type or "").strip().upper()
    if not key:
        raise ValueError("auth_type is required")
    if key not in SUPPORTED_AUTH_TYPES:
        raise ValueError(f"unsupported auth_type: {auth_type}")
    # Registry must already know this type (keeps credential surface aligned with runtime).
    AuthStrategyRegistry.get(key)
    return key


def normalize_status(status: str | None, *, default: str = CREDENTIAL_STATUS_CONNECTED) -> str:
    value = str(status or default).strip().upper() or default
    if value not in CREDENTIAL_STATUSES:
        raise ValueError(f"unsupported credential status: {status}")
    return value


def serialize_credential_read(row: Credential) -> dict[str, Any]:
    # Mask without decrypting envelopes so ciphertext never reaches API clients.
    return {
        "id": int(row.id),
        "connector_id": int(row.connector_id),
        "name": str(row.name),
        "auth_type": str(row.auth_type),
        "auth_json": mask_secrets(dict(row.auth_json or {})),
        "status": str(row.status),
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def get_credential_by_id(db: Session, credential_id: int) -> Credential | None:
    return db.query(Credential).filter(Credential.id == int(credential_id)).first()


def create_credential(db: Session, payload: CredentialCreate) -> Credential:
    connector = db.query(Connector).filter(Connector.id == int(payload.connector_id)).first()
    if connector is None:
        raise LookupError(f"connector not found: {payload.connector_id}")
    auth_type = normalize_auth_type(payload.auth_type)
    auth_json = dict(payload.auth_json or {})
    if "auth_type" not in auth_json:
        auth_json["auth_type"] = auth_type.lower()
    status = normalize_status(payload.status)
    # Authorization-code credentials are not usable until callback exchange succeeds.
    if auth_type == "OAUTH2_AUTHORIZATION_CODE" and not str(auth_json.get("access_token") or "").strip():
        if payload.status is None or str(payload.status).strip() == "":
            status = "NEEDS_RECONNECT"
        elif status == CREDENTIAL_STATUS_CONNECTED:
            status = "NEEDS_RECONNECT"
    name = str(payload.name or "").strip()
    if not name:
        raise ValueError("name is required")
    row = Credential(
        connector_id=int(payload.connector_id),
        name=name,
        auth_type=auth_type,
        auth_json=auth_json_for_storage(auth_json),
        status=status,
    )
    db.add(row)
    db.flush()
    return row


def update_credential(db: Session, row: Credential, payload: CredentialUpdate) -> Credential:
    data = payload.model_dump(exclude_unset=True)
    if "connector_id" in data and data["connector_id"] is not None:
        new_connector_id = int(data["connector_id"])
        if new_connector_id != int(row.connector_id):
            connector = db.query(Connector).filter(Connector.id == new_connector_id).first()
            if connector is None:
                raise LookupError(f"connector not found: {new_connector_id}")
            # Reuse is connector-scoped; refuse moving a credential that sources still reference
            # onto another connector while references exist.
            referenced = (
                db.query(Source.id).filter(Source.credential_id == int(row.id)).limit(1).first() is not None
            )
            if referenced:
                raise ValueError("cannot change connector_id while sources reference this credential")
            row.connector_id = new_connector_id
    if "name" in data and data["name"] is not None:
        name = str(data["name"]).strip()
        if not name:
            raise ValueError("name is required")
        row.name = name
    if "auth_type" in data and data["auth_type"] is not None:
        row.auth_type = normalize_auth_type(data["auth_type"])
    if "status" in data and data["status"] is not None:
        row.status = normalize_status(data["status"])
    if "auth_json" in data and data["auth_json"] is not None:
        # Preserve masked fields against stored envelopes (or legacy plaintext).
        merged = preserve_masked_secrets(dict(data["auth_json"]), dict(row.auth_json or {}))
        if "auth_type" not in merged and row.auth_type:
            merged["auth_type"] = str(row.auth_type).lower()
        row.auth_json = auth_json_for_storage(merged)
    db.flush()
    return row


def load_credential_auth_json(row: Credential) -> dict[str, Any]:
    """Decrypt credential auth_json for runtime use (legacy plaintext accepted)."""

    auth = auth_json_for_runtime(dict(row.auth_json or {}))
    if "auth_type" not in auth and row.auth_type:
        auth["auth_type"] = str(row.auth_type).lower()
    return auth


def delete_credential(db: Session, row: Credential) -> None:
    """Delete credential; RESTRICT when sources still reference it."""

    referenced = db.query(Source.id).filter(Source.credential_id == int(row.id)).limit(1).first()
    if referenced is not None:
        raise ValueError(
            f"credential {int(row.id)} is referenced by one or more sources; "
            "clear Source.credential_id before delete"
        )
    try:
        db.delete(row)
        db.flush()
    except IntegrityError as exc:
        raise ValueError(
            f"credential {int(row.id)} is referenced by one or more sources; "
            "clear Source.credential_id before delete"
        ) from exc


def validate_source_credential_ref(
    db: Session,
    *,
    source_connector_id: int,
    credential_id: int | None,
) -> Credential | None:
    """Ensure credential exists and is scoped to the source's connector."""

    if credential_id is None:
        return None
    row = get_credential_by_id(db, int(credential_id))
    if row is None:
        raise LookupError(f"credential not found: {credential_id}")
    if int(row.connector_id) != int(source_connector_id):
        raise ValueError(
            f"credential {credential_id} belongs to connector {int(row.connector_id)}, "
            f"not source connector {int(source_connector_id)}"
        )
    return row
