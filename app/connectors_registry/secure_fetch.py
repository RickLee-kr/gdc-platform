"""SSRF-safe HTTP acquisition for Marketplace remote/Git downloads (M29.9).

Applies M29.5B acquisition URL policy before every request and revalidates
redirect targets from scratch. Does not execute packages.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Mapping, Sequence
from urllib.parse import urljoin, urlparse

import httpx

from app.connectors_registry.acquisition_url_policy import (
    AcquisitionUrlPolicyError,
    DnsResolver,
    NetworkAcquisitionPolicyConfig,
    default_dns_resolver,
    validate_redirect_target,
    validate_url_with_dns,
)
from app.connectors_registry.lifecycle_errors import LifecycleError
from app.http.outbound_httpx_timeout import outbound_httpx_timeout

DEFAULT_TIMEOUT_SECONDS = 30.0
DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024  # 5 MiB JSON/metadata
DEFAULT_MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024  # 100 MiB package archives
MAX_REDIRECTS = 5


@dataclass(frozen=True)
class SecureFetchResult:
    """Successful SSRF-safe HTTP GET."""

    url: str
    status_code: int
    content: bytes
    content_type: str | None
    final_url: str


class SecureFetchError(LifecycleError):
    """Raised when a secure fetch is blocked or fails."""


def _as_lifecycle(exc: AcquisitionUrlPolicyError) -> SecureFetchError:
    return SecureFetchError(
        exc.message,
        error_code=exc.code,
        details={"policy_code": exc.code},
    )


def network_policy_from_dict(
    raw: Mapping[str, object] | None,
    *,
    private_registry: bool = False,
) -> tuple[NetworkAcquisitionPolicyConfig, float, int, int]:
    """Build acquisition config + limits from a registry network_policy JSON."""

    data = dict(raw or {})
    allowed_hosts_raw = data.get("allowed_hosts") or data.get("host_allowlist") or []
    if isinstance(allowed_hosts_raw, str):
        hosts = frozenset(h.strip() for h in allowed_hosts_raw.split(",") if h.strip())
    elif isinstance(allowed_hosts_raw, (list, tuple, set, frozenset)):
        hosts = frozenset(str(h).strip() for h in allowed_hosts_raw if str(h).strip())
    else:
        hosts = frozenset()

    allow_http = bool(data.get("allow_http", False))
    allow_private = bool(
        data.get("allow_private_networks", False)
        or data.get("allow_private_for_allowlisted_hosts", False)
        or (private_registry and hosts)
    )
    # Private registries with an allowlist may reach internal hosts; remote
    # public registries never waive private-IP blocks by default.
    if not private_registry:
        allow_private = bool(data.get("allow_private_for_allowlisted_hosts", False)) and bool(hosts)

    ports_raw = data.get("allowed_ports") or []
    if isinstance(ports_raw, (list, tuple, set, frozenset)):
        ports = frozenset(int(p) for p in ports_raw)
    else:
        ports = frozenset()

    cfg = NetworkAcquisitionPolicyConfig(
        allowed_hosts=hosts,
        allowed_ports=ports,
        allow_http=allow_http,
        allow_private_for_allowlisted_hosts=allow_private and bool(hosts),
    )
    timeout = float(data.get("timeout_seconds") or DEFAULT_TIMEOUT_SECONDS)
    max_response = int(data.get("max_response_bytes") or DEFAULT_MAX_RESPONSE_BYTES)
    max_download = int(data.get("max_download_bytes") or DEFAULT_MAX_DOWNLOAD_BYTES)
    return cfg, timeout, max_response, max_download


def secure_http_get(
    url: str,
    *,
    config: NetworkAcquisitionPolicyConfig | None = None,
    resolver: DnsResolver | None = None,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    max_bytes: int = DEFAULT_MAX_RESPONSE_BYTES,
    headers: Mapping[str, str] | None = None,
    transport: httpx.BaseTransport | None = None,
    client_factory: Callable[..., httpx.Client] | None = None,
) -> SecureFetchResult:
    """GET ``url`` with SSRF policy, redirect revalidation, timeout, and size limit.

    ``transport`` / ``client_factory`` are injectable for tests (MockTransport).
    """

    cfg = config or NetworkAcquisitionPolicyConfig()
    resolve = resolver or default_dns_resolver
    current = url.strip()
    hdrs = dict(headers or {})
    seen: set[str] = set()

    timeout = outbound_httpx_timeout(timeout_seconds)

    def _open_client() -> httpx.Client:
        if client_factory is not None:
            return client_factory(timeout=timeout, follow_redirects=False, transport=transport)
        kwargs: dict[str, object] = {"timeout": timeout, "follow_redirects": False}
        if transport is not None:
            kwargs["transport"] = transport
        return httpx.Client(**kwargs)

    try:
        with _open_client() as client:
            for _ in range(MAX_REDIRECTS + 1):
                if current in seen:
                    raise SecureFetchError(
                        "redirect loop detected",
                        error_code="REDIRECT_LOOP",
                        details={"url": current},
                    )
                seen.add(current)

                try:
                    url_result, approved = validate_url_with_dns(
                        current, config=cfg, resolver=resolve
                    )
                except AcquisitionUrlPolicyError as exc:
                    raise _as_lifecycle(exc) from exc

                try:
                    response = client.get(current, headers=hdrs)
                except httpx.TimeoutException as exc:
                    raise SecureFetchError(
                        f"acquisition request timed out after {timeout_seconds}s",
                        error_code="ACQUISITION_TIMEOUT",
                        details={"url": current, "timeout_seconds": timeout_seconds},
                    ) from exc
                except httpx.HTTPError as exc:
                    raise SecureFetchError(
                        f"acquisition request failed: {exc}",
                        error_code="ACQUISITION_NETWORK_ERROR",
                        details={"url": current},
                    ) from exc

                if response.is_redirect or response.status_code in {301, 302, 303, 307, 308}:
                    location = response.headers.get("location")
                    if not location:
                        raise SecureFetchError(
                            "redirect response missing Location header",
                            error_code="REDIRECT_INVALID",
                            details={"url": current, "status_code": response.status_code},
                        )
                    next_url = urljoin(current, location)
                    try:
                        # Revalidate from scratch (do not trust prior host).
                        validate_redirect_target(next_url, config=cfg)
                        validate_url_with_dns(next_url, config=cfg, resolver=resolve)
                    except AcquisitionUrlPolicyError as exc:
                        raise SecureFetchError(
                            f"redirect target blocked ({exc.code}): {exc.message}",
                            error_code="REDIRECT_SSRF_BLOCKED",
                            details={
                                "from_url": current,
                                "to_url": next_url,
                                "policy_code": exc.code,
                            },
                        ) from exc
                    current = next_url
                    continue

                content_length = response.headers.get("content-length")
                if content_length is not None:
                    try:
                        declared = int(content_length)
                    except ValueError:
                        declared = -1
                    if declared > max_bytes:
                        raise SecureFetchError(
                            f"response Content-Length {declared} exceeds limit {max_bytes}",
                            error_code="DOWNLOAD_SIZE_LIMIT",
                            details={"max_bytes": max_bytes, "content_length": declared},
                        )

                # Stream with hard size cap (do not trust Content-Length alone).
                chunks: list[bytes] = []
                total = 0
                try:
                    for chunk in response.iter_bytes():
                        if not chunk:
                            continue
                        total += len(chunk)
                        if total > max_bytes:
                            raise SecureFetchError(
                                f"response body exceeds download size limit ({max_bytes} bytes)",
                                error_code="DOWNLOAD_SIZE_LIMIT",
                                details={"max_bytes": max_bytes, "received_bytes": total},
                            )
                        chunks.append(chunk)
                except SecureFetchError:
                    raise
                except httpx.TimeoutException as exc:
                    raise SecureFetchError(
                        f"acquisition read timed out after {timeout_seconds}s",
                        error_code="ACQUISITION_TIMEOUT",
                        details={"url": current, "timeout_seconds": timeout_seconds},
                    ) from exc

                body = b"".join(chunks)
                if response.status_code >= 400:
                    raise SecureFetchError(
                        f"acquisition HTTP {response.status_code}",
                        error_code="ACQUISITION_HTTP_ERROR",
                        details={
                            "url": current,
                            "status_code": response.status_code,
                            "approved_addresses": list(approved),
                            "hostname": url_result.hostname,
                        },
                    )

                return SecureFetchResult(
                    url=url,
                    status_code=response.status_code,
                    content=body,
                    content_type=response.headers.get("content-type"),
                    final_url=str(response.url) if response.url else current,
                )

            raise SecureFetchError(
                f"too many redirects (max {MAX_REDIRECTS})",
                error_code="REDIRECT_LIMIT",
                details={"url": url},
            )
    except SecureFetchError:
        raise
    except AcquisitionUrlPolicyError as exc:
        raise _as_lifecycle(exc) from exc


def join_registry_url(base_url: str, *parts: str) -> str:
    """Join registry base URL with path segments (no open redirect)."""

    base = base_url.rstrip("/") + "/"
    path = "/".join(p.strip("/") for p in parts if p is not None and str(p).strip())
    return urljoin(base, path)


def hostname_of(url: str) -> str | None:
    try:
        return urlparse(url).hostname
    except ValueError:
        return None


__all__ = [
    "DEFAULT_MAX_DOWNLOAD_BYTES",
    "DEFAULT_MAX_RESPONSE_BYTES",
    "DEFAULT_TIMEOUT_SECONDS",
    "SecureFetchError",
    "SecureFetchResult",
    "join_registry_url",
    "network_policy_from_dict",
    "secure_http_get",
]
