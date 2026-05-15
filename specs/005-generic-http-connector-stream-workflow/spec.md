# Generic HTTP Connector + Stream Request Workflow

## Scope

Primary scope is limited to the Generic HTTP Connector Builder and Stream request/API test workflow.

Excluded:
- dashboard/runtime polish unrelated to connector+stream request flow
- template catalog work

## Core Rules

- Connector and Stream remain separate entities.
- Connector stores shared access settings (host/auth/SSL/proxy/common headers).
- Stream stores one executable HTTP request task configuration.
- Stream creation requires selecting an existing Connector (+ Source binding).
- Stream must not duplicate Connector auth secrets.

## Connector Auth Types

Supported auth types:
- `no_auth`
- `basic`
- `bearer`
- `api_key`
- `oauth2_client_credentials`
- `session_login`
- `jwt_refresh_token`

### jwt_refresh_token

Generic refresh flow:
- Use connector refresh token to request short-lived access token from token URL/path.
- Extract access token via configurable JSON path.
- Apply extracted token to target API request Authorization header (or configured header).
- Token refresh is performed for API test execution and stream HTTP execution entry.
- Refresh token is masked in API outputs.

### session_login

Generic login flow:
- Execute configured login request (path/url, method, headers, body template, username/password).
- Reuse in-memory cookie/session for requests.
- Retry login once when target request returns 401.

## Stream Request Task Model (Pre-API-Test)

Required request inputs:
- `endpoint` (required)
- `method` (required, GET/POST/PUT/PATCH/DELETE)
- `params` (optional)
- `headers` (optional)
- `body` (optional JSON payload)
- `timeout`
- `polling_interval`

Pre-API-test step must not require:
- event array path
- checkpoint path/type
- mapping
- enrichment

## Header Merge Order

Final request headers use:
1. connector common headers
2. connector auth headers
3. stream-specific headers

Auth header override by stream header should be blocked or warned.

## API Test Contract

API test endpoint executes only request validation/fetch behavior:
- builds final URL and query string
- merges headers/params
- applies auth/SSL/proxy/timeout
- returns structured response with masked request headers

Must not:
- update checkpoints
- start stream runner
- send to destinations
- write committed runtime delivery logs

Error contract returns explicit `error_type` values for target/auth/network/timeout/ssl/proxy/body errors.

