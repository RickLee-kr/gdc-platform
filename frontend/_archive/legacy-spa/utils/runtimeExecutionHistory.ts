type HistoryEvent = {
  id: string
  stage: string
  level: string
  status: string
  message: string
  createdAt: string
  streamId: string
  routeId: string
  destinationId: string
  payloadSample: string
  raw: Record<string, unknown>
}

export type HistoryGroup = {
  key: string
  title: string
  events: HistoryEvent[]
}

export function buildExecutionHistoryGroups(...sources: unknown[][]): HistoryGroup[] {
  const normalized = sources.flatMap((source, sourceIndex) => normalizeSource(source, sourceIndex))
  const groups = new Map<string, HistoryEvent[]>()
  for (const event of normalized) {
    const key = `${event.streamId}|${event.routeId}|${event.destinationId}`
    const bucket = groups.get(key)
    if (bucket) {
      bucket.push(event)
    } else {
      groups.set(key, [event])
    }
  }
  return Array.from(groups.entries())
    .map(([key, events]) => ({
      key,
      title: `stream=${events[0].streamId} / route=${events[0].routeId} / destination=${events[0].destinationId}`,
      events: events.sort((a, b) => compareEventOrder(a, b)),
    }))
    .sort((a, b) => compareGroupOrder(a, b))
}

function normalizeSource(rows: unknown[], sourceIndex: number): HistoryEvent[] {
  return rows.flatMap((row, rowIndex) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return []
    const raw = row as Record<string, unknown>
    const payloadSample = readPayloadSample(raw)
    return [
      {
        id: `${sourceIndex}-${rowIndex}-${readString(raw.id, '')}-${readString(raw.created_at, '')}`,
        stage: readString(raw.stage, 'UNKNOWN_STAGE'),
        level: readString(raw.level, 'UNKNOWN_LEVEL'),
        status: readString(raw.status, 'UNKNOWN_STATUS'),
        message: readString(raw.message, '(no message)'),
        createdAt: readString(raw.created_at, ''),
        streamId: readAnyId(raw.stream_id),
        routeId: readAnyId(raw.route_id),
        destinationId: readAnyId(raw.destination_id),
        payloadSample,
        raw,
      },
    ]
  })
}

function readPayloadSample(raw: Record<string, unknown>): string {
  if (raw.payload_sample !== undefined) {
    return safeStringify(raw.payload_sample)
  }
  if (raw.payload !== undefined) {
    return safeStringify(raw.payload)
  }
  if (raw.details !== undefined) {
    return safeStringify(raw.details)
  }
  return ''
}

function compareEventOrder(a: HistoryEvent, b: HistoryEvent): number {
  const aTime = Date.parse(a.createdAt)
  const bTime = Date.parse(b.createdAt)
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
    return bTime - aTime
  }
  return b.id.localeCompare(a.id)
}

function compareGroupOrder(a: HistoryGroup, b: HistoryGroup): number {
  const aTop = a.events[0]
  const bTop = b.events[0]
  if (!aTop || !bTop) return 0
  return compareEventOrder(aTop, bTop)
}

function readAnyId(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'n/a'
  return String(value)
}

function readString(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
