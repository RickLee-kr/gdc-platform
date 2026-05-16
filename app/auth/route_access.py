"""Centralized HTTP RBAC-lite rules (JWT role + method + path).

This module is the single source of truth for coarse route access used by
``role_guard_middleware``.  Per-route ``Depends(require_roles(...))`` should
only be used for exceptions that cannot be expressed as prefix/method rules
(e.g. retention GET open to VIEWER while POST /run stays operator+admin).
"""

from __future__ import annotations

from dataclasses import dataclass

from app.config import settings

ROLE_ADMINISTRATOR = "ADMINISTRATOR"
ROLE_OPERATOR = "OPERATOR"
ROLE_VIEWER = "VIEWER"

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


@dataclass(frozen=True)
class AccessDenied:
    """Structured denial returned by :func:`evaluate_http_access`."""

    error_code: str
    message: str


def api_prefix() -> str:
    return settings.API_PREFIX.rstrip("/")


def _under(prefix: str, path: str) -> bool:
    return path == prefix or path.startswith(f"{prefix}/")


def is_viewer_allowed_post(path: str) -> bool:
    """POST endpoints that are read-only / non-persisting preview helpers."""

    base = api_prefix()
    if path.startswith(f"{base}/runtime/preview/"):
        return True
    if path == f"{base}/runtime/format-preview":
        return True
    return False


def build_capabilities(role: str) -> dict[str, bool]:
    """UI-oriented capability flags derived from the effective platform role."""

    r = (role or "").strip().upper()
    is_admin = r == ROLE_ADMINISTRATOR
    is_operator = r == ROLE_OPERATOR
    is_viewer = r == ROLE_VIEWER
    can_operate = is_admin or is_operator
    return {
        "workspace_mutations": can_operate,
        "runtime_stream_control": can_operate,
        "runtime_logs_cleanup": can_operate,
        "backfill_mutations": can_operate,
        "retention_execute": can_operate,
        "validation_mutations": can_operate,
        "backup_import_apply": is_admin,
        "backup_import_preview": can_operate,
        "backup_clone": can_operate,
        "admin_user_management": is_admin,
        "admin_password_changes": is_admin,
        "admin_maintenance_health": is_admin,
        "admin_support_bundle": is_admin,
        "admin_https_write": is_admin,
        "admin_retention_policy_write": is_admin,
        "admin_alert_settings_write": is_admin,
        "admin_config_snapshot_apply": is_admin,
        "administration_apis": is_admin or is_operator,
        "read_only_monitoring": is_admin or is_operator or is_viewer,
    }


def evaluate_http_access(*, role: str, method: str, path: str) -> AccessDenied | None:
    """Return ``AccessDenied`` when the principal must not proceed, else ``None``."""

    m = method.upper()
    base = api_prefix()

    # --- Sensitive administrator surfaces (not even read for non-admins) ---
    admin_exclusive = (
        f"{base}/admin/maintenance/health",
        f"{base}/admin/dev-validation/status",
        f"{base}/admin/support-bundle",
        f"{base}/admin/users",
    )
    for prefix in admin_exclusive:
        if _under(prefix, path) and role != ROLE_ADMINISTRATOR:
            return AccessDenied(
                "ROLE_FORBIDDEN",
                "This endpoint requires the Administrator role.",
            )

    if _under(f"{base}/admin/password", path) and role != ROLE_ADMINISTRATOR:
        return AccessDenied(
            "ROLE_FORBIDDEN",
            "This endpoint requires the Administrator role.",
        )

    # --- Platform policy writes: Administrator only (GET remains for operators/viewers) ---
    policy_prefixes = (
        f"{base}/admin/https-settings",
        f"{base}/admin/retention-policy",
        f"{base}/admin/alert-settings",
    )
    for prefix in policy_prefixes:
        if _under(prefix, path) and m not in SAFE_METHODS and role != ROLE_ADMINISTRATOR:
            return AccessDenied(
                "ROLE_FORBIDDEN",
                "Only an Administrator may change this platform configuration.",
            )

    # --- Destructive / wide-blast configuration ---
    if path.startswith(f"{base}/backup/import/apply") and m not in SAFE_METHODS and role != ROLE_ADMINISTRATOR:
        return AccessDenied(
            "ROLE_FORBIDDEN",
            "Workspace import apply requires the Administrator role.",
        )

    if (
        "/apply-snapshot" in path
        and path.startswith(f"{base}/admin/config-versions")
        and m not in SAFE_METHODS
        and role != ROLE_ADMINISTRATOR
    ):
        return AccessDenied(
            "ROLE_FORBIDDEN",
            "Applying configuration snapshots requires the Administrator role.",
        )

    # --- VIEWER: read-only monitoring; no mutating verbs except preview POSTs ---
    if role == ROLE_VIEWER and m not in SAFE_METHODS:
        if is_viewer_allowed_post(path):
            return None
        return AccessDenied(
            "ROLE_FORBIDDEN",
            "VIEWER role cannot perform mutating actions.",
        )

    # --- OPERATOR: block legacy administrator-only mutation prefixes ---
    if role == ROLE_OPERATOR and m not in SAFE_METHODS:
        operator_mutation_deny = (
            f"{base}/admin/users",
            f"{base}/admin/password",
            f"{base}/admin/https-settings",
            f"{base}/admin/retention-policy",
            f"{base}/admin/alert-settings",
        )
        for prefix in operator_mutation_deny:
            if _under(prefix, path):
                return AccessDenied(
                    "ROLE_FORBIDDEN",
                    "OPERATOR role cannot modify administrator-only resources.",
                )

    return None
