/**
 * Static demo data for the Destinations operational overview (no backend).
 * Aligns with SYSLOG_UDP, SYSLOG_TCP, future SYSLOG_TLS, and WEBHOOK_POST delivery targets.
 */

export type DestinationKind = 'SYSLOG_UDP' | 'SYSLOG_TCP' | 'SYSLOG_TLS' | 'WEBHOOK_POST'

export type DestinationEnableStatus = 'ENABLED' | 'DISABLED'

export type DestinationHealth = 'HEALTHY' | 'DEGRADED' | 'N/A'

export type MockDestinationRow = {
  id: string
  name: string
  /** Role pill under the name, e.g. Primary / Backup */
  tag: string
  kind: DestinationKind
  /** Primary line: host:port or URL */
  addressLine: string
  /** Protocol hint shown smaller (udp / tcp / tls / https) */
  protocolHint: string
  connectorName: string
  routeCount: number
  enableStatus: DestinationEnableStatus
  health: DestinationHealth
  deliveryPct1h: number
  latencyP95Ms: number
  latencySparkline: readonly number[]
  throughputPerMin: number
  throughputSparkline: readonly number[]
  lastTestRelative: string
  lastTestOk: boolean
}

export const DESTINATIONS_KPI = {
  total: 8,
  totalSub: '+2 from last 7 days',
  enabled: 7,
  enabledPct: '87.5%',
  enabledBarPct: 87.5,
  healthy: 6,
  healthyPct: '75.0%',
  healthyBarPct: 75,
  failed1h: 128,
  failedTrend: '+16 vs yesterday',
  avgLatencyP95Ms: 28,
  latencyTrend: '+5 ms vs yesterday',
  throughputPerMin: 12458,
  throughputTrend: '↑ 8.2% vs yesterday',
} as const

export const TYPE_FILTER_OPTIONS = ['All Types', 'Syslog UDP', 'Syslog TCP', 'Syslog TLS', 'Webhook'] as const

export const STATUS_FILTER_OPTIONS = ['All Statuses', 'ENABLED', 'DISABLED'] as const

export const CONNECTOR_FILTER_OPTIONS = ['All Connectors', 'Cybereason', 'CrowdStrike', 'Custom API', 'Palo Alto'] as const

export const MOCK_DESTINATION_ROWS: MockDestinationRow[] = [
  {
    id: 'dst-stellar-udp',
    name: 'Stellar SIEM',
    tag: 'Primary',
    kind: 'SYSLOG_UDP',
    addressLine: '10.16.42.18:514',
    protocolHint: 'udp',
    connectorName: 'Cybereason',
    routeCount: 3,
    enableStatus: 'ENABLED',
    health: 'HEALTHY',
    deliveryPct1h: 99.62,
    latencyP95Ms: 18,
    latencySparkline: [22, 21, 20, 19, 18, 18, 18],
    throughputPerMin: 6248,
    throughputSparkline: [5800, 5980, 6020, 6100, 6180, 6220, 6248],
    lastTestRelative: '10s ago',
    lastTestOk: true,
  },
  {
    id: 'dst-backup-tcp',
    name: 'Backup Syslog',
    tag: 'Backup',
    kind: 'SYSLOG_TCP',
    addressLine: '10.16.42.19:601',
    protocolHint: 'tcp',
    connectorName: 'Cybereason',
    routeCount: 2,
    enableStatus: 'ENABLED',
    health: 'DEGRADED',
    deliveryPct1h: 96.1,
    latencyP95Ms: 54,
    latencySparkline: [42, 45, 48, 50, 52, 53, 54],
    throughputPerMin: 892,
    throughputSparkline: [920, 910, 900, 895, 890, 892, 892],
    lastTestRelative: '2m ago',
    lastTestOk: false,
  },
  {
    id: 'dst-siem-webhook',
    name: 'SIEM Webhook',
    tag: 'Short term',
    kind: 'WEBHOOK_POST',
    addressLine: 'https://siem.example.com/v1/ingest/events',
    protocolHint: 'https',
    connectorName: 'CrowdStrike',
    routeCount: 4,
    enableStatus: 'ENABLED',
    health: 'HEALTHY',
    deliveryPct1h: 99.91,
    latencyP95Ms: 112,
    latencySparkline: [118, 116, 114, 113, 112, 112, 112],
    throughputPerMin: 2104,
    throughputSparkline: [1900, 1950, 1980, 2020, 2060, 2090, 2104],
    lastTestRelative: '45s ago',
    lastTestOk: true,
  },
  {
    id: 'dst-splunk-tls',
    name: 'Splunk HEC',
    tag: 'Backup',
    kind: 'SYSLOG_TLS',
    addressLine: 'splunk.internal:6514',
    protocolHint: 'tls',
    connectorName: 'Custom API',
    routeCount: 1,
    enableStatus: 'DISABLED',
    health: 'N/A',
    deliveryPct1h: 0,
    latencyP95Ms: 0,
    latencySparkline: [0, 0, 0, 0, 0, 0, 0],
    throughputPerMin: 0,
    throughputSparkline: [0, 0, 0, 0, 0, 0, 0],
    lastTestRelative: '6h ago',
    lastTestOk: false,
  },
  {
    id: 'dst-elastic-hook',
    name: 'Elastic Webhook',
    tag: 'Primary',
    kind: 'WEBHOOK_POST',
    addressLine: 'https://elastic.example.com/webhook/gdc',
    protocolHint: 'https',
    connectorName: 'Palo Alto',
    routeCount: 2,
    enableStatus: 'ENABLED',
    health: 'HEALTHY',
    deliveryPct1h: 99.2,
    latencyP95Ms: 76,
    latencySparkline: [82, 80, 78, 77, 76, 76, 76],
    throughputPerMin: 1420,
    throughputSparkline: [1350, 1370, 1385, 1395, 1410, 1418, 1420],
    lastTestRelative: '30s ago',
    lastTestOk: true,
  },
  {
    id: 'dst-archive-udp',
    name: 'Archive Syslog',
    tag: 'Long term',
    kind: 'SYSLOG_UDP',
    addressLine: '192.168.50.10:514',
    protocolHint: 'udp',
    connectorName: 'Cybereason',
    routeCount: 1,
    enableStatus: 'ENABLED',
    health: 'HEALTHY',
    deliveryPct1h: 100,
    latencyP95Ms: 9,
    latencySparkline: [12, 11, 10, 10, 9, 9, 9],
    throughputPerMin: 412,
    throughputSparkline: [380, 390, 400, 405, 408, 410, 412],
    lastTestRelative: '5s ago',
    lastTestOk: true,
  },
  {
    id: 'dst-cs-stream',
    name: 'Stream Sink',
    tag: 'Primary',
    kind: 'WEBHOOK_POST',
    addressLine: 'https://hooks.example.net/falcon/out',
    protocolHint: 'https',
    connectorName: 'CrowdStrike',
    routeCount: 2,
    enableStatus: 'ENABLED',
    health: 'DEGRADED',
    deliveryPct1h: 91.4,
    latencyP95Ms: 240,
    latencySparkline: [200, 210, 220, 228, 232, 238, 240],
    throughputPerMin: 534,
    throughputSparkline: [620, 600, 580, 560, 548, 538, 534],
    lastTestRelative: '1m ago',
    lastTestOk: false,
  },
  {
    id: 'dst-palo-tcp',
    name: 'SOC Collector',
    tag: 'Backup',
    kind: 'SYSLOG_TCP',
    addressLine: '172.20.1.44:514',
    protocolHint: 'tcp',
    connectorName: 'Palo Alto',
    routeCount: 1,
    enableStatus: 'DISABLED',
    health: 'N/A',
    deliveryPct1h: 0,
    latencyP95Ms: 0,
    latencySparkline: [0, 0, 0, 0, 0, 0, 0],
    throughputPerMin: 0,
    throughputSparkline: [0, 0, 0, 0, 0, 0, 0],
    lastTestRelative: '3d ago',
    lastTestOk: false,
  },
]

export function destinationTypeLabel(kind: DestinationKind): string {
  switch (kind) {
    case 'SYSLOG_UDP':
      return 'Syslog UDP'
    case 'SYSLOG_TCP':
      return 'Syslog TCP'
    case 'SYSLOG_TLS':
      return 'Syslog TLS'
    case 'WEBHOOK_POST':
      return 'Webhook'
    default: {
      const _e: never = kind
      return _e
    }
  }
}
