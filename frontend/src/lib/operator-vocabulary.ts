/**
 * Operator-facing labels (DATA-RELAY-UX-CHARTER v1.1 Rule 1).
 * Do not expose engine/runtime implementation terms in product UI copy.
 */

export const OP_LABEL = {
  deliveryRecords: 'Delivery records',
  deliveryTimeline: 'Delivery timeline',
  deliveryActivityRows: 'Delivery activity rows',
  platformStatus: 'Platform status',
  activeWorkers: 'Active workers',
  streamPipeline: 'Stream pipeline',
  policyEnforcement: 'Policy enforcement',
  streamResponseRules: 'Stream response rules',
  operationsCenter: 'Operations Center',
  operationsNav: 'Operations',
  streamMonitoring: 'Stream monitoring',
  whatHappened: 'What happened?',
  why: 'Why?',
  whatShouldIDo: 'What should I do?',
  overallStatus: 'Overall Status',
  activeIssues: 'Active Issues',
  deliveryHealth: 'Delivery Health',
  requiredAction: 'Required Action',
  sourceProduct: 'Source product',
  sourceProductGroup: 'Source product group',
  ingestMethod: 'Ingest method',
  deliveryIssues: 'Delivery issues',
  riskAndGovernance: 'Risk & governance',
  lastSyncPosition: 'Last sync position',
  deliveryTargets: 'Delivery targets',
  allProducts: 'All products',
  sourceConnection: 'Source connection',
  sourceConnections: 'Source connections',
  deliveryPath: 'Delivery path',
  deliveryPaths: 'Delivery paths',
  syncPosition: 'Sync position',
  platformActivity: 'Platform activity',
  internalProcessing: 'Internal processing',
  deliveryFailed: 'Delivery failed',
  multiDestinationDelivery: 'Multi-destination delivery',
  viewDeliveryActivity: 'View delivery activity',
  openDeliveryPath: 'Open delivery path',
  fieldPath: 'Field path',
  syncPositionUpdate: 'Sync position update',
} as const

/** Wizard step copy — Charter-aligned replacements for forbidden engine terms. */
export const WIZARD_LABEL = {
  sourceConnection: OP_LABEL.sourceConnection,
  sourceConnections: OP_LABEL.sourceConnections,
  deliveryPath: OP_LABEL.deliveryPath,
  deliveryPaths: OP_LABEL.deliveryPaths,
  syncPosition: OP_LABEL.syncPosition,
  platformActivity: OP_LABEL.platformActivity,
  internalProcessing: OP_LABEL.internalProcessing,
  deliveryPathSettings: 'Delivery path settings',
  addDeliveryPath: 'Add delivery path',
  noDeliveryPathsYet: 'No delivery paths yet — click Add delivery path',
  connectorConfigured: 'Source connection configured and tested',
  connectorAndAuth: 'Source connection & authentication',
  routesConfiguration: 'Delivery paths configuration',
  routesSummary: 'Delivery paths summary',
  checkpointConfiguration: 'Sync position configuration',
  checkpointField: 'Sync position field',
  checkpointType: 'Sync position type',
  goToOperations: 'Go to Operations',
} as const

/** User-visible copy replacements for legacy engine terms. */
export const OP_COPY = {
  deliveryLogsWindow: 'Committed delivery records in the selected window.',
  deliveryLogsLifecycle: 'Committed delivery records including lifecycle stages.',
  deliveryLogsLoaded: 'Committed delivery records in the current Logs view.',
  deliveryLogsTotal: 'Total committed delivery records in the selected window.',
  recentFailuresSubtitle:
    'Latest route delivery failures from committed delivery records (same window as the summary).',
  retriesSubtitle: 'Retry outcomes in delivery records for the selected window.',
  platformHostSubtitle: 'Scheduler and host posture from the dashboard summary API and live host sampling.',
  streamRunHistory: 'Run history (delivery timeline)',
  streamRuntimeFooter: 'Delivery records; timeline uses delivery record samples.',
  logsExplorerEmpty: 'Load delivery records via the runtime API to populate KPIs.',
  logDetailNoRun: 'No run ID on this row — open a log from a committed stream run.',
  wizardRunOnce:
    'Runs one delivery cycle for this stream (operator action — no manual API call required).',
  policyNoticeBody:
    'Runtime enforcement not enabled — saved policies and stream assignments do not affect live delivery yet.',
  policyNoticeFootnote:
    'Per-stream response rules in Monitoring still use existing stream policy settings until Named Policies connect to runtime.',
  routeFailuresWindow: 'No recent route failures in the committed delivery records window.',
  analyticsSource: 'delivery records',
} as const

const ENGINE_TERM_REPLACEMENTS: ReadonlyArray<[RegExp, string]> = [
  [/delivery_logs/gi, 'delivery records'],
  [/StreamRunner/g, 'stream pipeline'],
  [/runtime_engine/gi, 'platform status'],
  [/policy_engine/gi, 'policy enforcement'],
  [/protection_engine/gi, 'data protection'],
  [/Runtime Telemetry Rows/g, 'Delivery activity rows'],
  [/route send failed/gi, OP_LABEL.deliveryFailed],
  [/route fan-?out/gi, OP_LABEL.multiDestinationDelivery],
  [/open runtime/gi, OP_LABEL.viewDeliveryActivity],
  [/\bruntime\b/gi, 'platform'],
  [/\bengine\b/gi, 'platform'],
  [/\bconnector\b/gi, 'source connection'],
  [/\bconnectors\b/gi, 'source connections'],
  [/\broute\b/gi, 'delivery path'],
  [/\broutes\b/gi, 'delivery paths'],
  [/\bcheckpoint\b/gi, 'sync position'],
  [/lifecycle rows/gi, 'lifecycle records'],
  [/run_complete/gi, 'run finished'],
]

/** Sanitize backend metric copy for operator-facing UI. */
export function sanitizeOperatorDisplayText(text: string): string {
  let out = text
  for (const [pattern, replacement] of ENGINE_TERM_REPLACEMENTS) {
    out = out.replace(pattern, replacement)
  }
  return out
}
