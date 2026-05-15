"""Generic template rendering and value extraction for session_login (no vendor-specific logic)."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Mapping

from app.parsers.jsonpath_parser import extract_one
from app.runtime.errors import ParserError

_PLACEHOLDER = re.compile(r"\{\{\s*([^}]+?)\s*\}\}")


def _norm_header_key(h: str) -> str:
    return str(h or "").strip().lower()


def headers_lookup_case_insensitive(headers: Mapping[str, str], name: str) -> str:
    """Return header value by case-insensitive name."""

    want = _norm_header_key(name)
    if not want:
        return ""
    for k, v in headers.items():
        if _norm_header_key(str(k)) == want:
            return str(v)
    return ""


def cookies_lookup_case_insensitive(cookies: Mapping[str, str], name: str) -> str:
    want = str(name or "").strip()
    if not want:
        return ""
    if want in cookies:
        return str(cookies[want])
    wl = want.lower()
    for k, v in cookies.items():
        if str(k).lower() == wl:
            return str(v)
    return ""


@dataclass
class SessionLoginRenderContext:
    """Variables available for {{…}} substitution."""

    username: str
    password: str
    variables: dict[str, str] = field(default_factory=dict)
    cookies: dict[str, str] = field(default_factory=dict)
    headers: Mapping[str, str] = field(default_factory=dict)

    def lookup(self, key: str) -> str:
        k = str(key or "").strip()
        if not k:
            return ""
        if k == "username":
            return self.username
        if k == "password":
            return self.password
        if k.startswith("cookie."):
            return cookies_lookup_case_insensitive(self.cookies, k[7:])
        if k.startswith("header."):
            return headers_lookup_case_insensitive(dict(self.headers), k[7:])
        if k.startswith("preflight."):
            sub = k[10:]
            return str(self.variables.get(sub, ""))
        return str(self.variables.get(k, ""))


def render_session_login_template(text: str, ctx: SessionLoginRenderContext) -> str:
    """Replace {{placeholders}}; unknown keys become empty string."""

    if not text:
        return ""

    def repl(m: re.Match[str]) -> str:
        return ctx.lookup(m.group(1))

    return _PLACEHOLDER.sub(repl, text)


def render_json_values(obj: Any, ctx: SessionLoginRenderContext) -> Any:
    if isinstance(obj, dict):
        return {str(k): render_json_values(v, ctx) for k, v in obj.items()}
    if isinstance(obj, list):
        return [render_json_values(x, ctx) for x in obj]
    if isinstance(obj, str):
        return render_session_login_template(obj, ctx)
    return obj


def mask_template_preview(text: str, password: str, extra_secrets: list[str] | None = None) -> str:
    """Mask password and optional secret strings in a preview string."""

    out = text
    if password:
        out = out.replace(password, "********")
    for s in extra_secrets or []:
        if s and len(s) > 0:
            out = out.replace(s, "********")
    return out


def _flatten_extraction_rules(auth_cfg: dict[str, Any]) -> list[dict[str, Any]]:
    rules: list[dict[str, Any]] = []
    lst = auth_cfg.get("session_login_extractions")
    if isinstance(lst, list):
        for item in lst:
            if isinstance(item, dict):
                rules.append(item)
    csrf = auth_cfg.get("csrf_extract")
    if isinstance(csrf, dict):
        rules.append(csrf)
    return rules


def _rule_enabled(rule: dict[str, Any]) -> bool:
    if "enabled" in rule:
        return bool(rule.get("enabled"))
    return True


def _rule_variable_name(rule: dict[str, Any]) -> str:
    name = rule.get("name") or rule.get("variable_name") or ""
    return str(name).strip()


def extract_session_login_value(
    rule: dict[str, Any],
    *,
    body_text: str,
    response_headers: Mapping[str, str],
    cookie_map: Mapping[str, str],
) -> str | None:
    """Return extracted string or None if disabled / no match."""

    if not _rule_enabled(rule):
        return None
    source = str(rule.get("source") or "body").strip().lower()
    mode = str(rule.get("extraction_mode") or "").strip().lower()
    pattern = str(rule.get("pattern") or "").strip()

    if source == "header":
        # pattern holds header name for header_name mode
        hname = pattern if mode == "header_name" else pattern
        if not hname:
            return None
        val = headers_lookup_case_insensitive(response_headers, hname)
        return val if val else None

    if source == "cookie":
        cname = pattern if mode == "cookie_name" else pattern
        if not cname:
            return None
        val = cookies_lookup_case_insensitive(cookie_map, cname)
        return val if val else None

    if source != "body":
        return None

    if mode == "regex":
        if not pattern:
            return None
        try:
            m = re.search(pattern, body_text or "", re.DOTALL)
        except re.error:
            return None
        if not m:
            return None
        if m.lastindex:
            return m.group(1)
        return m.group(0)

    if mode == "jsonpath":
        if not pattern:
            return None
        try:
            data = json.loads(body_text or "")
        except json.JSONDecodeError:
            return None
        if not isinstance(data, dict):
            return None
        try:
            val = extract_one(data, pattern, default=None)
        except ParserError:
            return None
        if val is None:
            return None
        if isinstance(val, (dict, list)):
            try:
                return json.dumps(val, ensure_ascii=False)
            except Exception:
                return str(val)
        return str(val)

    return None


def run_session_login_extractions(
    auth_cfg: dict[str, Any],
    *,
    body_text: str,
    response_headers: Mapping[str, str],
    cookie_map: Mapping[str, str],
) -> dict[str, str]:
    """Run all configured extraction rules; later rules override same variable name."""

    out: dict[str, str] = {}
    for rule in _flatten_extraction_rules(auth_cfg):
        if not isinstance(rule, dict):
            continue
        var = _rule_variable_name(rule)
        if not var:
            continue
        val = extract_session_login_value(
            rule,
            body_text=body_text,
            response_headers=response_headers,
            cookie_map=cookie_map,
        )
        if val is not None and str(val).strip() != "":
            out[var] = str(val)
    return out


def mask_extracted_variables(extracted: Mapping[str, str], password: str) -> dict[str, str]:
    masked: dict[str, str] = {}
    for k, v in extracted.items():
        if password and v == password:
            masked[str(k)] = "********"
        else:
            masked[str(k)] = v
    return masked
