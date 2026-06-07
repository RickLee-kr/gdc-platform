# Cybereason EDR Connector Module

Declarative connector module for Cybereason Malop and Hunting APIs.

## Setup

1. Set Host/Base URL to your Cybereason tenant base URL.
2. Provide vendor_jwt_exchange credentials (user ID, API key, token URL).
3. Select **Malop Search** stream template (Hunting stream migration pending).
4. Validate event_array_path against a live Malop response using API Test.
5. Attach routes to destinations; checkpoints advance only after successful delivery.

## Migration status

Malop stream is migrated from legacy `stellar_cyber_malop_api` template. Hunting stream templates are pending (MIG-002).

## Documentation

- [Cybereason documentation](https://www.cybereason.com/)
