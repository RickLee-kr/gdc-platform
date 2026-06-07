# Okta System Log Connector Module

Declarative connector module for Okta System Log API polling.

## Setup

1. Set Host/Base URL to your Okta org API origin (for example `https://your-domain.okta.com`).
2. Provide SSWS API token credentials via the auth schema form.
3. Select the **System Log** stream template to materialize.
4. The System Log API returns a JSON array; event_array_path is left empty so the platform treats the root array as the event list.
5. Add routes after validating mapping with API Test; enable the stream only after successful dry runs.

## Documentation

- [Okta System Log API reference](https://developer.okta.com/docs/reference/api/system-log/)
