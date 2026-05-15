"""Unit tests for session login URL/body handling (Cybereason-style)."""

from __future__ import annotations

import httpx
import pytest

from app.connectors.session_login_http import (
    build_session_login_request_parts,
    classify_session_login_http_response,
    cookies_dict_from_client,
    resolve_session_login_url,
    resolve_session_login_url_with_warnings,
    session_login_single_request,
    url_indicates_login_failure,
)
from app.connectors.session_login_template import (
    SessionLoginRenderContext,
    render_session_login_template,
    run_session_login_extractions,
)


def test_url_indicates_login_html_error() -> None:
    assert url_indicates_login_failure("https://x.example/login.html?error")
    assert url_indicates_login_failure("https://x.example/login.html?error=1")


def test_url_error_query_param() -> None:
    assert url_indicates_login_failure("https://api.example/v1?error=")


def test_classify_redirect_to_login_error_location() -> None:
    req = httpx.Request("POST", "https://x.example/login.html")
    resp = httpx.Response(
        302,
        request=req,
        headers={"Location": "/login.html?error"},
    )
    ok, reason = classify_session_login_http_response(resp)
    assert ok is False
    assert "error" in reason.lower()


def test_classify_200_ok() -> None:
    req = httpx.Request("POST", "https://x.example/login.html")
    resp = httpx.Response(200, request=req, text="")
    ok, _ = classify_session_login_http_response(resp)
    assert ok is True


def test_form_urlencoded_uses_data_not_json() -> None:
    auth = {
        "login_path": "/login.html",
        "login_method": "POST",
        "login_username": "u",
        "login_password": "p",
        "login_body_mode": "form_urlencoded",
        "login_headers": {"Content-Type": "application/x-www-form-urlencoded"},
    }
    method, url, hdrs, send_kw, mode, _warn = build_session_login_request_parts(auth, "https://host.example")
    assert mode == "form_urlencoded"
    assert "json" not in send_kw
    assert send_kw.get("data") == "username=u&password=p"
    assert "application/x-www-form-urlencoded" in (hdrs.get("Content-Type") or "")


def test_form_urlencoded_login_body_raw_preserves_ampersand_and_placeholders() -> None:
    auth = {
        "login_path": "/login.html",
        "login_method": "POST",
        "login_username": "u",
        "login_password": "p",
        "login_body_mode": "form_urlencoded",
        "login_body_raw": "username={{username}}&password={{password}}&extra=1",
        "login_headers": {"Content-Type": "application/x-www-form-urlencoded"},
    }
    _method, _url, _hdrs, send_kw, mode, _w = build_session_login_request_parts(auth, "https://host.example")
    assert mode == "form_urlencoded"
    assert send_kw.get("data") == "username=u&password=p&extra=1"


def test_allow_redirects_default_false_from_missing_key() -> None:
    from app.connectors.session_login_http import login_allow_redirects_value

    assert login_allow_redirects_value({}) is False
    assert login_allow_redirects_value({"login_allow_redirects": True}) is True


@pytest.mark.parametrize(
    "final_url,fail",
    [
        ("https://x/rest/users/current", False),
        ("https://x/login.html?error", True),
    ],
)
def test_final_url_failure_detection(final_url: str, fail: bool) -> None:
    assert url_indicates_login_failure(final_url) == fail


def test_render_session_login_template_missing_safe() -> None:
    ctx = SessionLoginRenderContext(username="u", password="p", variables={"csrf_token": "abc"})
    assert render_session_login_template("x={{missing}}&t={{csrf_token}}", ctx) == "x=&t=abc"


def test_render_cookie_header_preflight_namespaces() -> None:
    ctx = SessionLoginRenderContext(
        username="u",
        password="p",
        variables={"oauth_state": "st"},
        cookies={"JSESSIONID": "J1"},
        headers={"X-CSRF-Token": "tok"},
    )
    assert render_session_login_template("{{cookie.JSESSIONID}}", ctx) == "J1"
    assert render_session_login_template("{{header.X-CSRF-Token}}", ctx) == "tok"
    assert render_session_login_template("{{preflight.oauth_state}}", ctx) == "st"


def test_regex_jsonpath_header_cookie_extraction() -> None:
    html = '<input type="hidden" name="_csrf" value="xyz789">'
    rules_body = {
        "enabled": True,
        "source": "body",
        "name": "csrf_token",
        "extraction_mode": "regex",
        "pattern": r'name="_csrf"\s+value="([^"]+)"',
    }
    auth = {"csrf_extract": rules_body}
    out = run_session_login_extractions(
        auth,
        body_text=html,
        response_headers={},
        cookie_map={},
    )
    assert out["csrf_token"] == "xyz789"

    auth_json = {"session_login_extractions": [{"enabled": True, "source": "body", "name": "k", "extraction_mode": "jsonpath", "pattern": "$.csrf"}]}
    out2 = run_session_login_extractions(
        auth_json,
        body_text='{"csrf": "fromjson"}',
        response_headers={},
        cookie_map={},
    )
    assert out2["k"] == "fromjson"

    out3 = run_session_login_extractions(
        {"csrf_extract": {"enabled": True, "source": "header", "name": "h", "extraction_mode": "header_name", "pattern": "X-CSRF-Token"}},
        body_text="",
        response_headers={"X-CSRF-Token": "header-val"},
        cookie_map={},
    )
    assert out3["h"] == "header-val"

    out4 = run_session_login_extractions(
        {"csrf_extract": {"enabled": True, "source": "cookie", "name": "c", "extraction_mode": "cookie_name", "pattern": "sid"}},
        body_text="",
        response_headers={},
        cookie_map={"sid": "cookie-val"},
    )
    assert out4["c"] == "cookie-val"


def test_preflight_cookie_persistence_and_csrf_login_simulation() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/login-page" and request.method == "GET":
            return httpx.Response(
                200,
                headers=[("Set-Cookie", "bootstrap=pre")],
                text='<input type="hidden" name="_csrf" value="tok123">',
            )
        if request.url.path == "/login" and request.method == "POST":
            body = request.content.decode("utf-8")
            assert "_csrf=tok123" in body
            assert "user=u1" in body
            return httpx.Response(200, headers=[("Set-Cookie", "session=ok")], json={"ok": True})
        return httpx.Response(404, text="not found")

    transport = httpx.MockTransport(handler)
    with httpx.Client(transport=transport, base_url="https://example.test") as client:
        auth = {
            "login_path": "/login",
            "login_method": "POST",
            "login_username": "u1",
            "login_password": "p1",
            "login_body_mode": "form_urlencoded",
            "login_body_raw": "user={{username}}&pass={{password}}&_csrf={{csrf_token}}",
            "login_headers": {"Content-Type": "application/x-www-form-urlencoded"},
            "preflight_enabled": True,
            "preflight_method": "GET",
            "preflight_path": "/login-page",
            "csrf_extract": {
                "enabled": True,
                "source": "body",
                "name": "csrf_token",
                "extraction_mode": "regex",
                "pattern": r'value="([^"]+)"',
            },
        }
        resp, dbg = session_login_single_request(client, auth, "https://example.test")
        assert resp.status_code == 200
        assert dbg.preflight_http_status == 200
        assert "bootstrap" in cookies_dict_from_client(client)
        assert dbg.extracted_variables is not None
        assert dbg.extracted_variables.get("csrf_token") == "tok123"
        assert dbg.template_render_preview


def test_login_query_params_template_injection() -> None:
    ctx = SessionLoginRenderContext(username="u", password="p", variables={"csrf_token": "t"})
    _m, url, _h, _kw, _mode, _w = build_session_login_request_parts(
        {
            "login_path": "/login",
            "login_username": "u",
            "login_password": "p",
            "login_body_mode": "json",
            "login_query_params": {"state": "{{csrf_token}}", "x": "1"},
        },
        "https://h.example",
        render_ctx=ctx,
    )
    assert "state=t" in url
    assert url.endswith("/login") or "login?" in url


def test_resolve_login_base_url_plus_endpoint_path() -> None:
    auth = {
        "login_url": "https://mecnfr.cybereason.net",
        "login_path": "/login.html",
    }
    assert resolve_session_login_url(auth, "https://ignored.example") == "https://mecnfr.cybereason.net/login.html"


def test_resolve_login_url_as_is_when_no_login_path() -> None:
    auth = {"login_url": "https://host.example/login.html"}
    assert resolve_session_login_url(auth, "https://other.example") == "https://host.example/login.html"


def test_resolve_warns_when_login_url_has_path_and_login_path_set() -> None:
    auth = {
        "login_url": "https://host.example/prefix/existing",
        "login_path": "/login.html",
    }
    url, warnings = resolve_session_login_url_with_warnings(auth, "https://base.example")
    assert url == "https://host.example/login.html"
    assert warnings
