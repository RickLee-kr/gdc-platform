# CrowdStrike Falcon Connector Module

Declarative connector module for CrowdStrike Falcon REST API polling.

## Setup

1. Set Host/Base URL to `https://api.crowdstrike.com` (or your cloud shard base URL).
2. Paste an OAuth2 access token or API-scoped bearer token in credentials when instantiating.
3. Select one or more stream templates (Detections, Incidents) to materialize.
4. Validate resources[] shape with API Test; tune JSONPaths if your API version differs.
5. Add routes after mapping validation; enable the stream only when ready.

## Streams

| Stream | Endpoint | Description |
|--------|----------|-------------|
| detections | `/detects/entities/detects/v2` | Detection summaries |
| incidents | `/incidents/queries/incidents/v1` | Incident objects |

## Documentation

- [CrowdStrike Falcon API documentation](https://falcon.crowdstrike.com/documentation)
