"""HTTP routes for Marketplace remote/private registry administration (M29.9)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.auth.role_guard import ROLE_ADMINISTRATOR, require_roles, resolve_request_role
from app.connectors_registry.lifecycle_errors import LifecycleError
from app.connectors_registry.lifecycle_schemas import MarketplacePackageInstallRead
from app.connectors_registry.registry_schemas import (
    MarketplaceRegistryConnectionTestResult,
    MarketplaceRegistryCreate,
    MarketplaceRegistryListResponse,
    MarketplaceRegistryRead,
    MarketplaceRegistryUpdate,
    RegistryAcquireInstallRequest,
    RegistryCatalogResponse,
)
from app.connectors_registry.registry_service import (
    acquire_and_install_from_registry,
    browse_all_enabled_registries,
    browse_registry_packages,
    create_registry,
    delete_registry,
    disable_registry,
    get_registry_read,
    list_registries,
    registry_has_installed_packages,
    test_registry_connection,
    update_registry,
)
from app.database import get_db

router = APIRouter(prefix="/registries", tags=["connectors-registry-registries"])

_ERROR_STATUS: dict[str, int] = {
    "REGISTRY_NOT_FOUND": status.HTTP_404_NOT_FOUND,
    "REGISTRY_DISABLED": status.HTTP_409_CONFLICT,
    "REGISTRY_BROWSE_DISABLED": status.HTTP_409_CONFLICT,
    "REGISTRY_INSTALL_DISABLED": status.HTTP_409_CONFLICT,
    "REMOTE_REGISTRY_DISABLED": status.HTTP_409_CONFLICT,
    "REGISTRY_BASE_URL_BLOCKED": status.HTTP_400_BAD_REQUEST,
    "REGISTRY_NETWORK_POLICY_REQUIRED": status.HTTP_400_BAD_REQUEST,
    "PLAINTEXT_REGISTRY_SECRET_FORBIDDEN": status.HTTP_400_BAD_REQUEST,
    "REGISTRY_INVALID": status.HTTP_400_BAD_REQUEST,
    "REGISTRY_UNAVAILABLE": status.HTTP_503_SERVICE_UNAVAILABLE,
    "ACQUISITION_TIMEOUT": status.HTTP_504_GATEWAY_TIMEOUT,
    "DOWNLOAD_SIZE_LIMIT": status.HTTP_400_BAD_REQUEST,
    "REDIRECT_SSRF_BLOCKED": status.HTTP_400_BAD_REQUEST,
    "LOCALHOST_BLOCKED": status.HTTP_400_BAD_REQUEST,
    "LOOPBACK_BLOCKED": status.HTTP_400_BAD_REQUEST,
    "PRIVATE_IP_BLOCKED": status.HTTP_400_BAD_REQUEST,
    "LINK_LOCAL_BLOCKED": status.HTTP_400_BAD_REQUEST,
}


def _http_for(exc: LifecycleError) -> HTTPException:
    code = _ERROR_STATUS.get(exc.error_code, status.HTTP_400_BAD_REQUEST)
    return HTTPException(
        status_code=code,
        detail={
            "error_code": exc.error_code,
            "message": exc.message,
            "details": exc.details,
        },
    )


@router.get("", response_model=MarketplaceRegistryListResponse)
@router.get("/", response_model=MarketplaceRegistryListResponse, include_in_schema=False)
async def get_registries(db: Session = Depends(get_db)) -> MarketplaceRegistryListResponse:
    return list_registries(db)


@router.get("/packages", response_model=RegistryCatalogResponse)
async def get_all_registry_packages(
    q: str | None = None,
    db: Session = Depends(get_db),
) -> RegistryCatalogResponse:
    """Browse packages across all enabled registries."""

    return browse_all_enabled_registries(db, q=q)


@router.get("/{registry_id}", response_model=MarketplaceRegistryRead)
async def get_registry(
    registry_id: str,
    db: Session = Depends(get_db),
) -> MarketplaceRegistryRead:
    try:
        return get_registry_read(db, registry_id)
    except LifecycleError as exc:
        raise _http_for(exc) from exc


@router.post(
    "",
    response_model=MarketplaceRegistryRead,
    status_code=status.HTTP_201_CREATED,
)
@router.post(
    "/",
    response_model=MarketplaceRegistryRead,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
async def post_registry(
    payload: MarketplaceRegistryCreate,
    db: Session = Depends(get_db),
    _admin: str = Depends(require_roles(ROLE_ADMINISTRATOR)),
) -> MarketplaceRegistryRead:
    try:
        return create_registry(db, payload)
    except LifecycleError as exc:
        raise _http_for(exc) from exc


@router.patch("/{registry_id}", response_model=MarketplaceRegistryRead)
async def patch_registry(
    registry_id: str,
    payload: MarketplaceRegistryUpdate,
    db: Session = Depends(get_db),
    _admin: str = Depends(require_roles(ROLE_ADMINISTRATOR)),
) -> MarketplaceRegistryRead:
    try:
        return update_registry(db, registry_id, payload)
    except LifecycleError as exc:
        raise _http_for(exc) from exc


@router.post("/{registry_id}/disable", response_model=MarketplaceRegistryRead)
async def post_disable_registry(
    registry_id: str,
    db: Session = Depends(get_db),
    _admin: str = Depends(require_roles(ROLE_ADMINISTRATOR)),
) -> MarketplaceRegistryRead:
    try:
        return disable_registry(db, registry_id)
    except LifecycleError as exc:
        raise _http_for(exc) from exc


@router.delete("/{registry_id}", response_model=MarketplaceRegistryRead)
async def delete_registry_route(
    registry_id: str,
    db: Session = Depends(get_db),
    _admin: str = Depends(require_roles(ROLE_ADMINISTRATOR)),
) -> MarketplaceRegistryRead:
    """Delete registry config. Never auto-uninstalls packages."""

    try:
        # Touch installed count for audit-friendly response details only.
        _ = registry_has_installed_packages(db, registry_id)
        return delete_registry(db, registry_id)
    except LifecycleError as exc:
        raise _http_for(exc) from exc


@router.post(
    "/{registry_id}/test-connection",
    response_model=MarketplaceRegistryConnectionTestResult,
)
async def post_test_connection(
    registry_id: str,
    db: Session = Depends(get_db),
    _admin: str = Depends(require_roles(ROLE_ADMINISTRATOR)),
) -> MarketplaceRegistryConnectionTestResult:
    try:
        return test_registry_connection(db, registry_id)
    except LifecycleError as exc:
        raise _http_for(exc) from exc


@router.get("/{registry_id}/packages", response_model=RegistryCatalogResponse)
async def get_registry_packages(
    registry_id: str,
    q: str | None = None,
    db: Session = Depends(get_db),
) -> RegistryCatalogResponse:
    try:
        return browse_registry_packages(db, registry_id, q=q)
    except LifecycleError as exc:
        raise _http_for(exc) from exc


@router.post(
    "/{registry_id}/packages/install",
    response_model=MarketplacePackageInstallRead,
    status_code=status.HTTP_201_CREATED,
)
async def post_registry_package_install(
    registry_id: str,
    payload: RegistryAcquireInstallRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> MarketplacePackageInstallRead:
    """Acquire from registry then install via existing lifecycle (no auto streams)."""

    try:
        return acquire_and_install_from_registry(
            db,
            registry_id,
            payload.package_id,
            pack_version=payload.pack_version,
            actor_role=resolve_request_role(request),
        )
    except LifecycleError as exc:
        raise _http_for(exc) from exc
