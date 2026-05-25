"""Suggest static enrichment fields for Template Drafts (operator approval required)."""

from __future__ import annotations

from typing import Any, TypedDict


class EnrichmentCandidate(TypedDict):
    field_name: str
    suggested_value: str
    confidence: float
    reason: str


def detect_enrichment_candidates(
    *,
    vendor: str | None = None,
    product: str | None = None,
    source_type: str = "HTTP_API_POLLING",
) -> list[EnrichmentCandidate]:
    """Low-confidence static enrichment hints; never auto-applied at runtime."""

    out: list[EnrichmentCandidate] = []
    if vendor and vendor.strip():
        out.append(
            EnrichmentCandidate(
                field_name="vendor",
                suggested_value=vendor.strip(),
                confidence=0.75,
                reason="vendor label from draft metadata",
            )
        )
    if product and product.strip():
        out.append(
            EnrichmentCandidate(
                field_name="product",
                suggested_value=product.strip(),
                confidence=0.72,
                reason="product label from draft metadata",
            )
        )
    out.append(
        EnrichmentCandidate(
            field_name="ingest_source",
            suggested_value=source_type,
            confidence=0.65,
            reason="stream source type for pipeline context",
        )
    )
    out.append(
        EnrichmentCandidate(
            field_name="collector",
            suggested_value="gdc",
            confidence=0.5,
            reason="default platform collector tag (edit before apply)",
        )
    )
    return out
