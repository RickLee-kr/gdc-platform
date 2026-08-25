"""Offline signed package bundle import (M29.9).

Air-gapped path:

```text
Offline Bundle → Archive Safety → Digest → Signature → License → Validator → Install
```

Reuses existing upload staging / lifecycle install. Signature must be VALID;
unsigned offline bundles are rejected.
"""

from __future__ import annotations

from pathlib import Path
from typing import BinaryIO

from sqlalchemy.orm import Session

from app.connectors_registry.lifecycle_models import LIFECYCLE_ORIGIN_OFFLINE_BUNDLE
from app.connectors_registry.lifecycle_schemas import MarketplacePackageInstallRead
from app.connectors_registry.lifecycle_service import install_package


def install_offline_signed_bundle(
    db: Session,
    archive: bytes | BinaryIO,
    *,
    actor_role: str,
    builtin_root: Path | None = None,
    installed_root: Path | None = None,
) -> MarketplacePackageInstallRead:
    """Install an offline signed ``.tar.gz`` bundle via existing lifecycle."""

    return install_package(
        db,
        archive,
        actor_role=actor_role,
        origin=LIFECYCLE_ORIGIN_OFFLINE_BUNDLE,
        require_valid_signature=True,
        enforce_license_deny=True,
        builtin_root=builtin_root,
        installed_root=installed_root,
    )
