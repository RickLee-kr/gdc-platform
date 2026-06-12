/** Streams console filter dropdown options (labels only; rows come from API). */

export const PRODUCT_FILTER_ALL = 'All products' as const

export const CONNECTOR_FILTER_OPTIONS = [PRODUCT_FILTER_ALL, 'Dev validation lab'] as const

export const STATUS_FILTER_OPTIONS = ['All Status', 'RUNNING', 'DEGRADED', 'ERROR', 'STOPPED', 'UNKNOWN'] as const

export const INGEST_METHOD_FILTER_OPTIONS = [
  'All ingest methods',
  'HTTP API polling',
  'S3 object polling',
  'Database query',
  'Remote file polling',
  'Webhook receiver',
] as const

/** @deprecated M30.1 — use INGEST_METHOD_FILTER_OPTIONS */
export const SOURCE_FILTER_OPTIONS = INGEST_METHOD_FILTER_OPTIONS

export const AUTO_REFRESH_OPTIONS = ['Off', '5s', '15s', '30s', '1m'] as const
