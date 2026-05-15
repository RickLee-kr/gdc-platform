"""Generate self-signed TLS material for local HTTPS (reverse proxy reload to apply)."""

from __future__ import annotations

import ipaddress
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import load_pem_private_key
from cryptography.x509.oid import NameOID


def _parse_ip_san(value: str) -> x509.IPAddress:
    return x509.IPAddress(ipaddress.ip_address(value.strip()))


def _parse_dns_san(value: str) -> x509.DNSName:
    host = value.strip().lower()
    if not host or len(host) > 253:
        raise ValueError("invalid DNS name in SAN list")
    return x509.DNSName(host)


def backup_tls_pem_files(cert_path: Path, key_path: Path) -> None:
    """Copy existing PEM material into ``<cert-dir>/backups`` before overwrite."""

    if not cert_path.exists() and not key_path.exists():
        return
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    bak_dir = cert_path.parent / "backups"
    bak_dir.mkdir(parents=True, exist_ok=True)
    for src in (cert_path, key_path):
        if src.exists():
            dest = bak_dir / f"{src.name}.{ts}"
            shutil.copy2(src, dest)


def read_certificate_not_after_pem(cert_path: Path) -> datetime | None:
    """Return certificate ``not_valid_after`` (UTC) from a PEM file, or ``None`` on failure."""

    if not cert_path.is_file():
        return None
    try:
        cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
    except Exception:
        return None
    na = cert.not_valid_after
    if na.tzinfo is None:
        return na.replace(tzinfo=timezone.utc)
    return na.astimezone(timezone.utc)


def verify_tls_pem_pair(cert_path: Path, key_path: Path) -> tuple[bool, str]:
    """Return ``(ok, message)`` after a lightweight PEM parse of cert + private key."""

    try:
        x509.load_pem_x509_certificate(cert_path.read_bytes())
        load_pem_private_key(key_path.read_bytes(), password=None)
    except Exception as exc:
        return False, str(exc)
    return True, ""


def generate_self_signed_certificate(
    *,
    ip_sans: list[str],
    dns_sans: list[str],
    valid_days: int,
    cert_path: Path,
    key_path: Path,
) -> datetime:
    """Write PEM certificate and private key; return certificate ``not_valid_after`` (UTC)."""

    cert_path.parent.mkdir(parents=True, exist_ok=True)
    key_path.parent.mkdir(parents=True, exist_ok=True)

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject_cn = (dns_sans[0] if dns_sans else None) or (ip_sans[0] if ip_sans else None) or "gdc-local"
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, subject_cn)])

    san_entries: list[x509.GeneralName] = []
    for raw in dns_sans:
        san_entries.append(_parse_dns_san(raw))
    for raw in ip_sans:
        san_entries.append(_parse_ip_san(raw))

    now = datetime.now(timezone.utc)
    builder = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(days=valid_days))
        .add_extension(x509.SubjectAlternativeName(san_entries), critical=False)
    )
    cert = builder.sign(key, hashes.SHA256())

    cert_pem = cert.public_bytes(serialization.Encoding.PEM)
    key_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    cert_path.write_bytes(cert_pem)
    key_path.write_bytes(key_pem)

    na = cert.not_valid_after
    if na.tzinfo is None:
        return na.replace(tzinfo=timezone.utc)
    return na.astimezone(timezone.utc)
