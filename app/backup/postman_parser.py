"""Parse Postman Collection v2.x JSON into HTTP import drafts (no secret persistence)."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlencode, urlparse

from app.backup.curl_parser import ParsedCurlRequest, build_curl_import_draft
from app.security.secrets import mask_http_headers


@dataclass
class PostmanRequestItem:
    item_id: str
    name: str
    folder_path: str
    method: str
    url_preview: str
    request: dict[str, Any]


@dataclass
class PostmanParseResult:
    items: list[PostmanRequestItem] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    parse_errors: list[str] = field(default_factory=list)


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _postman_headers_to_dict(header_list: Any) -> dict[str, str]:
    out: dict[str, str] = {}
    if not isinstance(header_list, list):
        return out
    for row in header_list:
        if not isinstance(row, dict):
            continue
        key = str(row.get("key") or "").strip()
        if not key or row.get("disabled") is True:
            continue
        out[key] = str(row.get("value") or "")
    return out


def _postman_query_to_dict(query_list: Any) -> dict[str, str]:
    out: dict[str, str] = {}
    if not isinstance(query_list, list):
        return out
    for row in query_list:
        if not isinstance(row, dict):
            continue
        key = str(row.get("key") or "").strip()
        if not key or row.get("disabled") is True:
            continue
        out[key] = str(row.get("value") or "")
    return out


def _build_url_from_parts(url_obj: dict[str, Any]) -> str:
    raw = str(url_obj.get("raw") or "").strip()
    if raw:
        return raw
    protocol = str(url_obj.get("protocol") or "https").strip() or "https"
    host = url_obj.get("host")
    if isinstance(host, list):
        host_str = ".".join(str(p) for p in host if str(p).strip())
    else:
        host_str = str(host or "").strip()
    path = url_obj.get("path")
    if isinstance(path, list):
        path_str = "/" + "/".join(str(p).strip("/") for p in path if str(p).strip())
    else:
        path_str = str(path or "").strip()
        if path_str and not path_str.startswith("/"):
            path_str = f"/{path_str}"
    query = _postman_query_to_dict(url_obj.get("query"))
    base = f"{protocol}://{host_str}" if host_str else ""
    if not base:
        return raw
    url = f"{base}{path_str or '/'}"
    if query:
        url = f"{url}?{urlencode(query)}"
    return url


def _postman_body_to_parts(body: Any) -> tuple[Any | None, str | None, str | None]:
    """Return (json_body, raw_body, body_mode)."""

    if not isinstance(body, dict):
        return None, None, None
    mode = str(body.get("mode") or "").strip().lower() or None
    if mode == "raw":
        raw = str(body.get("raw") or "").strip()
        if not raw:
            return None, None, mode
        try:
            return json.loads(raw), None, mode
        except json.JSONDecodeError:
            return None, raw, mode
    if mode == "urlencoded":
        params = _postman_query_to_dict(body.get("urlencoded"))
        if params:
            return None, urlencode(params), mode
        return None, None, mode
    if mode in ("formdata", "graphql"):
        return None, None, mode
    return None, None, mode


def _split_url(url: str) -> tuple[str, str, dict[str, str]]:
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        return "", url if url.startswith("/") else f"/{url}", {}
    base = f"{parsed.scheme}://{parsed.netloc}"
    path = parsed.path or "/"
    from urllib.parse import parse_qs

    qs = parse_qs(parsed.query, keep_blank_values=True)
    params = {k: (v[0] if v else "") for k, v in qs.items()}
    return base, path, params


def postman_request_to_parsed(request: dict[str, Any]) -> ParsedCurlRequest:
    """Convert a Postman request object into ParsedCurlRequest for draft building."""

    out = ParsedCurlRequest()
    method = str(request.get("method") or "GET").upper().strip() or "GET"
    url_field = request.get("url")
    url = ""
    query_params: dict[str, str] = {}
    if isinstance(url_field, str):
        url = url_field.strip()
    elif isinstance(url_field, dict):
        url = _build_url_from_parts(url_field)
        query_params = _postman_query_to_dict(url_field.get("query"))

    if not url:
        out.parse_errors.append("Request has no URL.")
        return out

    base, endpoint, query_from_url = _split_url(url)
    merged_query = {**query_from_url, **query_params}

    headers = _postman_headers_to_dict(request.get("header"))
    json_body, raw_body, body_mode = _postman_body_to_parts(request.get("body"))

    out.method = method
    out.url = url
    out.base_url = base
    out.endpoint = endpoint
    out.query_params = merged_query
    out.headers = headers
    out.headers_masked = mask_http_headers({str(k): str(v) for k, v in headers.items()})
    out.json_body = json_body
    out.raw_body = raw_body

    if body_mode and body_mode not in ("raw", "urlencoded"):
        out.warnings.append(f"Postman body mode '{body_mode}' is not fully mapped; review the stream body in the wizard.")

    if json_body is not None and "Content-Type" not in {k.title() for k in headers}:
        out.warnings.append("JSON body detected without Content-Type; application/json is typical.")

    return out


def _flatten_items(items: Any, folder_path: str = "") -> list[PostmanRequestItem]:
    out: list[PostmanRequestItem] = []
    if not isinstance(items, list):
        return out
    for idx, entry in enumerate(items):
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("name") or f"Request {idx + 1}").strip()
        path_prefix = f"{folder_path}/{name}" if folder_path else name
        if "item" in entry:
            out.extend(_flatten_items(entry.get("item"), path_prefix))
            continue
        req = entry.get("request")
        if not isinstance(req, dict):
            continue
        parsed_preview = postman_request_to_parsed(req)
        url_preview = parsed_preview.url or "(no url)"
        item_id = path_prefix.replace(" ", "_")
        out.append(
            PostmanRequestItem(
                item_id=item_id,
                name=name,
                folder_path=folder_path,
                method=parsed_preview.method,
                url_preview=url_preview,
                request=req,
            )
        )
    return out


def parse_postman_collection(collection: dict[str, Any]) -> PostmanParseResult:
    """Parse a Postman Collection v2.x document and list HTTP requests."""

    out = PostmanParseResult()
    if not collection:
        out.parse_errors.append("Empty Postman collection.")
        return out

    if "item" not in collection and "requests" in collection:
        out.parse_errors.append("Postman Collection v1 is not supported. Export as Collection v2.1 JSON.")
        return out

    info = _as_dict(collection.get("info"))
    schema = str(info.get("schema") or "")
    if schema and "v2" not in schema.lower() and "collection" not in schema.lower():
        out.warnings.append("Unrecognized Postman schema; attempting v2.1 item parsing.")

    items = _flatten_items(collection.get("item"))
    if not items:
        out.parse_errors.append("No HTTP requests found in the Postman collection.")
        return out

    out.items = items
    return out


def build_postman_import_draft(
    collection: dict[str, Any],
    *,
    item_id: str,
    connector_name: str | None = None,
) -> tuple[dict[str, Any] | None, list[str], list[str]]:
    """Build a connector/stream draft for the selected Postman request."""

    parsed_collection = parse_postman_collection(collection)
    if parsed_collection.parse_errors:
        return None, parsed_collection.warnings, parsed_collection.parse_errors

    selected = next((i for i in parsed_collection.items if i.item_id == item_id), None)
    if not selected:
        return None, parsed_collection.warnings, [f"Request '{item_id}' was not found in the collection."]

    req_parsed = postman_request_to_parsed(selected.request)
    if req_parsed.parse_errors:
        return None, parsed_collection.warnings + req_parsed.warnings, req_parsed.parse_errors

    draft = build_curl_import_draft(req_parsed, connector_name=connector_name or selected.name)
    draft["draft_kind"] = "postman_http"
    draft["connector"]["name"] = (connector_name or "").strip() or selected.name
    draft["connector"]["description"] = f"Draft from Postman ({selected.method} {req_parsed.endpoint})"
    draft["stream"]["name"] = f"Imported {selected.name}"
    draft["parsed"]["postman_item_id"] = selected.item_id
    draft["parsed"]["postman_folder"] = selected.folder_path
    draft["parsed"]["body_mode"] = None
    body = selected.request.get("body")
    if isinstance(body, dict):
        draft["parsed"]["body_mode"] = body.get("mode")

    warnings = list(parsed_collection.warnings) + list(req_parsed.warnings) + list(draft.get("warnings", []))
    return draft, warnings, []
