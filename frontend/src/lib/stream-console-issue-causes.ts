import type { StreamConsoleRow } from '../api/streamRows'
import type { StreamsMetricsWindow } from '../constants/streamConsoleFilters'
import {
  effectiveStreamSeverity,
  normalizeSeverityInput,
  type StreamOperationalSeverity,
} from './stream-operational-status'

/** Operator-facing issue cause labels shown in the Streams console Issues column. */
export type StreamIssueCauseLabel =
  | `No Data (${string})`
  | 'Schema Drift'
  | 'Destination Error'
  | 'Checkpoint Error'
  | 'Protection Block'
  | 'Source Error'
  | 'Low Volume'

/** Operator priority — lower rank = shown first. */
const ISSUE_CAUSE_RANK: readonly { match: (cause: string) => boolean; rank: number }[] = [
  { match: (c) => c === 'Protection Block', rank: 0 },
  { match: (c) => c === 'Destination Error', rank: 1 },
  { match: (c) => c === 'Source Error', rank: 2 },
  { match: (c) => c === 'Checkpoint Error', rank: 3 },
  { match: (c) => c.startsWith('No Data'), rank: 4 },
  { match: (c) => c === 'Schema Drift', rank: 5 },
  { match: (c) => c === 'Low Volume', rank: 6 },
]

const LOW_VOLUME_EVENT_THRESHOLD = 50

export function issueCauseRank(cause: string): number {
  for (const entry of ISSUE_CAUSE_RANK) {
    if (entry.match(cause)) return entry.rank
  }
  return 99
}

export function sortIssueCausesByPriority(causes: readonly string[]): string[] {
  return [...causes].sort((a, b) => {
    const rankDelta = issueCauseRank(a) - issueCauseRank(b)
    if (rankDelta !== 0) return rankDelta
    return a.localeCompare(b)
  })
}

export function formatIssuesDisplay(causes: readonly string[], maxVisible = 2): string {
  if (!causes.length) return '—'
  const sorted = sortIssueCausesByPriority(causes)
  if (sorted.length <= maxVisible) return sorted.join(' · ')
  const visible = sorted.slice(0, maxVisible)
  const hidden = sorted.length - maxVisible
  return `${visible.join(' · ')} +${hidden}`
}

export function streamsWindowChip(window: StreamsMetricsWindow): string {
  return window
}

function recentErrorMatches(row: StreamConsoleRow, pattern: RegExp): boolean {
  return row.recentErrors.some((e) => pattern.test(`${e.message} ${e.relativeAt}`))
}

/** Derive concrete issue causes for a stream console row (runtime fields only). */
export function deriveStreamIssueCauses(
  row: StreamConsoleRow,
  metricsWindow: StreamsMetricsWindow,
): StreamIssueCauseLabel[] {
  const causes: StreamIssueCauseLabel[] = []
  const windowChip = streamsWindowChip(metricsWindow)

  const noRuntimeData = !row.hasRuntimeApiSnapshot
  const noEventsInWindow = row.hasRuntimeApiSnapshot && row.runtimeStatsAttempted && row.events1h <= 0
  if (noRuntimeData || noEventsInWindow) {
    causes.push(`No Data (${windowChip})`)
  } else if (row.events1h > 0 && row.events1h < LOW_VOLUME_EVENT_THRESHOLD) {
    causes.push('Low Volume')
  }

  if (row.status === 'ERROR' || row.routesError > 0) {
    causes.push('Destination Error')
  } else if (row.status === 'DEGRADED' || row.routesDegraded > 0) {
    causes.push('Destination Error')
  } else if (row.deliveryPctKnown && row.deliveryPct < 90) {
    causes.push('Destination Error')
  }

  if (recentErrorMatches(row, /checkpoint/i) || /stalled|behind|lag/i.test(row.checkpointLagLabel)) {
    causes.push('Checkpoint Error')
  }

  if (recentErrorMatches(row, /protection|protected|quarantine|blocked/i)) {
    causes.push('Protection Block')
  }

  if (recentErrorMatches(row, /schema|drift/i)) {
    causes.push('Schema Drift')
  }

  const sourceLikely =
    row.status === 'DEGRADED' &&
    row.routesError === 0 &&
    row.routesDegraded === 0 &&
    recentErrorMatches(row, /source|extract|rate.?limit|429|poll/i)
  if (sourceLikely) {
    causes.push('Source Error')
  }

  return sortIssueCausesByPriority([...new Set(causes)]) as StreamIssueCauseLabel[]
}

export function streamOperationalHealthLabel(severity: StreamOperationalSeverity): 'Healthy' | 'Warning' | 'Critical' | 'Stopped' {
  switch (severity) {
    case 'critical':
      return 'Critical'
    case 'warning':
      return 'Warning'
    case 'stopped':
      return 'Stopped'
    default:
      return 'Healthy'
  }
}

export function aggregateGroupIssueCauses(
  rows: readonly StreamConsoleRow[],
  metricsWindow: StreamsMetricsWindow,
): { causes: string[]; label: string; streamCount: number; hiddenCount: number } {
  const causeSet = new Set<string>()
  let streamCount = 0
  for (const row of rows) {
    const rowCauses = deriveStreamIssueCauses(row, metricsWindow)
    if (rowCauses.length === 0) continue
    streamCount += 1
    for (const cause of rowCauses) causeSet.add(cause)
  }
  const causes = sortIssueCausesByPriority([...causeSet])
  const label = formatIssuesDisplay(causes)
  const hiddenCount = Math.max(0, causes.length - 2)
  return { causes, label, streamCount, hiddenCount }
}

export function formatStreamIssuesCell(
  row: StreamConsoleRow,
  metricsWindow: StreamsMetricsWindow,
): string {
  return formatIssuesDisplay(deriveStreamIssueCauses(row, metricsWindow))
}

export function streamSeverityFromCauses(
  row: StreamConsoleRow,
  metricsWindow: StreamsMetricsWindow,
): StreamOperationalSeverity {
  const causes = deriveStreamIssueCauses(row, metricsWindow)
  if (causes.some((c) => c === 'Protection Block' || c === 'Destination Error' || c === 'Checkpoint Error')) {
    if (row.status === 'ERROR' || row.routesError > 0) return 'critical'
  }
  if (causes.length > 0) {
    const base = effectiveStreamSeverity(normalizeSeverityInput(row))
    if (base === 'critical') return 'critical'
    return 'warning'
  }
  return effectiveStreamSeverity(normalizeSeverityInput(row))
}
