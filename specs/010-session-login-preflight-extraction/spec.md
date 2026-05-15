# Session login preflight, extraction, and template injection

## Scope

Extend generic `session_login` (`auth_type=session_login`) with optional:

- **Preflight HTTP request** before login (same `httpx.Client`, cookie jar preserved).
- **Token/value extraction** from preflight response body (regex or JSONPath), response headers, or cookies.
- **Template injection** into login URL query string, headers, and body using `{{…}}` placeholders.

## Behavior

- Preflight is optional (`preflight_enabled`). When enabled, it runs first; cookies and extractions feed the login request.
- Extraction rules are generic configuration (`session_login_extractions` list and/or `csrf_extract` single rule). No vendor-specific branching in code.
- Template rendering supports `{{username}}`, `{{password}}`, extracted names (e.g. `{{csrf_token}}`), `{{cookie.NAME}}`, `{{header.Name}}`, `{{preflight.key}}`.
- Missing placeholders resolve to empty string (missing-safe).
- Diagnostics (Auth Test / Auth Lab) expose preflight status, cookies snapshot (masked), extracted variables (masked where sensitive), and a masked template render preview.

## Constraints

- Does not modify StreamRunner or stream orchestration.
- Additive to existing session login; backward compatible when new fields are absent.
- Implementation lives in `app/connectors/session_login_http.py`, `app/connectors/session_login_template.py`, auth normalization, connector router, preview/auth diagnostics, and frontend connector forms only.
