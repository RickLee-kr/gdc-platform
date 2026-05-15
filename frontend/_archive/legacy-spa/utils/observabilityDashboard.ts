import type { AppSection } from '../runtimeTypes'

export const OBSERVABILITY_SECTIONS: AppSection[] = [
  'dashboard',
  'health',
  'stats',
  'timeline',
  'logs',
  'failureTrend',
]

export function isObservabilitySection(section: AppSection): boolean {
  return OBSERVABILITY_SECTIONS.includes(section)
}

/** Stable labels for operator cards (tests import these). */
export const OBS_CARD_TITLE = {
  dashboardSnapshot: 'Dashboard snapshot',
  riskSignals: 'Risk signals',
  streamHealth: 'Stream health (loaded)',
  activity: 'Log & timeline activity',
  failures: 'Failures & trend',
} as const

function readNum(o: Record<string, unknown> | null | undefined, k: string): number | null {
  if (!o) return null
  const v = o[k]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export type ObservabilityCardModel = {
  id: string
  title: string
  value: string
  detail?: string
}

export type ObservabilityCardInputs = {
  dashboardSummary: Record<string, unknown> | null
  dashboardProblemsLen: number
  dashboardRateLimitedLen: number
  dashboardUnhealthyLen: number
  healthRec: Record<string, unknown> | null
  healthSummary: Record<string, unknown> | null
  statsRec: Record<string, unknown> | null
  statsRecentLogsLen: number
  statsSummary: Record<string, unknown> | null
  timelineRec: Record<string, unknown> | null
  timelineItemsLen: number
  logSearchRec: Record<string, unknown> | null
  logSearchRowsLen: number
  logPageRec: Record<string, unknown> | null
  logPageItemsLen: number
  trendRec: Record<string, unknown> | null
  trendBucketsLen: number
}

export function buildObservabilityOperatorCards(i: ObservabilityCardInputs): ObservabilityCardModel[] {
  const totalStreams = readNum(i.dashboardSummary, 'total_streams')
  const runningStreams = readNum(i.dashboardSummary, 'running_streams')
  const recentFailuresDash = readNum(i.dashboardSummary, 'recent_failures')

  let dashValue = 'Load Dashboard summary to populate counts.'
  let dashDetail: string | undefined
  if (totalStreams !== null && runningStreams !== null) {
    const nonRunning = totalStreams - runningStreams
    dashValue = `running ${runningStreams} / total ${totalStreams} (other ${nonRunning})`
    dashDetail =
      recentFailuresDash !== null ? `recent_failures (dashboard): ${recentFailuresDash}` : undefined
  } else if (i.dashboardSummary && Object.keys(i.dashboardSummary).length > 0) {
    dashValue = 'Summary loaded — see grid below for fields.'
  }

  const riskValue = `problem routes: ${i.dashboardProblemsLen} · rate-limited routes: ${i.dashboardRateLimitedLen} · unhealthy streams: ${i.dashboardUnhealthyLen}`

  let healthValue = 'Load Stream Health for this stream_id.'
  let healthDetail: string | undefined
  if (i.healthRec) {
    const st = String(i.healthRec.stream_status ?? '—')
    const hl = String(i.healthRec.health ?? '—')
    healthValue = `${st} · ${hl}`
    const uh = readNum(i.healthSummary, 'unhealthy_routes')
    const dh = readNum(i.healthSummary, 'degraded_routes')
    if (uh !== null || dh !== null) {
      healthDetail = `routes unhealthy: ${uh ?? '—'} · degraded: ${dh ?? '—'}`
    }
  }

  const parts: string[] = []
  if (i.timelineRec !== null) {
    const total = readNum(i.timelineRec, 'total')
    parts.push(`timeline items ${i.timelineItemsLen}${total !== null ? ` / total ${total}` : ''}`)
  }
  if (i.logSearchRec !== null) {
    const tr = readNum(i.logSearchRec, 'total_returned')
    parts.push(`log search rows ${i.logSearchRowsLen}${tr !== null ? ` (returned ${tr})` : ''}`)
  }
  if (i.logPageRec !== null) {
    const tr = readNum(i.logPageRec, 'total_returned')
    parts.push(`log page items ${i.logPageItemsLen}${tr !== null ? ` (returned ${tr})` : ''}`)
  }
  if (i.statsRec !== null) {
    const tl = readNum(i.statsSummary, 'total_logs')
    parts.push(`stats recent_logs rows: ${i.statsRecentLogsLen}${tl !== null ? ` · total_logs: ${tl}` : ''}`)
  }
  const activityValue =
    parts.length > 0 ? parts.join(' · ') : 'Load Stats, Timeline, or Logs views to populate activity.'

  let failValue = 'Load Failure Trend or Dashboard summary for failure signals.'
  const failParts: string[] = []
  if (i.trendRec !== null) {
    const tt = readNum(i.trendRec, 'total')
    failParts.push(`trend total ${tt ?? '—'} · buckets ${i.trendBucketsLen}`)
  }
  if (recentFailuresDash !== null) {
    failParts.push(`dashboard recent_failures: ${recentFailuresDash}`)
  }
  if (i.dashboardProblemsLen > 0) {
    failParts.push(`dashboard problem routes listed: ${i.dashboardProblemsLen}`)
  }
  if (failParts.length > 0) {
    failValue = failParts.join(' · ')
  }

  return [
    { id: 'dash', title: OBS_CARD_TITLE.dashboardSnapshot, value: dashValue, detail: dashDetail },
    {
      id: 'risk',
      title: OBS_CARD_TITLE.riskSignals,
      value: riskValue,
      detail:
        recentFailuresDash !== null
          ? `Aggregate recent_failures (dashboard summary): ${recentFailuresDash}`
          : undefined,
    },
    { id: 'health', title: OBS_CARD_TITLE.streamHealth, value: healthValue, detail: healthDetail },
    { id: 'activity', title: OBS_CARD_TITLE.activity, value: activityValue },
    { id: 'failures', title: OBS_CARD_TITLE.failures, value: failValue },
  ]
}

/** Compact summary line for the overview strip (does not replace JsonBlock). */
export function formatLogsCleanupAtAGlance(result: unknown, dryRunUi: boolean): string {
  if (result === null || result === undefined) {
    return ''
  }
  if (typeof result !== 'object' || Array.isArray(result)) {
    return ''
  }
  const r = result as Record<string, unknown>
  const dry = typeof r.dry_run === 'boolean' ? r.dry_run : dryRunUi
  const matched = typeof r.matched_count === 'number' ? r.matched_count : null
  const deleted = typeof r.deleted_count === 'number' ? r.deleted_count : null
  const cutoff = typeof r.cutoff === 'string' ? r.cutoff : null
  const msg = typeof r.message === 'string' ? r.message : ''
  const bits = [
    `dry_run=${dry}`,
    matched !== null ? `matched=${matched}` : null,
    deleted !== null ? `deleted=${deleted}` : null,
    cutoff ? `cutoff=${cutoff}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return msg ? `${bits} · ${msg}` : bits
}
