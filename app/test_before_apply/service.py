"""Test Before Apply orchestration over Safe Change (no new engines)."""

from __future__ import annotations

from fastapi import Request
from sqlalchemy.orm import Session

from app.safe_change.schemas import SafeChangeApplyRequest, SafeChangeIssue, SafeChangePreviewRequest
from app.safe_change.service import apply_safe_change, preview_safe_change
from app.test_before_apply.schemas import (
    TestBeforeApplyApplyRequest,
    TestBeforeApplyApplyResponse,
    TestBeforeApplyEvidence,
    TestBeforeApplyPreviewRequest,
    TestBeforeApplyPreviewResponse,
    TestBeforeApplyTestResult,
)


def _build_test_result(
    *,
    blocking: list[SafeChangeIssue],
    warnings: list[SafeChangeIssue],
    evidence: TestBeforeApplyEvidence | None,
) -> TestBeforeApplyTestResult:
    checks: list[str] = ["config_diff", "impact_analysis", "blocking_rules", "warning_rules"]

    if evidence is not None:
        if evidence.connection_ok is True:
            checks.append("connection_test:pass")
        elif evidence.connection_ok is False:
            checks.append("connection_test:fail")
        if evidence.sample_fetched is True:
            checks.append("sample_fetch:pass")
        elif evidence.sample_fetched is False:
            checks.append("sample_fetch:fail")
        if evidence.validated is True:
            checks.append("validate:pass")
        elif evidence.validated is False:
            checks.append("validate:fail")

    if any(i.code for i in blocking):
        status = "FAIL"
        summary = "Validation blocked apply. Resolve blocking issues before applying."
    elif evidence is not None and (
        evidence.connection_ok is False or evidence.sample_fetched is False or evidence.validated is False
    ):
        status = "FAIL"
        summary = "Live test evidence reported a failure. Re-test before applying."
    elif warnings or (
        evidence is not None
        and evidence.connection_ok is None
        and any(i.code in {"AUTH_ENDPOINT_CHANGE", "SCHEMA_MAPPING_CHANGE"} for i in warnings)
    ):
        status = "WARNING"
        summary = "Preview completed with warnings. Review impact before applying."
    else:
        status = "PASS"
        summary = "Preview validation passed. Change is eligible to apply via existing path."

    return TestBeforeApplyTestResult(status=status, summary=summary, checks=checks)  # type: ignore[arg-type]


def preview_test_before_apply(
    db: Session,
    body: TestBeforeApplyPreviewRequest,
) -> TestBeforeApplyPreviewResponse:
    """Read-only Test Before Apply preview; reuses Safe Change impact analysis."""

    safe_preview = preview_safe_change(
        db,
        SafeChangePreviewRequest(
            entity_type=body.entity_type,
            entity_id=body.entity_id,
            proposed=body.proposed,
            base_updated_at=body.base_updated_at,
        ),
    )

    blocking = list(safe_preview.blocking_issues)
    warnings = list(safe_preview.warnings)

    if body.test_evidence is not None:
        if body.test_evidence.connection_ok is False:
            blocking.append(
                SafeChangeIssue(
                    code="CONNECTION_TEST_FAILED",
                    message="Connection test failed. Fix credentials/connectivity before apply.",
                    severity="blocking",
                )
            )
        if body.test_evidence.validated is False:
            blocking.append(
                SafeChangeIssue(
                    code="VALIDATION_FAILED",
                    message="Sample/schema validation failed. Resolve validation before apply.",
                    severity="blocking",
                )
            )
        auth_related = any(
            "auth" in (c.path or "").lower()
            or "credential" in (c.path or "").lower()
            or "endpoint" in (c.path or "").lower()
            or "url" in (c.path or "").lower()
            for c in safe_preview.changed_fields
        )
        if auth_related and body.test_evidence.connection_ok is None:
            warnings.append(
                SafeChangeIssue(
                    code="CONNECTION_TEST_RECOMMENDED",
                    message="Auth/endpoint fields changed. Run Test Connection before apply.",
                    severity="warning",
                )
            )

    test = _build_test_result(blocking=blocking, warnings=warnings, evidence=body.test_evidence)
    can_apply = len(blocking) == 0

    return TestBeforeApplyPreviewResponse(
        entity_type=safe_preview.entity_type,
        entity_id=safe_preview.entity_id,
        entity_name=safe_preview.entity_name,
        current_updated_at=safe_preview.current_updated_at,
        has_changes=safe_preview.has_changes,
        changed_fields=safe_preview.changed_fields,
        affected=safe_preview.affected,
        test=test,
        runtime_impact=safe_preview.runtime_impact,
        delivery_impact=safe_preview.delivery_impact,
        blocking_issues=blocking,
        warnings=warnings,
        can_apply=can_apply,
        recommended_actions=safe_preview.recommended_actions,
        preview_only=True,
        stale_base=safe_preview.stale_base,
    )


def apply_test_before_apply(
    db: Session,
    body: TestBeforeApplyApplyRequest,
    *,
    request: Request | None = None,
) -> TestBeforeApplyApplyResponse:
    """Apply via existing Safe Change persist path after Test Before Apply preview."""

    preview = preview_test_before_apply(db, body)
    if not preview.can_apply:
        # Still call apply_safe_change so stale/blocking contracts stay centralized;
        # it will refuse when Safe Change blocking rules fire. For evidence-only
        # blockers, refuse here without mutating.
        evidence_block = any(
            i.code in {"CONNECTION_TEST_FAILED", "VALIDATION_FAILED"} for i in preview.blocking_issues
        )
        if evidence_block:
            return TestBeforeApplyApplyResponse(
                entity_type=preview.entity_type,
                entity_id=preview.entity_id,
                applied=False,
                no_op=True,
                config_version=None,
                updated_at=None,
                preview=preview,
            )

    applied = apply_safe_change(
        db,
        SafeChangeApplyRequest(
            entity_type=body.entity_type,
            entity_id=body.entity_id,
            proposed=body.proposed,
            base_updated_at=body.base_updated_at,
        ),
        request=request,
    )
    # Recompute preview after apply for response consistency when applied.
    post_preview = preview if not applied.applied else preview_test_before_apply(
        db,
        TestBeforeApplyPreviewRequest(
            entity_type=body.entity_type,
            entity_id=body.entity_id,
            proposed=body.proposed,
            base_updated_at=applied.updated_at,
            test_evidence=body.test_evidence,
        ),
    )
    return TestBeforeApplyApplyResponse(
        entity_type=applied.entity_type,
        entity_id=applied.entity_id,
        applied=applied.applied,
        no_op=applied.no_op,
        config_version=applied.config_version,
        updated_at=applied.updated_at,
        preview=post_preview if applied.applied else preview,
    )
