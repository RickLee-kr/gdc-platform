"""Governance RBAC helpers (M20).

Role-based access for the Governance control plane.  Replaces the temporary
``X-Governance-Persona`` header with JWT-derived platform roles.

Legacy ``OPERATOR`` is treated as ``CONNECTOR_OPERATOR`` for governance checks.
``ADMINISTRATOR`` retains full access.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import HTTPException, Request, status

if TYPE_CHECKING:
    from app.auth.role_guard import AuthContext

ROLE_ADMINISTRATOR = "ADMINISTRATOR"
ROLE_OPERATOR = "OPERATOR"
ROLE_CONNECTOR_OPERATOR = "CONNECTOR_OPERATOR"
ROLE_GOVERNANCE_OPERATOR = "GOVERNANCE_OPERATOR"
ROLE_GOVERNANCE_REVIEWER = "GOVERNANCE_REVIEWER"
ROLE_GOVERNANCE_APPROVER = "GOVERNANCE_APPROVER"
ROLE_GOVERNANCE_AUDITOR = "GOVERNANCE_AUDITOR"
ROLE_VIEWER = "VIEWER"

GOVERNANCE_ROLES = frozenset(
    {
        ROLE_GOVERNANCE_OPERATOR,
        ROLE_GOVERNANCE_REVIEWER,
        ROLE_GOVERNANCE_APPROVER,
        ROLE_GOVERNANCE_AUDITOR,
    }
)

ALL_PLATFORM_ROLES = frozenset(
    {
        ROLE_ADMINISTRATOR,
        ROLE_OPERATOR,
        ROLE_CONNECTOR_OPERATOR,
        ROLE_GOVERNANCE_OPERATOR,
        ROLE_GOVERNANCE_REVIEWER,
        ROLE_GOVERNANCE_APPROVER,
        ROLE_GOVERNANCE_AUDITOR,
        ROLE_VIEWER,
    }
)


def normalize_platform_role(role: str | None) -> str:
    """Normalize role string; map legacy OPERATOR to CONNECTOR_OPERATOR."""

    r = (role or "").strip().upper()
    if r == ROLE_OPERATOR:
        return ROLE_CONNECTOR_OPERATOR
    return r


def is_administrator(role: str | None) -> bool:
    return (role or "").strip().upper() == ROLE_ADMINISTRATOR


def can_connector_operate(role: str | None) -> bool:
    r = normalize_platform_role(role)
    return is_administrator(role) or r == ROLE_CONNECTOR_OPERATOR


def can_governance_read(role: str | None) -> bool:
    if is_administrator(role):
        return True
    r = normalize_platform_role(role)
    return r in GOVERNANCE_ROLES | {ROLE_CONNECTOR_OPERATOR}


def can_governance_dashboard_read(role: str | None) -> bool:
    """Executive dashboard — all governance readers plus Viewer."""

    if can_governance_read(role):
        return True
    return normalize_platform_role(role) == ROLE_VIEWER


def can_governance_operations_access(role: str | None) -> bool:
    """Operational action center — Governance Operator tier and above."""

    if is_administrator(role):
        return True
    r = normalize_platform_role(role)
    return r in {
        ROLE_GOVERNANCE_OPERATOR,
        ROLE_GOVERNANCE_REVIEWER,
        ROLE_GOVERNANCE_APPROVER,
    }


def can_governance_write(role: str | None) -> bool:
    if is_administrator(role):
        return True
    r = normalize_platform_role(role)
    return r == ROLE_GOVERNANCE_OPERATOR


def can_policy_submit(role: str | None) -> bool:
    return can_governance_write(role)


def can_policy_review(role: str | None) -> bool:
    if is_administrator(role):
        return True
    r = normalize_platform_role(role)
    return r in {ROLE_GOVERNANCE_REVIEWER, ROLE_GOVERNANCE_APPROVER}


def can_policy_approve(role: str | None) -> bool:
    return can_policy_review(role)


def can_policy_activate(role: str | None) -> bool:
    if is_administrator(role):
        return True
    r = normalize_platform_role(role)
    return r == ROLE_GOVERNANCE_APPROVER


def can_quarantine_action(role: str | None) -> bool:
    if is_administrator(role):
        return True
    r = normalize_platform_role(role)
    return r == ROLE_GOVERNANCE_OPERATOR


def can_replay_action(role: str | None) -> bool:
    return can_quarantine_action(role)


def can_audit_read(role: str | None) -> bool:
    if is_administrator(role):
        return True
    r = normalize_platform_role(role)
    return r in GOVERNANCE_ROLES


def _resolve(request: Request) -> AuthContext:
    from app.auth.role_guard import resolve_auth_context

    return resolve_auth_context(request)


def _forbidden(error_code: str, message: str, role: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "error_code": error_code,
            "message": message,
            "role": role,
        },
    )


def _check(request: Request, *, allowed: bool, error_code: str, message: str) -> AuthContext:
    ctx = _resolve(request)
    if not allowed:
        raise _forbidden(error_code, message, ctx.role)
    return ctx


def require_roles(*allowed: str):
    """Per-route dependency: principal role must be in ``allowed`` (after normalization)."""

    allowed_set = frozenset(normalize_platform_role(r) for r in allowed)
    if ROLE_CONNECTOR_OPERATOR in allowed_set:
        allowed_set = allowed_set | {ROLE_OPERATOR}

    def _dep(request: Request) -> AuthContext:
        ctx = _resolve(request)
        if is_administrator(ctx.role):
            return ctx
        normalized = normalize_platform_role(ctx.role)
        if normalized not in allowed_set:
            raise _forbidden(
                "ROLE_FORBIDDEN",
                f"Role {ctx.role} cannot access this endpoint.",
                ctx.role,
            )
        return ctx

    return _dep


def require_governance_dashboard_read():
    def _dep(request: Request) -> AuthContext:
        ctx = _resolve(request)
        if not can_governance_dashboard_read(ctx.role):
            raise _forbidden(
                "GOVERNANCE_DASHBOARD_FORBIDDEN",
                "Governance dashboard requires an authorized Governance role or Viewer.",
                ctx.role,
            )
        return ctx

    return _dep


def require_governance_operations_access():
    def _dep(request: Request) -> AuthContext:
        ctx = _resolve(request)
        if not can_governance_operations_access(ctx.role):
            raise _forbidden(
                "GOVERNANCE_OPERATIONS_FORBIDDEN",
                "Governance Operations requires Governance Operator role or higher.",
                ctx.role,
            )
        return ctx

    return _dep


def require_governance_read():
    def _dep(request: Request) -> AuthContext:
        ctx = _resolve(request)
        if not can_governance_read(ctx.role):
            raise _forbidden(
                "GOVERNANCE_READ_FORBIDDEN",
                "Governance access requires Governance Operator, Reviewer, Approver, Auditor, or Connector Operator role.",
                ctx.role,
            )
        return ctx

    return _dep


def require_governance_write():
    def _dep(request: Request) -> AuthContext:
        ctx = _resolve(request)
        if not can_governance_write(ctx.role):
            raise _forbidden(
                "GOVERNANCE_WRITE_FORBIDDEN",
                "Governance write actions require Governance Operator role.",
                ctx.role,
            )
        return ctx

    return _dep


def require_policy_approve():
    def _dep(request: Request) -> AuthContext:
        ctx = _resolve(request)
        if not can_policy_approve(ctx.role):
            raise _forbidden(
                "GOVERNANCE_APPROVAL_FORBIDDEN",
                "Governance approval requires Governance Reviewer or Governance Approver role.",
                ctx.role,
            )
        return ctx

    return _dep


def require_policy_activate():
    def _dep(request: Request) -> AuthContext:
        ctx = _resolve(request)
        if not can_policy_activate(ctx.role):
            raise _forbidden(
                "GOVERNANCE_ACTIVATE_FORBIDDEN",
                "Policy activation requires Governance Approver role.",
                ctx.role,
            )
        return ctx

    return _dep


def require_quarantine_action():
    def _dep(request: Request) -> AuthContext:
        ctx = _resolve(request)
        if not can_quarantine_action(ctx.role):
            raise _forbidden(
                "GOVERNANCE_QUARANTINE_FORBIDDEN",
                "Quarantine release requires Governance Operator role.",
                ctx.role,
            )
        return ctx

    return _dep


def require_replay_action():
    def _dep(request: Request) -> AuthContext:
        ctx = _resolve(request)
        if not can_replay_action(ctx.role):
            raise _forbidden(
                "GOVERNANCE_REPLAY_FORBIDDEN",
                "Replay execution requires Governance Operator role.",
                ctx.role,
            )
        return ctx

    return _dep


def require_audit_read():
    def _dep(request: Request) -> AuthContext:
        ctx = _resolve(request)
        if not can_audit_read(ctx.role):
            raise _forbidden(
                "GOVERNANCE_AUDIT_FORBIDDEN",
                "Audit access requires Governance Auditor or Governance Operator role.",
                ctx.role,
            )
        return ctx

    return _dep


def resolve_governance_actor(request: Request, *, default: str = "system") -> str:
    """Username for governance audit/approval actor fields."""

    ctx = _resolve(request)
    if ctx.username and ctx.username not in ("anonymous", ""):
        return ctx.username
    return default


__all__ = [
    "ALL_PLATFORM_ROLES",
    "GOVERNANCE_ROLES",
    "ROLE_ADMINISTRATOR",
    "ROLE_CONNECTOR_OPERATOR",
    "ROLE_GOVERNANCE_APPROVER",
    "ROLE_GOVERNANCE_AUDITOR",
    "ROLE_GOVERNANCE_OPERATOR",
    "ROLE_GOVERNANCE_REVIEWER",
    "ROLE_OPERATOR",
    "ROLE_VIEWER",
    "can_audit_read",
    "can_connector_operate",
    "can_governance_dashboard_read",
    "can_governance_operations_access",
    "can_governance_read",
    "can_governance_write",
    "can_policy_activate",
    "can_policy_approve",
    "can_policy_review",
    "can_policy_submit",
    "can_quarantine_action",
    "can_replay_action",
    "normalize_platform_role",
    "require_audit_read",
    "require_governance_dashboard_read",
    "require_governance_operations_access",
    "require_governance_read",
    "require_governance_write",
    "require_policy_activate",
    "require_policy_approve",
    "require_quarantine_action",
    "require_replay_action",
    "require_roles",
    "resolve_governance_actor",
]
