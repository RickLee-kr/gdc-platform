"""Persistence helpers for platform admin tables."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.platform_admin.models import (
    PlatformAuditEvent,
    PlatformConfigVersion,
    ALERT_SETTINGS_ROW_ID,
    PlatformAlertSettings,
    PlatformHttpsConfig,
    PlatformRetentionPolicy,
    RETENTION_POLICY_ROW_ID,
    PlatformUser,
)


HTTPS_CONFIG_ROW_ID = 1


def get_https_config_row(db: Session) -> PlatformHttpsConfig:
    row = db.get(PlatformHttpsConfig, HTTPS_CONFIG_ROW_ID)
    if row is None:
        row = PlatformHttpsConfig(
            id=HTTPS_CONFIG_ROW_ID,
            enabled=False,
            certificate_ip_addresses=[],
            certificate_dns_names=[],
            redirect_http_to_https=False,
            certificate_valid_days=365,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def list_users(db: Session) -> list[PlatformUser]:
    return list(db.scalars(select(PlatformUser).order_by(PlatformUser.username.asc())))


def get_user_by_id(db: Session, user_id: int) -> PlatformUser | None:
    return db.get(PlatformUser, user_id)


def get_user_by_username(db: Session, username: str) -> PlatformUser | None:
    return db.scalars(select(PlatformUser).where(PlatformUser.username == username)).first()


def count_administrators(db: Session) -> int:
    n = db.scalar(
        select(func.count())
        .select_from(PlatformUser)
        .where(PlatformUser.role == "ADMINISTRATOR", PlatformUser.status == "ACTIVE")
    )
    return int(n or 0)


def get_retention_policy_row(db: Session) -> PlatformRetentionPolicy:
    row = db.get(PlatformRetentionPolicy, RETENTION_POLICY_ROW_ID)
    if row is None:
        row = PlatformRetentionPolicy(id=RETENTION_POLICY_ROW_ID)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def get_alert_settings_row(db: Session) -> PlatformAlertSettings:
    row = db.get(PlatformAlertSettings, ALERT_SETTINGS_ROW_ID)
    if row is None:
        row = PlatformAlertSettings(
            id=ALERT_SETTINGS_ROW_ID,
            rules_json=[
                {"alert_type": "stream_paused", "enabled": True, "severity": "WARNING", "last_triggered_at": None},
                {"alert_type": "checkpoint_stalled", "enabled": True, "severity": "CRITICAL", "last_triggered_at": None},
                {"alert_type": "destination_failed", "enabled": True, "severity": "CRITICAL", "last_triggered_at": None},
                {"alert_type": "high_retry_count", "enabled": False, "severity": "WARNING", "last_triggered_at": None},
                {"alert_type": "rate_limit_triggered", "enabled": True, "severity": "WARNING", "last_triggered_at": None},
            ],
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def count_audit_events(db: Session) -> int:
    return int(db.scalar(select(func.count()).select_from(PlatformAuditEvent)) or 0)


def list_audit_events(db: Session, *, limit: int, offset: int) -> list[PlatformAuditEvent]:
    q = (
        select(PlatformAuditEvent)
        .order_by(PlatformAuditEvent.created_at.desc())
        .offset(max(0, offset))
        .limit(min(500, max(1, limit)))
    )
    return list(db.scalars(q))


def count_config_versions(
    db: Session,
    *,
    entity_type: str | None = None,
    entity_id: int | None = None,
) -> int:
    q = select(func.count()).select_from(PlatformConfigVersion)
    if entity_type is not None:
        q = q.where(PlatformConfigVersion.entity_type == entity_type)
    if entity_id is not None:
        q = q.where(PlatformConfigVersion.entity_id == int(entity_id))
    return int(db.scalar(q) or 0)


def list_config_versions(
    db: Session,
    *,
    limit: int,
    offset: int,
    entity_type: str | None = None,
    entity_id: int | None = None,
) -> list[PlatformConfigVersion]:
    q = select(PlatformConfigVersion).order_by(PlatformConfigVersion.created_at.desc())
    if entity_type is not None:
        q = q.where(PlatformConfigVersion.entity_type == entity_type)
    if entity_id is not None:
        q = q.where(PlatformConfigVersion.entity_id == int(entity_id))
    q = q.offset(max(0, offset)).limit(min(500, max(1, limit)))
    return list(db.scalars(q))


def get_config_version_by_id(db: Session, row_id: int) -> PlatformConfigVersion | None:
    return db.get(PlatformConfigVersion, int(row_id))
