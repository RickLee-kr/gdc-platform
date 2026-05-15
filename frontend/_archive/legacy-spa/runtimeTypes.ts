export type AppSection =
  | 'config'
  | 'demoScenarios'
  | 'liveSimulation'
  | 'runtimeReview'
  | 'operatorScenario'
  | 'workspaceSummary'
  | 'connectorTemplates'
  | 'connectorWizard'
  | 'sourceApiOnboarding'
  | 'routeVisualization'
  | 'executionHistory'
  | 'dashboard'
  | 'health'
  | 'stats'
  | 'timeline'
  | 'logs'
  | 'failureTrend'
  | 'controlTest'

export const SECTION_LABELS: Record<AppSection, string> = {
  config: 'Runtime Config',
  demoScenarios: 'Demo Scenarios',
  liveSimulation: 'Live Simulation',
  runtimeReview: 'Runtime Review',
  operatorScenario: 'Operator Scenario Mode',
  workspaceSummary: 'Workspace Summary',
  connectorTemplates: 'Connector Templates',
  connectorWizard: 'Connector Wizard',
  sourceApiOnboarding: 'Source / API Onboarding',
  routeVisualization: 'Route Visualization',
  executionHistory: 'Execution History',
  dashboard: 'Dashboard',
  health: 'Stream Health',
  stats: 'Stream Stats',
  timeline: 'Timeline',
  logs: 'Logs',
  failureTrend: 'Failure Trend',
  controlTest: 'Runtime Test & Control',
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
