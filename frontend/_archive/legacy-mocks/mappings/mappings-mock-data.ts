/**
 * Demo mappings overview payloads for `/mappings`. Replace with API hooks when endpoints exist.
 *
 * Note: persisted mappings attach to streams (JSONPath field transforms); this hub aggregates mock rows for UX review.
 */

export type MappingTypeUi = 'AUTOMATIC' | 'MANUAL' | 'TEMPLATE' | 'SCRIPTED'

export type MockMappingRow = {
  id: string
  name: string
  version: string
  mappingType: MappingTypeUi
  connectorName: string
  streamId: string
  streamLabel: string
  description: string
  fieldCount: number
  enableStatus: 'ENABLED' | 'DISABLED'
  successRate1hPct: number
  lastExecOk: boolean
  lastExecRelative: string
  tags: readonly string[]
}

export const MAPPINGS_KPI = {
  total: 156,
  totalSub: '↑ 12 from last 7 days',
  enabled: 132,
  enabledPct: '84.6%',
  enabledBarPct: 84.6,
  withErrors1h: 7,
  withErrorsPct: '4.5%',
  avgFields: 18.4,
  avgFieldsSub: '↑ 1.3 vs last 7 days',
  successRate1h: 99.21,
  successRateSub: '↑ 0.8% vs yesterday',
  executions1h: 42_812,
  executionsSub: '↑ 9.7% vs yesterday',
} as const

export const MAPPINGS_CREATED_OVER_TIME = [
  { day: 'Mon', count: 142 },
  { day: 'Tue', count: 148 },
  { day: 'Wed', count: 151 },
  { day: 'Thu', count: 154 },
  { day: 'Fri', count: 155 },
  { day: 'Sat', count: 155 },
  { day: 'Sun', count: 156 },
] as const

export const MAPPINGS_BY_TYPE = [
  { name: 'Automatic', value: 78, fill: '#7c3aed' },
  { name: 'Manual', value: 58, fill: '#2563eb' },
  { name: 'Template based', value: 14, fill: '#059669' },
  { name: 'Scripted', value: 6, fill: '#d97706' },
] as const

export const TOP_CONNECTORS_BY_MAPPING = [
  { name: 'Cybereason', count: 64 },
  { name: 'CrowdStrike', count: 28 },
  { name: 'Microsoft 365', count: 18 },
  { name: 'Palo Alto Cortex', count: 14 },
  { name: 'Splunk HEC Bridge', count: 11 },
  { name: 'Oracle Audit DB', count: 9 },
] as const

export const MAPPING_TYPE_FILTER_OPTIONS = ['All Types', 'AUTOMATIC', 'MANUAL', 'TEMPLATE', 'SCRIPTED'] as const

export const MAPPING_STATUS_FILTER_OPTIONS = ['All Statuses', 'ENABLED', 'DISABLED'] as const

export const MAPPING_CONNECTOR_FILTER_OPTIONS = [
  'All Connectors',
  'Cybereason',
  'CrowdStrike',
  'Microsoft Defender',
  'Okta',
  'Internal',
] as const

export const MAPPING_STREAM_FILTER_OPTIONS = [
  'All Streams',
  'Malop API',
  'Hunting API',
  'Sensor inventory',
  'Detections stream',
  'Advanced Hunting',
  'System Log',
  'Legacy syslog bridge',
] as const

export const MAPPING_TAGS_FILTER_OPTIONS = ['All Tags', 'production', 'pci', 'trial', 'deprecated'] as const

/** Rows use `streamId` values from `streams-mock-data` so “open mapping” links resolve in the demo shell. */
export const MOCK_MAPPING_ROWS: readonly MockMappingRow[] = [
  {
    id: 'map-malop',
    name: 'Malop Events Mapping',
    version: 'v3',
    mappingType: 'AUTOMATIC',
    connectorName: 'Cybereason',
    streamId: 'malop-api',
    streamLabel: 'Malop API',
    description: 'Normalize Malop JSON → SIEM schema (JSONPath extracts)',
    fieldCount: 26,
    enableStatus: 'ENABLED',
    successRate1hPct: 99.92,
    lastExecOk: true,
    lastExecRelative: '5s ago',
    tags: ['production'],
  },
  {
    id: 'map-hunting',
    name: 'Hunting Query Mapping',
    version: 'v2',
    mappingType: 'MANUAL',
    connectorName: 'Cybereason',
    streamId: 'hunting-api',
    streamLabel: 'Hunting API',
    description: 'Manual overrides for nested hunting responses',
    fieldCount: 19,
    enableStatus: 'ENABLED',
    successRate1hPct: 97.4,
    lastExecOk: true,
    lastExecRelative: '12s ago',
    tags: ['production'],
  },
  {
    id: 'map-sensors',
    name: 'Sensor inventory flatten',
    version: 'v1',
    mappingType: 'AUTOMATIC',
    connectorName: 'Cybereason',
    streamId: 'sensor-inventory',
    streamLabel: 'Sensor inventory',
    description: 'Flatten nested sensor metadata into syslog-friendly keys',
    fieldCount: 18,
    enableStatus: 'ENABLED',
    successRate1hPct: 99.88,
    lastExecOk: true,
    lastExecRelative: '30s ago',
    tags: ['production'],
  },
  {
    id: 'map-cs-detect',
    name: 'Detection Summary',
    version: 'v1',
    mappingType: 'TEMPLATE',
    connectorName: 'CrowdStrike',
    streamId: 'crowdstrike-detections',
    streamLabel: 'Detections stream',
    description: 'Template starter + vendor-specific JSONPath bindings',
    fieldCount: 22,
    enableStatus: 'ENABLED',
    successRate1hPct: 94.8,
    lastExecOk: false,
    lastExecRelative: '48s ago',
    tags: ['production', 'pci'],
  },
  {
    id: 'map-defender-hunt',
    name: 'Advanced Hunting projection',
    version: 'v4',
    mappingType: 'AUTOMATIC',
    connectorName: 'Microsoft Defender',
    streamId: 'defender-advanced-hunting',
    streamLabel: 'Advanced Hunting',
    description: 'JSONPath mapping for Kusto-shaped API responses',
    fieldCount: 31,
    enableStatus: 'ENABLED',
    successRate1hPct: 99.81,
    lastExecOk: true,
    lastExecRelative: '8s ago',
    tags: ['production'],
  },
  {
    id: 'map-okta-log',
    name: 'System Log normalization',
    version: 'v2',
    mappingType: 'MANUAL',
    connectorName: 'Okta',
    streamId: 'okta-system-log',
    streamLabel: 'System Log',
    description: 'Rename / normalize high-volume Okta fields before enrichment',
    fieldCount: 24,
    enableStatus: 'ENABLED',
    successRate1hPct: 99.72,
    lastExecOk: true,
    lastExecRelative: '1s ago',
    tags: ['production'],
  },
  {
    id: 'map-malop-ioc',
    name: 'Malop IOC extract',
    version: 'v1',
    mappingType: 'SCRIPTED',
    connectorName: 'Cybereason',
    streamId: 'malop-api',
    streamLabel: 'Malop API',
    description: 'Scripted extraction for IOC arrays (JSONPath + helper transforms)',
    fieldCount: 14,
    enableStatus: 'ENABLED',
    successRate1hPct: 99.5,
    lastExecOk: true,
    lastExecRelative: '6s ago',
    tags: ['trial'],
  },
  {
    id: 'map-legacy-bridge',
    name: 'Legacy syslog bridge mapping',
    version: 'v5',
    mappingType: 'TEMPLATE',
    connectorName: 'Internal',
    streamId: 'legacy-syslog-bridge',
    streamLabel: 'Legacy syslog bridge',
    description: 'Thin template for paused legacy feed (kept for rollback)',
    fieldCount: 11,
    enableStatus: 'DISABLED',
    successRate1hPct: 0,
    lastExecOk: false,
    lastExecRelative: '16h ago',
    tags: ['deprecated'],
  },
]
