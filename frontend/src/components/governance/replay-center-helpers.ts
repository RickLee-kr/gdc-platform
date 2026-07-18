import type { GovernanceReplayEntry } from '../../api/gdcGovernanceReplay'

/** Selection applies only to retryable rows currently loaded in the table (not full filtered set). */
export const REPLAY_SELECTION_SCOPE = 'loaded' as const

export type ReplayExecutionResultSummary = {
  requested: number
  accepted: number
  failed: number
}

export function isReplayRetryable(entry: GovernanceReplayEntry) {
  return entry.status === 'PENDING' || entry.status === 'FAILED'
}

export function buildReplayImpact(
  entries: GovernanceReplayEntry[],
  windowLabel: string,
  options?: {
    selectedCount?: number
    selectionScope?: typeof REPLAY_SELECTION_SCOPE
  },
): string[] {
  const selectedCount = options?.selectedCount ?? entries.length
  const selectionScope = options?.selectionScope ?? REPLAY_SELECTION_SCOPE
  const streams = [...new Set(entries.map((e) => e.stream_name || `Stream ${e.stream_id}`))]
  const routes = [...new Set(entries.map((e) => e.route_id).filter((id): id is number => id != null))]
  const destinations = [
    ...new Set(
      entries
        .map((e) => e.destination_name || (e.destination_id != null ? `Destination ${e.destination_id}` : null))
        .filter((v): v is string => Boolean(v)),
    ),
  ]
  const scopeLabel =
    selectionScope === 'loaded'
      ? 'Selection scope: currently loaded list (not full filtered result)'
      : `Selection scope: ${selectionScope}`
  return [
    `Selected count: ${selectedCount}`,
    `Stream count: ${streams.length}`,
    `Route count: ${routes.length}`,
    `Destination count: ${destinations.length}`,
    `Replay time window: ${windowLabel}`,
    scopeLabel,
    streams.length
      ? `Streams: ${streams.slice(0, 5).join(', ')}${streams.length > 5 ? ` (+${streams.length - 5})` : ''}`
      : 'Streams: —',
    destinations.length
      ? `Destinations: ${destinations.slice(0, 5).join(', ')}${destinations.length > 5 ? ` (+${destinations.length - 5})` : ''}`
      : 'Destinations: not specified on selected rows',
    'Action is audited as GOVERNANCE_REPLAY_EXECUTE / GOVERNANCE_REPLAY_BULK_EXECUTE.',
  ]
}

export function pruneReplaySelection(selectedIds: Iterable<number>, events: GovernanceReplayEntry[]): number[] {
  const visibleRetryable = new Set(events.filter(isReplayRetryable).map((e) => e.id))
  return [...new Set(selectedIds)].filter((id) => visibleRetryable.has(id))
}

export function dedupeReplayIds(ids: Iterable<number>): number[] {
  return [...new Set(ids)]
}
