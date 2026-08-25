"""Git HTTPS package acquisition with SSRF controls (M29.9).

Accepts an HTTPS URL to a ``.tar.gz`` package archive (for example a GitHub
release asset or raw package URL). Does not implement arbitrary git clone /
protocol handlers. Acquired bytes always flow through existing lifecycle install.
"""

from __future__ import annotations

from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

import httpx
from sqlalchemy.orm import Session

from app.connectors_registry.acquisition_url_policy import NetworkAcquisitionPolicyConfig
from app.connectors_registry.lifecycle_errors import LifecycleError
from app.connectors_registry.lifecycle_models import LIFECYCLE_ORIGIN_GIT
from app.connectors_registry.lifecycle_schemas import MarketplacePackageInstallRead
from app.connectors_registry.lifecycle_service import install_package
from app.connectors_registry.secure_fetch import (
    DEFAULT_MAX_DOWNLOAD_BYTES,
    DEFAULT_TIMEOUT_SECONDS,
    SecureFetchError,
    secure_http_get,
)


def install_package_from_git_url(
    db: Session,
    url: str,
    *,
    actor_role: str,
    network_policy: dict | None = None,
    resolver: Callable[[str], list[str]] | None = None,
    transport: httpx.BaseTransport | None = None,
    builtin_root: Path | None = None,
    installed_root: Path | None = None,
) -> MarketplacePackageInstallRead:
    """Acquire a package archive from an HTTPS Git/release URL and install it."""

    text = (url or "").strip()
    if not text:
        raise LifecycleError("git package URL is required", error_code="GIT_URL_REQUIRED")

    parsed = urlparse(text)
    path = (parsed.path or "").lower()
    if not (path.endswith(".tar.gz") or path.endswith(".tgz")):
        raise LifecycleError(
            "git acquisition accepts HTTPS URLs to .tar.gz / .tgz package archives only",
            error_code="GIT_URL_UNSUPPORTED",
            details={"url": text},
        )

    policy = dict(network_policy or {})
    hosts = frozenset(str(h).strip() for h in (policy.get("allowed_hosts") or []) if str(h).strip())
    cfg = NetworkAcquisitionPolicyConfig(
        allowed_hosts=hosts,
        allow_http=bool(policy.get("allow_http", False)),
        allow_private_for_allowlisted_hosts=bool(policy.get("allow_private_networks", False))
        and bool(hosts),
    )
    timeout = float(policy.get("timeout_seconds") or DEFAULT_TIMEOUT_SECONDS)
    max_bytes = int(policy.get("max_download_bytes") or DEFAULT_MAX_DOWNLOAD_BYTES)

    try:
        result = secure_http_get(
            text,
            config=cfg,
            resolver=resolver,
            timeout_seconds=timeout,
            max_bytes=max_bytes,
            transport=transport,
        )
    except SecureFetchError as exc:
        raise LifecycleError(
            exc.message,
            error_code=exc.error_code,
            details=exc.details,
        ) from exc

    return install_package(
        db,
        result.content,
        actor_role=actor_role,
        origin=LIFECYCLE_ORIGIN_GIT,
        require_valid_signature=False,
        enforce_license_deny=True,
        builtin_root=builtin_root,
        installed_root=installed_root,
    )
