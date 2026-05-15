"""CRUD and orchestration for continuous validation definitions."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import utcnow
from app.validation.models import ContinuousValidation, ValidationRun
from app.validation.runner import execute_continuous_validation_row
from app.validation.schemas import ContinuousValidationCreate, ContinuousValidationUpdate


def list_validations(db: Session, *, enabled_only: bool = False) -> list[ContinuousValidation]:
    q = select(ContinuousValidation).order_by(ContinuousValidation.id.asc())
    if enabled_only:
        q = q.where(ContinuousValidation.enabled.is_(True))
    return list(db.scalars(q).all())


def get_validation(db: Session, validation_id: int) -> ContinuousValidation | None:
    return db.get(ContinuousValidation, validation_id)


def list_validation_runs(
    db: Session, *, validation_id: int | None = None, limit: int = 100
) -> list[ValidationRun]:
    lim = min(int(limit), 500)
    q = select(ValidationRun)
    if validation_id is not None:
        q = q.where(ValidationRun.validation_id == int(validation_id))
    q = q.order_by(ValidationRun.id.desc()).limit(lim)
    return list(db.scalars(q).all())


def create_validation(db: Session, payload: ContinuousValidationCreate) -> ContinuousValidation:
    row = ContinuousValidation(
        name=payload.name,
        enabled=payload.enabled,
        validation_type=str(payload.validation_type),
        target_stream_id=payload.target_stream_id,
        template_key=payload.template_key,
        schedule_seconds=int(payload.schedule_seconds),
        expect_checkpoint_advance=payload.expect_checkpoint_advance,
        last_status="DISABLED" if not payload.enabled else "HEALTHY",
        consecutive_failures=0,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_validation(db: Session, validation_id: int, payload: ContinuousValidationUpdate) -> ContinuousValidation | None:
    row = db.get(ContinuousValidation, validation_id)
    if row is None:
        return None
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(row, k, v)
    row.updated_at = utcnow()
    if "enabled" in data and not bool(row.enabled):
        row.last_status = "DISABLED"
    elif "enabled" in data and bool(row.enabled) and row.last_status == "DISABLED":
        row.last_status = "HEALTHY"
    db.commit()
    db.refresh(row)
    return row


def set_enabled(db: Session, validation_id: int, *, enabled: bool) -> ContinuousValidation | None:
    row = db.get(ContinuousValidation, validation_id)
    if row is None:
        return None
    row.enabled = enabled
    row.last_status = "DISABLED" if not enabled else "HEALTHY"
    row.updated_at = utcnow()
    db.commit()
    db.refresh(row)
    return row


def run_validation_now(db: Session, validation_id: int) -> dict:
    row = db.get(ContinuousValidation, validation_id)
    if row is None:
        return {"error": "not_found"}
    return execute_continuous_validation_row(row)
