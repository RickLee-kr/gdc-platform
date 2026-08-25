"""HTTP routes for the Marketplace UI: catalog, capabilities, validate, builder (M29.8/M29.9).

Thin adapters only. Reuses the existing unified registry, lifecycle install
service, license policy, AI Connector Builder, and M29.9 registry / offline
bundle / git acquisition paths. Never auto-installs / auto-creates credentials
or streams / auto-enables streams / auto-promotes AI drafts beyond Local Draft
or Imported Draft.
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from sqlalchemy.orm import Session

from app.auth.role_guard import resolve_request_role
from app.connectors_registry.builder import (
    BuilderRequest,
    BuilderTrustCandidate,
    DocumentationEvidence,
    OpenApiEvidence,
    SampleEvidence,
    ScriptReferenceEvidence,
    UserIntent,
    build_connector_draft,
)
from app.connectors_registry.builder.service import PRODUCTION_AI_PROVIDER_IMPLEMENTED
from app.connectors_registry.git_acquisition import install_package_from_git_url
from app.connectors_registry.harvester.models import (
    HarvestedIntegrationKnowledge,
    LicenseKnowledge,
    ProvenanceKnowledge,
)
from app.connectors_registry.lifecycle_errors import LifecycleError
from app.connectors_registry.lifecycle_schemas import MarketplacePackageInstallRead
from app.connectors_registry.lifecycle_service import validate_package_upload
from app.connectors_registry.marketplace_catalog import build_catalog, filter_catalog, get_package_card
from app.connectors_registry.marketplace_schemas import (
    MarketplaceBuilderDraftRequest,
    MarketplaceBuilderDraftResponse,
    MarketplaceCapabilitiesRead,
    MarketplaceCatalogResponse,
    MarketplaceGitInstallRequest,
    MarketplacePackageCard,
    MarketplaceValidateResultRead,
)
from app.connectors_registry.offline_bundle import install_offline_signed_bundle
from app.connectors_registry.registry_models import REMOTE_PUBLIC_DEFAULT_ENABLED
from app.database import get_db

router = APIRouter()

marketplace_router = APIRouter(prefix="/marketplace", tags=["connectors-registry-marketplace"])
packages_validate_router = APIRouter(prefix="/packages", tags=["connectors-registry-packages"])

ALLOWED_BUILDER_PROVIDERS: frozenset[str] = frozenset({"fixture", "manual"})

_GIT_ACQUISITION_REASON = (
    "Git acquisition accepts HTTPS URLs to .tar.gz / .tgz package archives with SSRF controls."
)


def _ensure_tar_gz_filename(filename: str | None) -> None:
    name = (filename or "").strip().lower()
    if not name.endswith(".tar.gz") and not name.endswith(".tgz"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error_code": "UNSUPPORTED_PACKAGE_FORMAT",
                "message": "only .tar.gz package archives are supported",
            },
        )


def _http_for_lifecycle(exc: LifecycleError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={
            "error_code": exc.error_code,
            "message": exc.message,
            "details": exc.details,
        },
    )


@marketplace_router.get("/catalog", response_model=MarketplaceCatalogResponse)
async def get_marketplace_catalog(
    q: str | None = None,
    trust_tier: str | None = None,
    origin: str | None = None,
    installed_from: str | None = None,
    installed: bool | None = None,
    compatibility: str | None = None,
    package_kind: str | None = None,
    db: Session = Depends(get_db),
) -> MarketplaceCatalogResponse:
    cards = build_catalog(db)
    filtered = filter_catalog(
        cards,
        q=q,
        trust_tier=trust_tier,
        origin=origin or installed_from,
        installed=installed,
        compatibility=compatibility,
        package_kind=package_kind,
    )
    return MarketplaceCatalogResponse(packages=filtered, count=len(filtered))


@marketplace_router.get("/packages/{package_id}", response_model=MarketplacePackageCard)
async def get_marketplace_package_detail(
    package_id: str,
    db: Session = Depends(get_db),
) -> MarketplacePackageCard:
    card = get_package_card(db, package_id)
    if card is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "error_code": "PACKAGE_NOT_FOUND",
                "message": f"marketplace package not found: {package_id}",
            },
        )
    return card


@marketplace_router.get("/capabilities", response_model=MarketplaceCapabilitiesRead)
async def get_marketplace_capabilities() -> MarketplaceCapabilitiesRead:
    return MarketplaceCapabilitiesRead(
        git_acquisition=True,
        git_acquisition_reason=_GIT_ACQUISITION_REASON,
        remote_registry=True,
        remote_registry_default_enabled=REMOTE_PUBLIC_DEFAULT_ENABLED,
        private_registry=True,
        offline_signed_bundle=True,
        production_ai_provider_implemented=PRODUCTION_AI_PROVIDER_IMPLEMENTED,
        deterministic_builder_providers=sorted(ALLOWED_BUILDER_PROVIDERS),
        auto_install=False,
        auto_stream_create=False,
        auto_stream_enable=False,
        auto_credential_create=False,
        trust_auto_promotion=False,
        supported_upload_formats=[".tar.gz", ".tgz"],
        supported_origins=[
            "Builtin",
            "Upload",
            "Git",
            "Private Registry",
            "Remote Registry",
        ],
    )


@packages_validate_router.post("/validate", response_model=MarketplaceValidateResultRead)
async def post_validate_package(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> MarketplaceValidateResultRead:
    _ensure_tar_gz_filename(file.filename)
    data = await file.read()
    result = validate_package_upload(db, data)
    return MarketplaceValidateResultRead(
        status=result.status,
        package_id=result.package_id,
        package_kind=result.package_kind,
        pack_version=result.pack_version,
        name=result.name,
        vendor=result.vendor,
        issues=result.issues,
        signature_status=result.signature_status,
        signing_key_id=result.signing_key_id,
        digest=result.digest,
        license_decision=result.license_decision,
        license_decision_code=result.license_decision_code,
        license_decision_reason=result.license_decision_reason,
        compatibility_warnings=result.compatibility_warnings,
        blocked_reasons=result.blocked_reasons,
    )


@packages_validate_router.post(
    "/install-offline-bundle",
    response_model=MarketplacePackageInstallRead,
    status_code=status.HTTP_201_CREATED,
)
async def post_install_offline_bundle(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> MarketplacePackageInstallRead:
    _ensure_tar_gz_filename(file.filename)
    data = await file.read()
    try:
        return install_offline_signed_bundle(
            db,
            data,
            actor_role=resolve_request_role(request),
        )
    except LifecycleError as exc:
        raise _http_for_lifecycle(exc) from exc


@marketplace_router.post(
    "/git/install",
    response_model=MarketplacePackageInstallRead,
    status_code=status.HTTP_201_CREATED,
)
async def post_git_install(
    payload: MarketplaceGitInstallRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> MarketplacePackageInstallRead:
    try:
        return install_package_from_git_url(
            db,
            payload.url,
            actor_role=resolve_request_role(request),
            network_policy=payload.network_policy,
        )
    except LifecycleError as exc:
        raise _http_for_lifecycle(exc) from exc


def _harvested_knowledge_from_dict(raw: dict[str, Any]) -> HarvestedIntegrationKnowledge:
    prov_raw = dict(raw.get("provenance") or {})
    provenance = ProvenanceKnowledge(
        ecosystem=str(prov_raw.get("ecosystem") or "manual"),
        upstream_project=prov_raw.get("upstream_project"),
        vendor=prov_raw.get("vendor"),
        product=prov_raw.get("product"),
        integration_name=prov_raw.get("integration_name"),
        upstream_version=prov_raw.get("upstream_version"),
        upstream_commit=prov_raw.get("upstream_commit"),
        upstream_path=prov_raw.get("upstream_path"),
        upstream_url=prov_raw.get("upstream_url"),
        import_method=prov_raw.get("import_method"),
    )
    license_raw = dict(raw.get("license") or {})
    license_knowledge = LicenseKnowledge(
        identifier=license_raw.get("identifier"),
        source=license_raw.get("source"),
        notice_required=license_raw.get("notice_required"),
    )
    return HarvestedIntegrationKnowledge(
        provenance=provenance,
        license=license_knowledge,
        proposed_source_type=raw.get("proposed_source_type"),
    )


def _resolve_trust_candidate(raw: str | None) -> BuilderTrustCandidate:
    if raw:
        try:
            return BuilderTrustCandidate(raw)
        except ValueError:
            pass
    return BuilderTrustCandidate.LOCAL_DRAFT


def _build_builder_request(
    payload: MarketplaceBuilderDraftRequest,
    *,
    provider_name: str,
) -> BuilderRequest:
    intent = UserIntent(
        vendor=payload.vendor,
        product=payload.product,
        desired_streams=list(payload.desired_streams or []),
    )
    openapi = OpenApiEvidence(document=payload.openapi) if payload.openapi else None
    sample = SampleEvidence(payload=payload.sample) if payload.sample is not None else None
    documentation = DocumentationEvidence(text=payload.documentation) if payload.documentation else None
    script_reference = (
        ScriptReferenceEvidence(text=payload.script_reference) if payload.script_reference else None
    )
    harvested = (
        _harvested_knowledge_from_dict(payload.harvested_knowledge) if payload.harvested_knowledge else None
    )

    output_dir = (
        Path(payload.output_dir)
        if payload.output_dir
        else Path(tempfile.mkdtemp(prefix="m29_9_builder_draft_"))
    )
    output_dir.mkdir(parents=True, exist_ok=True)

    return BuilderRequest(
        intent=intent,
        harvested_knowledge=harvested,
        openapi=openapi,
        sample=sample,
        documentation=documentation,
        script_reference=script_reference,
        output_dir=output_dir,
        trust_candidate=_resolve_trust_candidate(payload.trust_candidate),
        provider_name=provider_name,
        supplied_translation=payload.supplied_translation,
    )


@marketplace_router.post("/builder/draft", response_model=MarketplaceBuilderDraftResponse)
async def post_builder_draft(
    payload: MarketplaceBuilderDraftRequest,
) -> MarketplaceBuilderDraftResponse:
    provider_name = (payload.provider_name or "fixture").strip().lower()
    if provider_name not in ALLOWED_BUILDER_PROVIDERS:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error_code": "AI_PROVIDER_UNAVAILABLE",
                "message": (
                    f"AI provider {provider_name!r} is not available. Production network AI "
                    "providers are not implemented (M29.7); only deterministic fixture/manual "
                    "drafting is supported."
                ),
                "production_ai_provider_implemented": PRODUCTION_AI_PROVIDER_IMPLEMENTED,
                "deterministic_builder_providers": sorted(ALLOWED_BUILDER_PROVIDERS),
            },
        )

    try:
        request = _build_builder_request(payload, provider_name=provider_name)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error_code": "BUILDER_REQUEST_INVALID", "message": str(exc)},
        ) from exc

    try:
        result = build_connector_draft(request)
    except LifecycleError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error_code": exc.error_code, "message": exc.message, "details": exc.details},
        ) from exc

    data = result.to_dict()
    return MarketplaceBuilderDraftResponse(**data)


router.include_router(marketplace_router)
router.include_router(packages_validate_router)
