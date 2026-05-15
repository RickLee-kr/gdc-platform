"""Normalize connector Source auth fields into the runtime auth dict shape."""

from __future__ import annotations

from typing import Any


def _lookup(cfg: dict[str, Any], keys: list[str], default: Any = None) -> Any:
    for key in keys:
        if key in cfg and cfg[key] is not None:
            return cfg[key]
    return default


def normalize_connector_auth(source_config: dict[str, Any]) -> dict[str, Any]:
    """Merge nested ``auth`` block with flat keys and normalize auth_type (uppercase)."""

    auth_nested = source_config.get("auth")
    if isinstance(auth_nested, dict):
        merged = {**source_config, **auth_nested}
    else:
        merged = dict(source_config)

    auth_type = str(_lookup(merged, ["auth_type", "type"], "NO_AUTH")).strip().upper()
    sle_raw = _lookup(merged, ["session_login_extractions"], None)
    session_login_extractions = sle_raw if isinstance(sle_raw, list) else []
    lqp_raw = _lookup(merged, ["login_query_params", "login_query"], None)
    login_query_params = lqp_raw if isinstance(lqp_raw, dict) else {}
    return {
        "auth_type": auth_type,
        "username": _lookup(merged, ["basic_username", "username"]),
        "password": _lookup(merged, ["basic_password", "password"]),
        "token": _lookup(merged, ["bearer_token", "token"]),
        "api_key_name": _lookup(merged, ["api_key_name", "key_name"]),
        "api_key_value": _lookup(merged, ["api_key_value", "key_value"]),
        "api_key_location": str(_lookup(merged, ["api_key_location", "location"], "headers")).lower(),
        "oauth2_client_id": _lookup(merged, ["oauth2_client_id", "oauth_client_id", "client_id"]),
        "oauth2_client_secret": _lookup(merged, ["oauth2_client_secret", "oauth_client_secret", "client_secret"]),
        "client_id": _lookup(merged, ["oauth2_client_id", "oauth_client_id", "client_id"]),
        "client_secret": _lookup(merged, ["oauth2_client_secret", "oauth_client_secret", "client_secret"]),
        "oauth2_token_url": _lookup(merged, ["oauth2_token_url", "oauth_token_url"]),
        "scope": _lookup(merged, ["oauth2_scope", "oauth_scope", "scope"]),
        "login_url": _lookup(merged, ["login_url"]),
        "login_path": _lookup(merged, ["login_path"]),
        "login_method": str(_lookup(merged, ["login_method"], "POST")).upper(),
        "login_headers": _lookup(merged, ["login_headers"], {}) or {},
        "login_body_template": _lookup(merged, ["login_body_template"], {}) or {},
        "login_body_mode": _lookup(merged, ["login_body_mode"]),
        "login_body_raw": _lookup(merged, ["login_body_raw"]),
        "login_allow_redirects": _lookup(merged, ["login_allow_redirects"]),
        "session_cookie_name": _lookup(merged, ["session_cookie_name"]),
        "session_login_body_style": _lookup(merged, ["session_login_body_style"]),
        "login_username": _lookup(merged, ["login_username"]),
        "login_password": _lookup(merged, ["login_password"]),
        "refresh_token": _lookup(merged, ["refresh_token"]),
        "refresh_token_header_name": _lookup(merged, ["refresh_token_header_name"], "Authorization"),
        "refresh_token_header_prefix": _lookup(merged, ["refresh_token_header_prefix"], "Bearer"),
        "token_path": _lookup(merged, ["token_path"]),
        "token_http_method": str(_lookup(merged, ["token_http_method"], "POST")).upper(),
        "access_token_json_path": _lookup(merged, ["access_token_json_path"], "$.access_token"),
        "access_token_header_name": _lookup(merged, ["access_token_header_name"], "Authorization"),
        "access_token_header_prefix": _lookup(merged, ["access_token_header_prefix"], "Bearer"),
        "user_id": _lookup(merged, ["user_id"]),
        "api_key": _lookup(merged, ["api_key"]),
        "basic_password": _lookup(merged, ["basic_password"]),
        "token_method": str(_lookup(merged, ["token_method"], "POST")).upper(),
        "token_auth_mode": str(_lookup(merged, ["token_auth_mode"], "basic_user_api_key")).lower(),
        "token_content_type": _lookup(merged, ["token_content_type"], None),
        "token_body_mode": str(_lookup(merged, ["token_body_mode"], "empty")).lower(),
        "token_body": _lookup(merged, ["token_body"]),
        "access_token_injection": str(_lookup(merged, ["access_token_injection"], "bearer_authorization")).lower(),
        "access_token_query_name": _lookup(merged, ["access_token_query_name"]),
        "token_custom_headers": _lookup(merged, ["token_custom_headers"], {}) or {},
        "token_url": _lookup(merged, ["token_url"]),
        "preflight_enabled": _lookup(merged, ["preflight_enabled"]),
        "preflight_method": _lookup(merged, ["preflight_method"]),
        "preflight_path": _lookup(merged, ["preflight_path"]),
        "preflight_url": _lookup(merged, ["preflight_url"]),
        "preflight_headers": _lookup(merged, ["preflight_headers"], {}) or {},
        "preflight_body_raw": _lookup(merged, ["preflight_body_raw"]),
        "preflight_follow_redirects": _lookup(merged, ["preflight_follow_redirects"]),
        "login_query_params": login_query_params,
        "session_login_extractions": session_login_extractions,
        "csrf_extract": _lookup(merged, ["csrf_extract"]),
    }
