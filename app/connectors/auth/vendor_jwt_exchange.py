"""Vendor-specific JWT/token exchange then merge access into the resource request."""

from __future__ import annotations

from typing import Any

import httpx

from app.connectors.auth.base import AuthStrategy
from app.connectors.auth_execute import (
    _ExecCtx,
    merge_vendor_access_into_target,
    vendor_jwt_run_token_exchange,
)
from app.connectors.schemas import ConnectorAuthLabResponse
from app.runtime.errors import PreviewRequestError


class VendorJwtExchangeAuthStrategy(AuthStrategy):
    def apply(
        self,
        auth: dict[str, Any],
        headers: dict[str, str],
        params: dict[str, Any],
        *,
        verify_ssl: bool,
        proxy_url: str | None,
        timeout_seconds: float,
        base_url: str,
    ) -> tuple[dict[str, str], dict[str, Any]]:
        ctx = _ExecCtx(auth_type="vendor_jwt_exchange", mode="http_preview", steps=[], path_origin=base_url.rstrip("/"))
        try:
            with httpx.Client(verify=verify_ssl, proxy=proxy_url, timeout=timeout_seconds) as client:
                out = vendor_jwt_run_token_exchange(client, ctx, auth, base_url.rstrip("/"))
        except Exception as exc:
            raise PreviewRequestError(400, {"error_type": "vendor_jwt_exchange_failed", "message": str(exc)}) from exc

        if isinstance(out, ConnectorAuthLabResponse):
            code = str(out.error_code or "vendor_jwt_exchange_failed").upper()
            msg = str(out.message or "vendor_jwt_exchange_failed")
            if code == "TOKEN_EXTRACTION_FAILED":
                raise PreviewRequestError(400, {"error_type": "token_extraction_failed", "message": msg})
            if code == "TOKEN_PARSE_ERROR":
                raise PreviewRequestError(400, {"error_type": "vendor_jwt_exchange_failed", "message": msg})
            raise PreviewRequestError(400, {"error_type": "vendor_jwt_exchange_failed", "message": msg})

        access_token = str(out)
        merged_h, merged_p = merge_vendor_access_into_target(auth, access_token, headers, params)
        return merged_h, merged_p
