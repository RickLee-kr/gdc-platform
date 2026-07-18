import type { StreamConsoleRow } from '../api/streamRows'
import type { StreamsMetricsWindow } from '../constants/streamConsoleFilters'
import {
  aggregateGroupIssueBreakdown,
  aggregateGroupRates,
  streamSuccessRateDisplay,
  streamUsesCheckpointObservability,
} from './stream-console-metrics'
import { parseApiTimestampMs } from './platform-timestamps'
import type { ProductStreamGroup } from './source-product-group'
import {
  formatStreamIssuesCell,
  streamSeverityFromCauses,
} from './stream-console-issue-causes'
import type { StreamOperationalSeverity } from './stream-operational-status'

export type StreamsConsoleSortColumn =
  | 'stream'
  | 'status'
  | 'eps'
  | 'successRate'
  | 'destinations'
  | 'lastCheckpoint'
  | 'lastEvent'
  | 'issues'

export type StreamsConsoleSortDirection = 'asc' | 'desc'

const STREAM_SEVERITY_RANK: Record<StreamOperationalSeverity, number> = {
  healthy: 0,
  stopped: 1,
  warning: 2,
  critical: 3,
}

const GROUP_SEVERITY_RANK: Record<StreamOperationalSeverity, number> = {
  healthy: 0,
  warning: 1,
  stopped: 2,
  critical: 3,
}

function directionMultiplier(direction: StreamsConsoleSortDirection): 1 | -1 {
  return direction === 'asc' ? 1 : -1
}

function streamIngestEps(row: Pick<StreamConsoleRow, 'ingestEps' | 'eps1m' | 'eps5m'>): number {
  if (row.ingestEps > 0) return row.ingestEps
  if (row.eps1m != null && row.eps1m > 0) return row.eps1m
  if (row.eps5m != null && row.eps5m > 0) return row.eps5m
  return 0
}

function streamDestinationCount(
  row: StreamConsoleRow,
  destinationLabelsByStreamId: ReadonlyMap<number, string[]>,
): number {
  const sid = Number(row.id)
  const destNames = Number.isFinite(sid) ? (destinationLabelsByStreamId.get(sid) ?? []) : []
  return Math.max(destNames.length, row.routesTotal)
}

function groupDestinationCount(
  rows: readonly StreamConsoleRow[],
  destinationLabelsByStreamId: ReadonlyMap<number, string[]>,
): number {
  const unique = new Set<string>()
  for (const row of rows) {
    const sid = Number(row.id)
    const labels = Number.isFinite(sid) ? (destinationLabelsByStreamId.get(sid) ?? []) : []
    for (const label of labels) unique.add(label)
  }
  return unique.size
}

function streamLastEventMs(row: StreamConsoleRow): number | null {
  if (!row.hasRuntimeApiSnapshot) return null
  return parseApiTimestampMs(row.lastActivityRelative)
}

function streamLastCheckpointMs(row: StreamConsoleRow): number | null {
  if (!streamUsesCheckpointObservability(row)) return null
  return parseApiTimestampMs(row.checkpointUpdatedAt)
}

function groupLastEventMs(rows: readonly StreamConsoleRow[]): number | null {
  let best: number | null = null
  for (const row of rows) {
    const ts = streamLastEventMs(row)
    if (ts == null) continue
    if (best == null || ts > best) best = ts
  }
  return best
}

function groupLastCheckpointMs(rows: readonly StreamConsoleRow[]): number | null {
  let best: number | null = null
  for (const row of rows) {
    const ts = streamLastCheckpointMs(row)
    if (ts == null) continue
    if (best == null || ts > best) best = ts
  }
  return best
}

function compareNullableNumbers(
  a: number | null,
  b: number | null,
  direction: StreamsConsoleSortDirection,
): number {
  const dir = directionMultiplier(direction)
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (a === b) return 0
  return a < b ? -dir : dir
}

function compareNullableStrings(a: string, b: string, direction: StreamsConsoleSortDirection): number {
  const dir = directionMultiplier(direction)
  const aEmpty = !a.trim() || a === '—'
  const bEmpty = !b.trim() || b === '—'
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1
  return a.localeCompare(b) * dir
}

function finalizeStreamCompare(primary: number, a: StreamConsoleRow, b: StreamConsoleRow): number {
  if (primary !== 0) return primary
  return a.name.localeCompare(b.name)
}

function finalizeGroupCompare<T extends StreamConsoleRow>(
  primary: number,
  a: ProductStreamGroup<T>,
  b: ProductStreamGroup<T>,
): number {
  if (primary !== 0) return primary
  return a.productLabel.localeCompare(b.productLabel)
}

export function compareStreamRowsByColumn(
  a: StreamConsoleRow,
  b: StreamConsoleRow,
  column: StreamsConsoleSortColumn,
  direction: StreamsConsoleSortDirection,
  metricsWindow: StreamsMetricsWindow,
  destinationLabelsByStreamId: ReadonlyMap<number, string[]>,
): number {
  const dir = directionMultiplier(direction)

  switch (column) {
    case 'stream':
      return finalizeStreamCompare(compareNullableStrings(a.name, b.name, direction), a, b)
    case 'status': {
      const sa = STREAM_SEVERITY_RANK[streamSeverityFromCauses(a, metricsWindow)] ?? 0
      const sb = STREAM_SEVERITY_RANK[streamSeverityFromCauses(b, metricsWindow)] ?? 0
      const delta = sa - sb
      return finalizeStreamCompare(delta === 0 ? 0 : delta * dir, a, b)
    }
    case 'eps':
      return finalizeStreamCompare(
        compareNullableNumbers(streamIngestEps(a), streamIngestEps(b), direction),
        a,
        b,
      )
    case 'successRate': {
      const pa = streamSuccessRateDisplay(a).pct
      const pb = streamSuccessRateDisplay(b).pct
      return finalizeStreamCompare(compareNullableNumbers(pa, pb, direction), a, b)
    }
    case 'destinations':
      return finalizeStreamCompare(
        compareNullableNumbers(
          streamDestinationCount(a, destinationLabelsByStreamId),
          streamDestinationCount(b, destinationLabelsByStreamId),
          direction,
        ),
        a,
        b,
      )
    case 'lastCheckpoint':
      return finalizeStreamCompare(
        compareNullableNumbers(streamLastCheckpointMs(a), streamLastCheckpointMs(b), direction),
        a,
        b,
      )
    case 'lastEvent':
      return finalizeStreamCompare(
        compareNullableNumbers(streamLastEventMs(a), streamLastEventMs(b), direction),
        a,
        b,
      )
    case 'issues':
      return finalizeStreamCompare(
        compareNullableStrings(
          formatStreamIssuesCell(a, metricsWindow),
          formatStreamIssuesCell(b, metricsWindow),
          direction,
        ),
        a,
        b,
      )
    default:
      return finalizeStreamCompare(0, a, b)
  }
}

export function compareProductGroupsByColumn<T extends StreamConsoleRow>(
  a: ProductStreamGroup<T>,
  b: ProductStreamGroup<T>,
  column: StreamsConsoleSortColumn,
  direction: StreamsConsoleSortDirection,
  metricsWindow: StreamsMetricsWindow,
  destinationLabelsByStreamId: ReadonlyMap<number, string[]>,
): number {
  const dir = directionMultiplier(direction)

  switch (column) {
    case 'stream':
      return finalizeGroupCompare(compareNullableStrings(a.productLabel, b.productLabel, direction), a, b)
    case 'status': {
      const sa = GROUP_SEVERITY_RANK[a.operationalSeverity] ?? 0
      const sb = GROUP_SEVERITY_RANK[b.operationalSeverity] ?? 0
      const delta = sa - sb
      return finalizeGroupCompare(delta === 0 ? 0 : delta * dir, a, b)
    }
    case 'eps': {
      const ea = aggregateGroupRates(a.rows).successPct != null || a.rows.some((r) => r.hasRuntimeApiSnapshot)
        ? a.rows.reduce((sum, row) => sum + streamIngestEps(row), 0)
        : 0
      const eb = aggregateGroupRates(b.rows).successPct != null || b.rows.some((r) => r.hasRuntimeApiSnapshot)
        ? b.rows.reduce((sum, row) => sum + streamIngestEps(row), 0)
        : 0
      return finalizeGroupCompare(compareNullableNumbers(ea, eb, direction), a, b)
    }
    case 'successRate': {
      const pa = aggregateGroupRates(a.rows).successPct
      const pb = aggregateGroupRates(b.rows).successPct
      return finalizeGroupCompare(compareNullableNumbers(pa, pb, direction), a, b)
    }
    case 'destinations':
      return finalizeGroupCompare(
        compareNullableNumbers(
          groupDestinationCount(a.rows, destinationLabelsByStreamId),
          groupDestinationCount(b.rows, destinationLabelsByStreamId),
          direction,
        ),
        a,
        b,
      )
    case 'lastCheckpoint':
      return finalizeGroupCompare(
        compareNullableNumbers(groupLastCheckpointMs(a.rows), groupLastCheckpointMs(b.rows), direction),
        a,
        b,
      )
    case 'lastEvent':
      return finalizeGroupCompare(
        compareNullableNumbers(groupLastEventMs(a.rows), groupLastEventMs(b.rows), direction),
        a,
        b,
      )
    case 'issues':
      return finalizeGroupCompare(
        compareNullableStrings(
          aggregateGroupIssueBreakdown(a.rows, metricsWindow).label,
          aggregateGroupIssueBreakdown(b.rows, metricsWindow).label,
          direction,
        ),
        a,
        b,
      )
    default:
      return finalizeGroupCompare(0, a, b)
  }
}

export function applyStreamsConsoleSort<T extends StreamConsoleRow>(input: {
  groups: readonly ProductStreamGroup<T>[]
  column: StreamsConsoleSortColumn
  direction: StreamsConsoleSortDirection
  metricsWindow: StreamsMetricsWindow
  destinationLabelsByStreamId: ReadonlyMap<number, string[]>
}): ProductStreamGroup<T>[] {
  const { groups, column, direction, metricsWindow, destinationLabelsByStreamId } = input
  return [...groups]
    .sort((a, b) => compareProductGroupsByColumn(a, b, column, direction, metricsWindow, destinationLabelsByStreamId))
    .map((group) => ({
      ...group,
      rows: [...group.rows].sort((a, b) =>
        compareStreamRowsByColumn(a, b, column, direction, metricsWindow, destinationLabelsByStreamId),
      ),
    }))
}
