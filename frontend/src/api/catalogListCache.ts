/** Short TTL for catalog list reads — dedupes cross-page navigation without stale config risk. */
export const CATALOG_LIST_CACHE_TTL_MS = 15_000

export const CATALOG_STREAMS_LIST_KEY = 'list-v1'
export const CATALOG_CONNECTORS_LIST_KEY = 'list-v1'
export const CATALOG_DESTINATIONS_LIST_KEY = 'list-v1'
