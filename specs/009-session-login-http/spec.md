# Session login HTTP (Generic HTTP connector)

## Scope

Session-based vendor login (`auth_type=session_login`) for HTTP API polling sources.

## Behavior

- **Login URL resolution**: `login_url` may be a scheme+host-only base (e.g. `https://host`); if `login_path` is set, it is appended (`https://host/login.html`). If `login_url` already contains a path and `login_path` is empty, that URL is used as-is. Saving with both a non-root path in `login_url` and a non-empty `login_path` is rejected by the connector API to avoid ambiguity (runtime still resolves with a warning when reading legacy configs).
- Login body may be sent as JSON, `application/x-www-form-urlencoded` (`username`/`password`), or raw bytes from a template.
- `login_allow_redirects`: when false (default), the login response URL and `Location` are inspected before accepting the session; redirects to login pages or URLs containing login error markers fail early.
- Authentication success for diagnostics requires an HTTP probe (Auth Test / Stream API test / runtime fetch), not merely cookie presence.
- Session cookies are stored on a single `httpx.Client` for login, probe, and stream requests.

## Constraints

- Does not change StreamRunner orchestration; logic lives in auth execution, preview/poller HTTP clients, and `app/connectors/session_login_http.py`.
