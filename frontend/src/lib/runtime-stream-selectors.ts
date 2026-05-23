import type { OperationalRouteSnapshot, OperationalStreamSnapshot } from '../api/operationalSnapshot'
import { streamMatchesTab, type StreamHealthTab } from '../components/runtime/runtime-overview-helpers'

export type StreamTopologyGroupMode = 'none' | 'health' | 'connector' | 'destination'

export type StreamVirtualItem =
  | { kind: 'group-header'; key: string; label: string; count: number; collapsed: boolean }
  | { kind: 'stream'; key: string; stream: OperationalStreamSnapshot }

const HEALTH_GROUP_LABELS: Record<string, string> = {
  HEALTHY: 'Healthy',
  DEGRADED: 'Degraded',
  ERROR: 'Error',
  IDLE: 'Idle',
  DISABLED: 'Disabled',
}

function streamSearchHaystack(stream: OperationalStreamSnapshot): string {
  return `${stream.stream_name} ${stream.stream_id}`.toLowerCase()
}

/** Memo-friendly filter: tab + debounced search query. */
export function filterOperationalStreams(
  streams: readonly OperationalStreamSnapshot[],
  tab: StreamHealthTab,
  searchQuery: string,
): OperationalStreamSnapshot[] {
  const q = searchQuery.trim().toLowerCase()
  if (!q && tab === 'all') return [...streams]
  const out: OperationalStreamSnapshot[] = []
  for (const s of streams) {
    if (!streamMatchesTab(s, tab)) continue
    if (q && !streamSearchHaystack(s).includes(q)) continue
    out.push(s)
  }
  return out
}

function primaryDestinationTypeForStream(
  streamId: number,
  routes: readonly OperationalRouteSnapshot[],
): string {
  for (const r of routes) {
    if (r.stream_id === streamId && r.destination_type) {
      return r.destination_type.replace(/_/g, ' ')
    }
  }
  return 'Unknown destination'
}

function groupKeyForStream(
  stream: OperationalStreamSnapshot,
  mode: StreamTopologyGroupMode,
  routes: readonly OperationalRouteSnapshot[],
): string {
  switch (mode) {
    case 'health':
      if (!stream.enabled) return 'DISABLED'
      return stream.health_status
    case 'connector':
      return stream.connector_id != null ? `connector-${stream.connector_id}` : 'connector-unknown'
    case 'destination':
      return `dest-${primaryDestinationTypeForStream(stream.stream_id, routes)}`
    default:
      return 'all'
  }
}

function groupLabel(key: string, mode: StreamTopologyGroupMode): string {
  if (mode === 'health') return HEALTH_GROUP_LABELS[key] ?? key
  if (mode === 'connector') {
    if (key === 'connector-unknown') return 'Unknown connector'
    return `Connector #${key.replace('connector-', '')}`
  }
  if (mode === 'destination') return key.replace('dest-', '')
  return key
}

export function buildStreamVirtualItems(
  streams: readonly OperationalStreamSnapshot[],
  mode: StreamTopologyGroupMode,
  routes: readonly OperationalRouteSnapshot[],
  collapsedGroups: ReadonlySet<string>,
): StreamVirtualItem[] {
  if (mode === 'none' || streams.length === 0) {
    return streams.map((s) => ({ kind: 'stream', key: `s-${s.stream_id}`, stream: s }))
  }

  const buckets = new Map<string, OperationalStreamSnapshot[]>()
  for (const s of streams) {
    const key = groupKeyForStream(s, mode, routes)
    const list = buckets.get(key) ?? []
    list.push(s)
    buckets.set(key, list)
  }

  const keys = [...buckets.keys()].sort((a, b) => {
    if (mode === 'health') {
      const order = ['ERROR', 'DEGRADED', 'HEALTHY', 'IDLE', 'DISABLED']
      return order.indexOf(a) - order.indexOf(b)
    }
    return a.localeCompare(b)
  })

  const items: StreamVirtualItem[] = []
  for (const key of keys) {
    const groupStreams = buckets.get(key) ?? []
    const collapsed = collapsedGroups.has(key)
    items.push({
      kind: 'group-header',
      key: `g-${key}`,
      label: groupLabel(key, mode),
      count: groupStreams.length,
      collapsed,
    })
    if (!collapsed) {
      for (const s of groupStreams) {
        items.push({ kind: 'stream', key: `s-${s.stream_id}`, stream: s })
      }
    }
  }
  return items
}

/** Flatten virtual items into grid rows (group header = full-width row). */
export type StreamGridRow =
  | { kind: 'group-header'; key: string; label: string; count: number; collapsed: boolean; groupKey: string }
  | { kind: 'cards'; key: string; streams: OperationalStreamSnapshot[] }

export function buildStreamGridRows(items: readonly StreamVirtualItem[], columns: number): StreamGridRow[] {
  const rows: StreamGridRow[] = []
  let cardBuffer: OperationalStreamSnapshot[] = []
  const flushCards = () => {
    if (cardBuffer.length === 0) return
    for (let i = 0; i < cardBuffer.length; i += columns) {
      const chunk = cardBuffer.slice(i, i + columns)
      rows.push({
        kind: 'cards',
        key: `row-${chunk.map((s) => s.stream_id).join('-')}`,
        streams: chunk,
      })
    }
    cardBuffer = []
  }

  for (const item of items) {
    if (item.kind === 'group-header') {
      flushCards()
      rows.push({
        kind: 'group-header',
        key: item.key,
        label: item.label,
        count: item.count,
        collapsed: item.collapsed,
        groupKey: item.key.replace(/^g-/, ''),
      })
      continue
    }
    cardBuffer.push(item.stream)
  }
  flushCards()
  return rows
}

export function extractGroupKeysFromVirtualItems(items: readonly StreamVirtualItem[]): string[] {
  return items
    .filter((i): i is Extract<StreamVirtualItem, { kind: 'group-header' }> => i.kind === 'group-header')
    .map((i) => i.key.replace(/^g-/, ''))
}
