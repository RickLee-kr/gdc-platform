type UnknownRec = Record<string, unknown>

export type RuntimeTimelineCard = {
  id: string
  timestamp: string
  stage: string
  level: string
  status: string
  message: string
  streamId: string
  routeId: string
  destinationId: string
  errorCode: string
  httpStatus: string
  retryCount: string
  payloadSample: string
}

function asRecord(value: unknown): UnknownRec | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as UnknownRec
  }
  return null
}

function readString(rec: UnknownRec, key: string): string {
  const v = rec[key]
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

function firstNonEmpty(rec: UnknownRec, keys: string[]): string {
  for (const key of keys) {
    const value = readString(rec, key).trim()
    if (value) return value
  }
  return ''
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

export function buildTimelineCards(items: unknown[]): RuntimeTimelineCard[] {
  return items
    .map((item, idx) => {
      const rec = asRecord(item)
      if (!rec) return null
      const id = firstNonEmpty(rec, ['id']) || `row-${idx}`
      const timestamp = firstNonEmpty(rec, ['created_at', 'timestamp', 'occurred_at']) || '—'
      const stage = firstNonEmpty(rec, ['stage']) || '—'
      const level = firstNonEmpty(rec, ['level']) || '—'
      const status = firstNonEmpty(rec, ['status']) || '—'
      const message = firstNonEmpty(rec, ['message']) || '—'
      const streamId = firstNonEmpty(rec, ['stream_id'])
      const routeId = firstNonEmpty(rec, ['route_id'])
      const destinationId = firstNonEmpty(rec, ['destination_id'])
      const errorCode = firstNonEmpty(rec, ['error_code'])
      const httpStatus = firstNonEmpty(rec, ['http_status', 'status_code'])
      const retryCount = firstNonEmpty(rec, ['retry_count', 'retry_attempt'])
      const payloadSampleObj = rec.payload_sample ?? rec.payload ?? rec.sample
      const payloadSample = payloadSampleObj !== undefined ? compactJson(payloadSampleObj) : ''
      return {
        id,
        timestamp,
        stage,
        level,
        status,
        message,
        streamId,
        routeId,
        destinationId,
        errorCode,
        httpStatus,
        retryCount,
        payloadSample,
      }
    })
    .filter((row): row is RuntimeTimelineCard => row !== null)
}

export type TimelineLocalFilters = {
  stage: string
  levelStatus: string
  streamRouteDestination: string
}

export function filterTimelineCards(cards: RuntimeTimelineCard[], filters: TimelineLocalFilters): RuntimeTimelineCard[] {
  const stageNeedle = filters.stage.trim().toLowerCase()
  const levelStatusNeedle = filters.levelStatus.trim().toLowerCase()
  const entityNeedle = filters.streamRouteDestination.trim().toLowerCase()
  return cards.filter((card) => {
    const stageOk = !stageNeedle || card.stage.toLowerCase().includes(stageNeedle)
    const levelStatusText = `${card.level} ${card.status}`.toLowerCase()
    const levelStatusOk = !levelStatusNeedle || levelStatusText.includes(levelStatusNeedle)
    const entityText = `${card.streamId} ${card.routeId} ${card.destinationId}`.toLowerCase()
    const entityOk = !entityNeedle || entityText.includes(entityNeedle)
    return stageOk && levelStatusOk && entityOk
  })
}
