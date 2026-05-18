from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def test_release_install_does_not_generate_or_persist_admin_password() -> None:
    text = _read("scripts/release/install.sh")
    forbidden = (
        "INSTALL_GENERATED_ADMIN_PW",
        "generated_admin",
        "Gdc{secrets.token_urlsafe",
        'upsert_key("GDC_SEED_ADMIN_PASSWORD"',
        "auto-generated during this install",
        "Save this password now",
        "Password: ${INSTALL_",
    )
    for needle in forbidden:
        assert needle not in text
    assert "Password: admin" in text
    assert "Password: (custom value from GDC_SEED_ADMIN_PASSWORD; not shown)" in text
    assert "must_change_password=true" in text


def test_install_scripts_do_not_generate_gdc_seed_admin_password() -> None:
    install_scripts = [
        ROOT / "scripts/release/install.sh",
        ROOT / "scripts/install-docker-ubuntu2404.sh",
        ROOT / "bootstrap.sh",
    ]
    forbidden_fragments = (
        "GDC_SEED_ADMIN_PASSWORD=$(openssl",
        "GDC_SEED_ADMIN_PASSWORD=\"$(openssl",
        "GDC_SEED_ADMIN_PASSWORD=$(python",
        "GDC_SEED_ADMIN_PASSWORD=\"$(python",
        "upsert_key(\"GDC_SEED_ADMIN_PASSWORD\"",
        "generated_admin",
        "INSTALL_GENERATED_ADMIN_PW",
    )
    for path in install_scripts:
        text = path.read_text(encoding="utf-8")
        for needle in forbidden_fragments:
            assert needle not in text, f"{needle!r} found in {path.relative_to(ROOT)}"


def test_env_example_documents_fixed_bootstrap_contract() -> None:
    text = _read(".env.example")
    assert "first install creates admin/admin" in text
    assert "do not\n# generate or persist random administrator passwords" in text
    assert "# GDC_SEED_ADMIN_PASSWORD=" in text
    assert "\nGDC_SEED_ADMIN_PASSWORD=" not in text
    assert "Stellar1!" not in text
