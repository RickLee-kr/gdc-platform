"""Unit tests for centralized RBAC-lite HTTP access rules."""

from __future__ import annotations

import pytest

from app.auth.route_access import (
    ROLE_ADMINISTRATOR,
    ROLE_OPERATOR,
    ROLE_VIEWER,
    evaluate_http_access,
    is_viewer_allowed_post,
)
from app.config import settings


def _p(suffix: str) -> str:
    base = settings.API_PREFIX.rstrip("/")
    return f"{base}{suffix}"


# Comprehensive write-path matrix for Viewer / Operator / Admin (existing policy).
# expect_denied=True means evaluate_http_access returns AccessDenied.
_WRITE_MATRIX: list[tuple[str, str, str, bool]] = [
    # Streams CRUD + control
    (ROLE_VIEWER, "POST", _p("/streams/"), True),
    (ROLE_OPERATOR, "POST", _p("/streams/"), False),
    (ROLE_ADMINISTRATOR, "POST", _p("/streams/"), False),
    (ROLE_VIEWER, "PUT", _p("/streams/1"), True),
    (ROLE_OPERATOR, "PUT", _p("/streams/1"), False),
    (ROLE_VIEWER, "DELETE", _p("/streams/1"), True),
    (ROLE_OPERATOR, "DELETE", _p("/streams/1"), False),
    (ROLE_VIEWER, "POST", _p("/runtime/streams/1/start"), True),
    (ROLE_OPERATOR, "POST", _p("/runtime/streams/1/start"), False),
    (ROLE_VIEWER, "POST", _p("/runtime/streams/1/stop"), True),
    (ROLE_OPERATOR, "POST", _p("/runtime/streams/1/stop"), False),
    (ROLE_VIEWER, "POST", _p("/runtime/streams/1/run-once"), True),
    (ROLE_OPERATOR, "POST", _p("/runtime/streams/1/run-once"), False),
    # Checkpoint
    (ROLE_VIEWER, "PUT", _p("/runtime/streams/1/checkpoint"), True),
    (ROLE_OPERATOR, "PUT", _p("/runtime/streams/1/checkpoint"), False),
    (ROLE_VIEWER, "POST", _p("/runtime/streams/1/checkpoint/reset"), True),
    (ROLE_OPERATOR, "POST", _p("/runtime/streams/1/checkpoint/reset"), False),
    # Runtime quarantine / replay (operational plane — Operator allowed)
    (ROLE_VIEWER, "POST", _p("/runtime/quarantine-events/1/release"), True),
    (ROLE_OPERATOR, "POST", _p("/runtime/quarantine-events/1/release"), False),
    (ROLE_VIEWER, "POST", _p("/runtime/quarantine-events/1/discard"), True),
    (ROLE_OPERATOR, "POST", _p("/runtime/replay-events/1/replay"), False),
    (ROLE_VIEWER, "POST", _p("/runtime/streams/1/replay"), True),
    (ROLE_OPERATOR, "POST", _p("/runtime/streams/1/replay"), False),
    # Routes / connectors / destinations
    (ROLE_VIEWER, "POST", _p("/routes/"), True),
    (ROLE_OPERATOR, "POST", _p("/routes/"), False),
    (ROLE_VIEWER, "PUT", _p("/routes/1"), True),
    (ROLE_VIEWER, "DELETE", _p("/routes/1"), True),
    (ROLE_VIEWER, "POST", _p("/connectors/"), True),
    (ROLE_OPERATOR, "POST", _p("/connectors/"), False),
    (ROLE_VIEWER, "PUT", _p("/connectors/1"), True),
    (ROLE_VIEWER, "DELETE", _p("/connectors/1"), True),
    (ROLE_VIEWER, "POST", _p("/connectors/1/auth-check"), True),
    (ROLE_OPERATOR, "POST", _p("/connectors/1/auth-check"), False),
    (ROLE_VIEWER, "POST", _p("/destinations/"), True),
    (ROLE_OPERATOR, "POST", _p("/destinations/"), False),
    (ROLE_VIEWER, "PUT", _p("/destinations/1"), True),
    (ROLE_VIEWER, "DELETE", _p("/destinations/1"), True),
    (ROLE_VIEWER, "POST", _p("/destinations/1/test"), True),
    (ROLE_OPERATOR, "POST", _p("/destinations/1/test"), False),
    # Backup / restore
    (ROLE_VIEWER, "GET", _p("/backup/workspace/export"), False),
    (ROLE_VIEWER, "POST", _p("/backup/import/preview"), True),
    (ROLE_OPERATOR, "POST", _p("/backup/import/preview"), False),
    (ROLE_VIEWER, "POST", _p("/backup/import/apply"), True),
    (ROLE_OPERATOR, "POST", _p("/backup/import/apply"), True),
    (ROLE_ADMINISTRATOR, "POST", _p("/backup/import/apply"), False),
    (ROLE_VIEWER, "POST", _p("/backup/streams/1/clone"), True),
    (ROLE_OPERATOR, "POST", _p("/backup/streams/1/clone"), False),
    # Admin settings
    (ROLE_VIEWER, "PUT", _p("/admin/https-settings"), True),
    (ROLE_OPERATOR, "PUT", _p("/admin/https-settings"), True),
    (ROLE_ADMINISTRATOR, "PUT", _p("/admin/https-settings"), False),
    (ROLE_VIEWER, "PUT", _p("/admin/retention-policy"), True),
    (ROLE_OPERATOR, "PUT", _p("/admin/retention-policy"), True),
    (ROLE_VIEWER, "PUT", _p("/admin/alert-settings"), True),
    (ROLE_OPERATOR, "PUT", _p("/admin/alert-settings"), True),
    (ROLE_VIEWER, "PUT", _p("/admin/display-settings"), True),
    (ROLE_OPERATOR, "PUT", _p("/admin/display-settings"), False),
    (ROLE_ADMINISTRATOR, "PUT", _p("/admin/display-settings"), False),
    (ROLE_VIEWER, "POST", _p("/admin/users"), True),
    (ROLE_OPERATOR, "POST", _p("/admin/users"), True),
    (ROLE_VIEWER, "PUT", _p("/admin/network-settings"), True),
    (ROLE_OPERATOR, "PUT", _p("/admin/network-settings"), True),
    (ROLE_OPERATOR, "POST", _p("/admin/config-versions/1/apply-snapshot"), True),
    (ROLE_ADMINISTRATOR, "POST", _p("/admin/config-versions/1/apply-snapshot"), False),
    # Retention execute
    (ROLE_VIEWER, "POST", _p("/retention/run"), True),
    (ROLE_OPERATOR, "POST", _p("/retention/run"), False),
    # Governance (Viewer blocked; Operator blocked for writes)
    (ROLE_VIEWER, "POST", _p("/governance/policies"), True),
    (ROLE_OPERATOR, "POST", _p("/governance/policies"), True),
    (ROLE_ADMINISTRATOR, "POST", _p("/governance/policies"), False),
    (ROLE_VIEWER, "POST", _p("/governance/quarantine/release"), True),
    (ROLE_OPERATOR, "POST", _p("/governance/quarantine/release"), True),
    (ROLE_VIEWER, "POST", _p("/governance/replay/1/execute"), True),
    (ROLE_OPERATOR, "POST", _p("/governance/replay/1/execute"), True),
    (ROLE_VIEWER, "POST", _p("/governance/replay/bulk-execute"), True),
    (ROLE_OPERATOR, "POST", _p("/governance/replay/bulk-execute"), True),
    # Legacy admin + monitoring baselines
    (ROLE_VIEWER, "GET", _p("/admin/users"), True),
    (ROLE_OPERATOR, "GET", _p("/admin/users"), True),
    (ROLE_ADMINISTRATOR, "GET", _p("/admin/users"), False),
    (ROLE_VIEWER, "GET", _p("/admin/maintenance/health"), True),
    (ROLE_OPERATOR, "GET", _p("/admin/maintenance/health"), True),
    (ROLE_VIEWER, "GET", _p("/admin/dev-validation/status"), True),
    (ROLE_OPERATOR, "GET", _p("/admin/dev-validation/status"), True),
    (ROLE_ADMINISTRATOR, "GET", _p("/admin/dev-validation/status"), False),
    (ROLE_VIEWER, "GET", _p("/admin/dev-validation/status/"), True),
    (ROLE_ADMINISTRATOR, "GET", _p("/admin/dev-validation/status/"), False),
    (ROLE_VIEWER, "GET", _p("/runtime/dashboard/summary"), False),
    (ROLE_VIEWER, "POST", _p("/runtime/preview/mapping"), False),
    (ROLE_OPERATOR, "GET", _p("/admin/https-settings"), False),
]


@pytest.mark.parametrize(("role", "method", "path", "expect_denied"), _WRITE_MATRIX)
def test_evaluate_http_access(role: str, method: str, path: str, expect_denied: bool) -> None:
    denied = evaluate_http_access(role=role, method=method, path=path)
    if expect_denied:
        assert denied is not None, f"expected deny for {role} {method} {path}"
        assert denied.error_code in {
            "ROLE_FORBIDDEN",
            "GOVERNANCE_READ_FORBIDDEN",
            "GOVERNANCE_WRITE_FORBIDDEN",
            "GOVERNANCE_QUARANTINE_FORBIDDEN",
            "GOVERNANCE_REPLAY_FORBIDDEN",
            "GOVERNANCE_DASHBOARD_FORBIDDEN",
            "GOVERNANCE_OPERATIONS_FORBIDDEN",
            "GOVERNANCE_ACTIVATE_FORBIDDEN",
            "GOVERNANCE_APPROVAL_FORBIDDEN",
        }
    else:
        assert denied is None, f"expected allow for {role} {method} {path}: {denied}"


def test_viewer_allowed_post_paths() -> None:
    assert is_viewer_allowed_post(_p("/runtime/preview/mapping")) is True
    assert is_viewer_allowed_post(_p("/runtime/format-preview")) is True
    assert is_viewer_allowed_post(_p("/runtime/streams/1/pipeline-debug")) is True
    assert is_viewer_allowed_post(_p("/runtime/streams/1/start")) is False
