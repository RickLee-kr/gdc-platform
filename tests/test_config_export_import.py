from __future__ import annotations

import importlib.util
from pathlib import Path

from sqlalchemy.orm import Session

from app.connectors.models import Connector
from app.sources.models import Source


def _load_export_module():
    root = Path(__file__).resolve().parents[1]
    path = root / "scripts" / "export_config.py"
    spec = importlib.util.spec_from_file_location("gdc_export_config", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_export_config_structure(db_session: Session) -> None:
    mod = _load_export_module()
    payload = mod.export_config(db_session)
    assert payload["version"] == 1
    for key in (
        "connectors",
        "sources",
        "streams",
        "mappings",
        "enrichments",
        "destinations",
        "routes",
        "checkpoints",
    ):
        assert key in payload
        assert isinstance(payload[key], list)


def test_import_skips_existing_ids(db_session: Session) -> None:
    c = Connector(name="imp-c", description=None, status="STOPPED")
    db_session.add(c)
    db_session.flush()
    s = Source(
        connector_id=c.id,
        source_type="HTTP_API_POLLING",
        config_json={"base_url": "https://x.example"},
        auth_json={},
        enabled=True,
    )
    db_session.add(s)
    db_session.commit()

    mod_imp = importlib.util.spec_from_file_location(
        "gdc_import_config",
        Path(__file__).resolve().parents[1] / "scripts" / "import_config.py",
    )
    assert mod_imp and mod_imp.loader
    imp = importlib.util.module_from_spec(mod_imp)
    mod_imp.loader.exec_module(imp)

    bundle = {
        "connectors": [{"id": c.id, "name": "other", "description": None, "status": "RUNNING", "created_at": None, "updated_at": None}],
        "sources": [],
        "streams": [],
        "mappings": [],
        "enrichments": [],
        "destinations": [],
        "routes": [],
        "checkpoints": [],
    }
    stats = imp.import_bundle(db_session, bundle)
    assert stats["skipped"] >= 1
    row = db_session.get(Connector, c.id)
    assert row is not None
    assert row.name == "imp-c"


def test_export_validation_detects_plaintext_bearer_token() -> None:
    from app.backup.export_validation import verify_export_masking

    leaked = {"sources": [{"auth_json": {"bearer_token": "secret-exposed"}}]}
    issues = verify_export_masking(leaked)
    assert issues


def test_export_validation_accepts_masked_bearer_token() -> None:
    from app.backup.export_validation import verify_export_masking

    masked = {"sources": [{"auth_json": {"bearer_token": "********"}}]}
    assert verify_export_masking(masked) == []
