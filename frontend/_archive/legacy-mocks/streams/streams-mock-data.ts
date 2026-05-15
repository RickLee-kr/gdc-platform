/**
 * Streams console filter dropdown options only (no demo stream payloads).
 */

export const CONNECTOR_FILTER_OPTIONS = [
  'All Connectors',
  'Dev validation lab',
  'Cybereason',
  'CrowdStrike',
  'Microsoft Defender',
  'Okta',
  'Internal',
] as const

export const STATUS_FILTER_OPTIONS = ['All Status', 'RUNNING', 'DEGRADED', 'ERROR', 'STOPPED'] as const

export const SOURCE_FILTER_OPTIONS = [
  'All Sources',
  'HTTP API POLLING',
  'S3 OBJECT POLLING',
  'DATABASE QUERY',
  'REMOTE FILE POLLING',
] as const

export const AUTO_REFRESH_OPTIONS = ['Off', '5s', '15s', '30s', '1m'] as const
