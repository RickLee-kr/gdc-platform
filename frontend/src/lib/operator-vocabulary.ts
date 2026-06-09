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
  streamMonitoring: 'Stream monitoring',
  whatHappened: 'What happened',
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
]

/** Sanitize backend metric copy for operator-facing UI. */
export function sanitizeOperatorDisplayText(text: string): string {
  let out = text
  for (const [pattern, replacement] of ENGINE_TERM_REPLACEMENTS) {
    out = out.replace(pattern, replacement)
  }
  return out
}
