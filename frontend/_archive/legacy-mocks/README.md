# Legacy route / mapping / destination / stream mocks (archived)

Static demo payloads and unused helpers removed from the production import chain.
Active screens use backend APIs and empty-state shells only.

Archived during mock naming cleanup. Do not import from `src/` without restoring
into the active tree.

## Contents

### Routes / mappings / destinations (prior round)

- `routes/route-edit-mock.ts`, `routes/routes-mock-data.ts`
- `mappings/mapping-edit-mock.ts`, `mappings/mappings-mock-data.ts`
- `destinations/destinations-mock-data.ts`

### Connectors / streams (naming cleanup round)

- `connectors/connector-detail-mock.ts` — unused demo connector overview payloads
- `streams/streams-mock-data.ts` — superseded by `src/constants/streamConsoleFilters.ts`
- `streams/stream-api-test-mock-data.ts` — unused Malop sample generators
