"""Shared HTTP session-login helpers for Auth Lab, connector auth probe, and HTTP polling.

Vendor-specific login flows stay out of StreamRunner; this module centralizes request shaping
and login-response validation (including Cybereason-style form POST + redirect handling).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs, unquote, urlencode, urlparse, parse_qsl, urlunparse

from app.connectors.session_login_template import (
    SessionLoginRenderContext,
    mask_extracted_variables,
    mask_template_preview,
    render_json_values,
    render_session_login_template,
    run_session_login_extractions,
)
from app.security.secrets import mask_http_headers


def merge_str_headers(*parts: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for part in parts:
        if not part:
            continue
        for k, v in part.items():
            out[str(k)] = str(v)
    return out


_WARN_LOGIN_URL_PATH_AND_LOGIN_PATH = (
    "login_url includes a non-root path and login_path is also set; "
    "resolved using scheme and host from login_url with login_path as the request path "
    "(prefer a scheme+host-only login_url when using login_path)."
)


def resolve_session_login_url_with_warnings(auth_cfg: dict[str, Any], path_origin: str) -> tuple[str, list[str]]:
    """Resolve login URL from login_url + login_path + connector base path_origin.

    Rules:
    - If login_url is an absolute http(s) URL and login_path is set: use scheme+host from login_url and append login_path.
    - If login_url is absolute and login_path is empty: use login_url as-is.
    - If login_url already contains a non-root path and login_path is also set: append a warning (still resolves to host + login_path).
    - If only login_path is set: join path_origin + login_path.
    """

    warnings: list[str] = []
    lu = str(auth_cfg.get("login_url") or "").strip()
    lp_raw = str(auth_cfg.get("login_path") or "").strip()
    lp = ""
    if lp_raw:
        lp = lp_raw if lp_raw.startswith("/") else f"/{lp_raw}"

    if not lu and not lp:
        return "", warnings

    if lu:
        parsed = urlparse(lu)
        if parsed.scheme in ("http", "https") and parsed.netloc:
            existing = (parsed.path or "").rstrip("/")
            if lp:
                if existing:
                    warnings.append(_WARN_LOGIN_URL_PATH_AND_LOGIN_PATH)
                out = urlunparse((parsed.scheme, parsed.netloc, lp, "", "", ""))
                return out, warnings
            return lu, warnings

        if lu.startswith("/") and path_origin:
            return f"{path_origin.rstrip('/')}{lu}", warnings
        return lu, warnings

    return f"{path_origin.rstrip('/')}{lp}", warnings


def resolve_session_login_url(auth_cfg: dict[str, Any], path_origin: str) -> str:
    url, _w = resolve_session_login_url_with_warnings(auth_cfg, path_origin)
    return url


def resolve_preflight_url(auth_cfg: dict[str, Any], path_origin: str) -> str:
    pu = str(auth_cfg.get("preflight_url") or "").strip()
    if pu:
        return pu
    pp = str(auth_cfg.get("preflight_path") or "").strip()
    if not pp:
        return ""
    path = pp if pp.startswith("/") else f"/{pp}"
    return f"{path_origin.rstrip('/')}{path}"


def normalize_login_body_mode(auth_cfg: dict[str, Any]) -> str:
    raw = str(auth_cfg.get("login_body_mode") or "").strip().lower()
    if raw in {"json", "form_urlencoded", "raw"}:
        return raw
    return "json"


def login_allow_redirects_value(auth_cfg: dict[str, Any]) -> bool:
    """Explicit True follows redirects; missing or None defaults to False."""

    v = auth_cfg.get("login_allow_redirects")
    if v is None:
        return False
    return bool(v)


def preflight_follow_redirects_value(auth_cfg: dict[str, Any]) -> bool:
    v = auth_cfg.get("preflight_follow_redirects")
    if v is None:
        return False
    return bool(v)


def _lower_url(u: str) -> str:
    return (u or "").strip().lower()


def url_indicates_login_failure(url: str) -> bool:
    """Detect obvious login failure URLs (e.g. Cybereason ``login.html?error`` redirects)."""

    if not url:
        return False
    u = url.strip()
    lu = _lower_url(u)
    parsed = urlparse(u)
    qs = parse_qs(parsed.query)
    if "error" in qs:
        return True
    if "login.html" in lu and "error" in lu:
        return True
    if "?error" in lu or "&error" in lu:
        return True
    return False


def redirect_location_suggests_failed_login(location: str) -> bool:
    """Heuristic: redirects back onto vendor login pages usually mean auth failed."""

    if url_indicates_login_failure(location):
        return True
    loc = _lower_url(unquote(location))
    if not loc:
        return False
    if "login.html" in loc:
        return True
    path = urlparse(loc).path
    pl = path.rstrip("/").lower()
    if pl.endswith("/login") or pl.endswith("/signin") or pl.endswith("/sign-in"):
        return True
    return False


def redirect_chain_suggests_login_loop(resp: Any) -> bool:
    """Detect repeated redirects through login/auth URLs (simple heuristic)."""

    try:
        hist = getattr(resp, "history", None) or []
        urls = [str(r.url) for r in hist] + [str(resp.url)]
    except Exception:
        return False
    if len(urls) < 2:
        return False
    login_hits = sum(1 for u in urls if "login" in _lower_url(u))
    return login_hits >= 2


def cookies_dict_from_client(client: Any) -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        jar = getattr(client, "cookies", None)
        if jar is None:
            return out
        cj = getattr(jar, "jar", None)
        if cj is not None:
            for c in cj:
                try:
                    out[str(c.name)] = str(c.value)
                except Exception:
                    continue
        else:
            keys_fn = getattr(jar, "keys", None)
            if callable(keys_fn):
                for name in keys_fn():
                    try:
                        gv = jar.get(name)
                        if gv is not None:
                            out[str(name)] = str(gv)
                    except Exception:
                        continue
    except Exception:
        pass
    return out


def headers_dict_from_response(resp: Any) -> dict[str, str]:
    try:
        return {str(k): str(v) for k, v in resp.headers.items()}
    except Exception:
        return {}


def merge_rendered_query_params(url: str, params: dict[str, str], ctx: SessionLoginRenderContext) -> str:
    """Append/replace query parameters with template-rendered values."""

    if not params:
        return url
    rendered = {str(k): render_session_login_template(str(v), ctx) for k, v in params.items()}
    parsed = urlparse(url)
    existing = list(parse_qsl(parsed.query, keep_blank_values=True))
    merged: dict[str, str] = {k: v for k, v in existing}
    merged.update(rendered)
    new_query = urlencode(list(merged.items()))
    return urlunparse(parsed._replace(query=new_query))


def build_session_login_json_body(auth_cfg: dict[str, Any], ctx: SessionLoginRenderContext) -> dict[str, Any]:
    """JSON login body (legacy session_login_body_style + login_body_template)."""

    user = ctx.username
    pw = ctx.password
    style = str(auth_cfg.get("session_login_body_style") or "plain").lower()
    if style in {"cybereason_wrapped", "cybereason"}:
        login_json: dict[str, Any] = {"data": json.dumps({"username": user, "password": pw})}
    else:
        login_json = {"username": user, "password": pw}
    tmpl = auth_cfg.get("login_body_template")
    if isinstance(tmpl, dict) and tmpl:
        cloned: Any = json.loads(json.dumps(tmpl))
        login_json = render_json_values(cloned, ctx)
    return login_json


def build_session_login_request_parts(
    auth_cfg: dict[str, Any],
    path_origin: str,
    *,
    render_ctx: SessionLoginRenderContext | None = None,
) -> tuple[str, str, dict[str, str], dict[str, Any], str, list[str]]:
    """Return method, url, headers, httpx_kw (one of json/data/content), body_mode label, URL warnings."""

    login_url, url_warnings = resolve_session_login_url_with_warnings(auth_cfg, path_origin)
    login_method = str(auth_cfg.get("login_method") or "POST").upper()
    user = str(auth_cfg.get("login_username") or "")
    pw = str(auth_cfg.get("login_password") or "")
    mode = normalize_login_body_mode(auth_cfg)

    ctx = render_ctx or SessionLoginRenderContext(username=user, password=pw)

    login_headers_raw = auth_cfg.get("login_headers")
    hdrs = merge_str_headers(login_headers_raw if isinstance(login_headers_raw, dict) else {})
    hdrs = {str(k): render_session_login_template(str(v), ctx) for k, v in hdrs.items()}

    qp_raw = auth_cfg.get("login_query_params")
    if qp_raw is None:
        qp_raw = auth_cfg.get("login_query")
    if isinstance(qp_raw, dict) and qp_raw:
        qflat = {str(k): str(v) for k, v in qp_raw.items() if v is not None}
        login_url = merge_rendered_query_params(login_url, qflat, ctx)

    if mode == "form_urlencoded":
        hdrs.setdefault("Content-Type", "application/x-www-form-urlencoded")
        raw_tmpl = str(auth_cfg.get("login_body_raw") or "").strip()
        if raw_tmpl:
            body_str = render_session_login_template(raw_tmpl, ctx)
            return login_method, login_url, hdrs, {"data": body_str}, mode, url_warnings
        tmpl = auth_cfg.get("login_body_template")
        if isinstance(tmpl, dict) and tmpl:
            pairs: dict[str, str] = {}
            for k, val in tmpl.items():
                sv = render_session_login_template(str(val), ctx)
                pairs[str(k)] = sv
            body_str = urlencode(pairs)
            return login_method, login_url, hdrs, {"data": body_str}, mode, url_warnings
        body_str = urlencode({"username": user, "password": pw})
        return login_method, login_url, hdrs, {"data": body_str}, mode, url_warnings

    if mode == "raw":
        raw_tmpl = str(auth_cfg.get("login_body_raw") or "")
        body = render_session_login_template(raw_tmpl, ctx)
        if not hdrs.get("Content-Type") and not hdrs.get("content-type"):
            hdrs.setdefault("Content-Type", "application/octet-stream")
        return login_method, login_url, hdrs, {"content": body.encode("utf-8")}, mode, url_warnings

    hdrs.setdefault("Content-Type", "application/json")
    login_json = build_session_login_json_body(auth_cfg, ctx)
    return login_method, login_url, hdrs, {"json": login_json}, mode, url_warnings


def classify_session_login_http_response(resp: Any) -> tuple[bool, str]:
    """Return (ok, reason) — ok True means HTTP-level login is not an obvious failure (probe still required)."""

    if redirect_chain_suggests_login_loop(resp):
        return False, "redirect_chain_suggests_repeated_login_or_auth_redirects"

    final_url = str(resp.url)
    if url_indicates_login_failure(final_url):
        return False, f"final URL indicates login failure: {final_url}"

    code = int(resp.status_code)

    if code in (301, 302, 303, 307, 308):
        loc = resp.headers.get("location") or ""
        if not loc.strip():
            return False, f"HTTP {code} redirect without Location header"
        if url_indicates_login_failure(loc):
            return False, f"redirect Location indicates login error: {loc}"
        if redirect_location_suggests_failed_login(loc):
            return False, f"redirect Location points to login page: {loc}"
        return True, f"HTTP {code} redirect (validate session with probe)"

    if 200 <= code < 300:
        return True, "login HTTP 2xx (validate session with probe)"

    return False, f"login HTTP {code} — not treated as success"


def cookie_jar_names(jar: Any) -> list[str]:
    out: list[str] = []
    try:
        keys = getattr(jar, "keys", None)
        if callable(keys):
            out = [str(k) for k in keys()]
    except Exception:
        pass
    return sorted(set(out))


def _mask_login_body_preview(text: str, password: str) -> str:
    if password:
        return text.replace(password, "********")
    return text


def session_login_request_debug_meta(
    send_kw: dict[str, Any],
    hdrs: dict[str, str],
    password: str,
    extracted_values: list[str] | None = None,
) -> tuple[str, str, str]:
    """Return (request_encoding, content_type, body_preview_masked)."""

    extras = [v for v in (extracted_values or []) if v and len(str(v)) > 0]
    ct = ""
    for k, v in hdrs.items():
        if str(k).lower() == "content-type":
            ct = str(v)
            break
    if "json" in send_kw:
        enc = "json"
        try:
            preview = json.dumps(send_kw["json"], ensure_ascii=False)[:2000]
        except Exception:
            preview = str(send_kw.get("json"))[:2000]
    elif "data" in send_kw:
        enc = "data"
        raw_data = send_kw["data"]
        if isinstance(raw_data, dict):
            preview = urlencode({str(k): str(v) for k, v in raw_data.items()})[:2000]
        else:
            preview = str(raw_data)[:2000]
    elif "content" in send_kw:
        enc = "content"
        c = send_kw["content"]
        preview = c.decode("utf-8", errors="replace")[:2000] if isinstance(c, (bytes, bytearray)) else str(c)[:2000]
    else:
        enc = "none"
        preview = ""
    masked = mask_template_preview(_mask_login_body_preview(preview, password), password, extras)
    return enc, ct, masked


def build_template_render_preview(
    login_url: str,
    hdrs: dict[str, str],
    send_kw: dict[str, Any],
    password: str,
    extracted_values: list[str] | None = None,
) -> str:
    """Single masked diagnostic blob for templates actually sent on login."""

    extras = [v for v in (extracted_values or []) if v and len(str(v)) > 0]
    _, _, body_prev = session_login_request_debug_meta(send_kw, hdrs, password, extracted_values=extras)
    hdr_masked = mask_http_headers({str(k): str(v) for k, v in hdrs.items()})
    url_m = mask_template_preview(login_url, password, extras)
    lines = [
        f"login_url={url_m}",
        f"headers={json.dumps(hdr_masked, ensure_ascii=False)}",
    ]
    enc, ct, _ = session_login_request_debug_meta(send_kw, hdrs, password, extracted_values=extras)
    lines.append(f"body_mode_encoding={enc}; content_type={ct}")
    lines.append(f"body_masked={body_prev}")
    return "\n".join(lines)


@dataclass
class SessionLoginHttpDebug:
    body_mode: str
    login_allow_redirects: bool
    login_final_url: str
    redirect_chain: list[str]
    cookie_names: list[str]
    login_http_ok: bool
    login_http_reason: str
    computed_login_request_url: str = ""
    login_url_resolution_warnings: list[str] = field(default_factory=list)
    session_login_body_preview: str = ""
    session_login_content_type: str = ""
    session_login_request_encoding: str = ""
    preflight_http_status: int | None = None
    preflight_final_url: str | None = None
    preflight_cookies: dict[str, str] | None = None
    extracted_variables: dict[str, str] | None = None
    template_render_preview: str = ""


def session_login_single_request(
    client: Any,
    auth_cfg: dict[str, Any],
    path_origin: str,
) -> tuple[Any, SessionLoginHttpDebug]:
    """Perform login HTTP request; optional preflight + extraction run first (same client/cookies)."""

    pw = str(auth_cfg.get("login_password") or "")
    user = str(auth_cfg.get("login_username") or "")

    preflight_http_status: int | None = None
    preflight_final_url: str | None = None
    preflight_cookies_masked: dict[str, str] | None = None
    extracted_variables: dict[str, str] = {}

    ctx_base = SessionLoginRenderContext(username=user, password=pw)
    pf_resp: Any | None = None

    if bool(auth_cfg.get("preflight_enabled")):
        pf_url = resolve_preflight_url(auth_cfg, path_origin)
        if pf_url:
            pf_method = str(auth_cfg.get("preflight_method") or "GET").strip().upper()
            pf_headers_raw = auth_cfg.get("preflight_headers")
            pf_headers = merge_str_headers(pf_headers_raw if isinstance(pf_headers_raw, dict) else {})
            pf_headers = {k: render_session_login_template(str(v), ctx_base) for k, v in pf_headers.items()}
            raw_pf = str(auth_cfg.get("preflight_body_raw") or "")
            allow_pf = preflight_follow_redirects_value(auth_cfg)
            send_pf: dict[str, Any] = {}
            if raw_pf.strip() and pf_method in {"POST", "PUT", "PATCH", "DELETE"}:
                body_str = render_session_login_template(raw_pf, ctx_base)
                send_pf["content"] = body_str.encode("utf-8")
                if not any(str(k).lower() == "content-type" for k in pf_headers):
                    pf_headers = {**pf_headers, "Content-Type": "application/octet-stream"}
            pf_resp = client.request(pf_method, pf_url, headers=pf_headers, follow_redirects=allow_pf, **send_pf)
            preflight_http_status = int(pf_resp.status_code)
            preflight_final_url = str(pf_resp.url)
            cookie_map = cookies_dict_from_client(client)
            resp_headers = headers_dict_from_response(pf_resp)
            body_text = pf_resp.text or ""
            extracted_variables = run_session_login_extractions(
                auth_cfg,
                body_text=body_text,
                response_headers=resp_headers,
                cookie_map=cookie_map,
            )
            preflight_cookies_masked = mask_extracted_variables(cookie_map, pw)

    hdr_for_ctx = headers_dict_from_response(pf_resp) if pf_resp is not None else {}
    cookie_map_login = cookies_dict_from_client(client)
    render_ctx = SessionLoginRenderContext(
        username=user,
        password=pw,
        variables=extracted_variables,
        cookies=cookie_map_login,
        headers=hdr_for_ctx,
    )

    method, url, hdrs, send_kw, mode, url_warnings = build_session_login_request_parts(
        auth_cfg, path_origin, render_ctx=render_ctx
    )
    enc, ct, preview = session_login_request_debug_meta(
        send_kw,
        hdrs,
        pw,
        extracted_values=list(extracted_variables.values()),
    )
    allow_redir = login_allow_redirects_value(auth_cfg)
    resp = client.request(method, url, headers=hdrs, follow_redirects=allow_redir, **send_kw)
    ok, reason = classify_session_login_http_response(resp)
    chain: list[str] = []
    try:
        chain = [str(r.url) for r in resp.history] + [str(resp.url)]
    except Exception:
        chain = [str(resp.url)]
    tmpl_preview = build_template_render_preview(str(resp.request.url), hdrs, send_kw, pw, list(extracted_variables.values()))
    dbg = SessionLoginHttpDebug(
        body_mode=mode,
        login_allow_redirects=allow_redir,
        login_final_url=str(resp.url),
        redirect_chain=chain,
        cookie_names=cookie_jar_names(client.cookies),
        login_http_ok=ok,
        login_http_reason=reason,
        computed_login_request_url=str(resp.request.url),
        login_url_resolution_warnings=url_warnings,
        session_login_body_preview=preview,
        session_login_content_type=ct,
        session_login_request_encoding=enc,
        preflight_http_status=preflight_http_status,
        preflight_final_url=preflight_final_url,
        preflight_cookies=preflight_cookies_masked,
        extracted_variables=mask_extracted_variables(extracted_variables, pw),
        template_render_preview=tmpl_preview,
    )
    return resp, dbg
