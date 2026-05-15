# WireMock integration tests

## Goal

Provide a **test-only** WireMock container and pytest coverage so connector (`vendor_jwt_exchange`) + HTTP polling stream + mapping + route + destination run through **StreamRunner** (`run-once`) against a mock HTTP API, without Stellar Cyber production endpoints or in-runtime mocks.

## Rules

- Docker Compose **profile `test`** starts WireMock; mappings live under `tests/wiremock/mappings/`.
- Pytest uses **TEST_DATABASE_URL** when set (see `tests/conftest.py`) — never rely on resetting production/dev user data from these tests.
- Stubs validate SER `_search` GET requests: **Bearer** token from exchange, **no `cursor`/`limit` query params** when pagination is disabled and placeholders are dropped.

## References

Aligned with `specs/001-core-architecture/spec.md` (Stream as execution unit; checkpoint after successful delivery).
