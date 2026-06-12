# M31.1 Product Group Metadata Foundation

## Goal

Replace M30.2 temporary frontend-only product grouping with persisted `connector.product_group` metadata, while keeping the name heuristic as fallback when the field is unset.

## Backend

- `connectors.product_group` nullable `VARCHAR(128)`
- Exposed on Connector CRUD read/write
- Migration backfills existing rows using the same alias heuristic as the frontend

## Frontend

- `resolveSourceProductLabel(name, { product_group })` prefers API metadata
- Streams console grouping and product filter use `connector.product_group` when present
- Heuristic remains in `source-product-group.ts` for fallback only

## Non-goals

- Connector catalog template defaults (future)
- Regex replace / transform changes
