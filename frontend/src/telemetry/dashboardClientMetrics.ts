/**
 * Structured one-line logs for dashboard client behaviour (poll overlap, bundle deadline).
 * Operators can enable in production via ``localStorage.setItem('gdc.debug.dashboardMetrics', '1')``.
 */

const LS_KEY = 'gdc.debug.dashboardMetrics'

function shouldEmit(): boolean {
  if (import.meta.env.DEV) return true
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY) === '1'
  } catch {
    return false
  }
}

export function logDashboardClientMetric(metric: string, fields: Record<string, unknown> = {}): void {
  if (!shouldEmit()) return
  const line = JSON.stringify({
    stage: 'dashboard_client',
    metric,
    ts_ms: Date.now(),
    ...fields,
  })
  const c = console as unknown as { info?: (msg: string) => void; log: (msg: string) => void }
  if (typeof c.info === 'function') c.info(line)
  else c.log(line)
}
