export type AppSection =
  | 'config'
  | 'dashboard'
  | 'health'
  | 'stats'
  | 'timeline'
  | 'logs'
  | 'failureTrend'
  | 'controlTest'

export const SECTION_LABELS: Record<AppSection, string> = {
  config: 'Runtime Config',
  dashboard: 'Dashboard',
  health: 'Stream Health',
  stats: 'Stream Stats',
  timeline: 'Timeline',
  logs: 'Logs',
  failureTrend: 'Failure Trend',
  controlTest: 'Control & Test',
}

export type ObsApiKey =
  | 'dashboard'
  | 'health'
  | 'stats'
  | 'timeline'
  | 'logsSearch'
  | 'logsPage'
  | 'logsCleanup'
  | 'failureTrend'

export type CtrlApiKey =
  | 'streamStart'
  | 'streamStop'
  | 'apiTest'
  | 'mappingCtl'
  | 'formatPreview'
  | 'routeDeliveryPreview'

export type TabKey = 'connector' | 'source' | 'stream' | 'mapping' | 'route' | 'destination'

export type ApiState = {
  loading: boolean
  success: string
  error: string
}

export type JsonValue = Record<string, unknown>

export const TAB_LABELS: Record<TabKey, string> = {
  connector: 'Connector',
  source: 'Source',
  stream: 'Stream',
  mapping: 'Mapping',
  route: 'Route',
  destination: 'Destination',
}
