import type { UnionSchema } from './unionSchema'

/** SoT minimum sample events for Union Schema collection. */
export const UNION_SCHEMA_MIN_SAMPLE_EVENTS = 10

/** SoT recommended sample events for Union Schema collection. */
export const UNION_SCHEMA_RECOMMENDED_SAMPLE_EVENTS = 20

export type UnionSchemaSampleStatus = 'needs_attention' | 'warning' | 'ready'

export type UnionSchemaSamplePolicy = {
  status: UnionSchemaSampleStatus
  sampleCount: number
  message: string | null
}

export const UNION_SCHEMA_SAMPLE_NEEDS_ATTENTION_MESSAGE =
  'Union Schema was generated from fewer than 10 events. Run API Test again or adjust record selection.'

export const UNION_SCHEMA_SAMPLE_WARNING_MESSAGE =
  'Union Schema was generated from fewer than 20 events. More samples are recommended for better field coverage.'

export function getUnionSchemaSampleStatus(sampleCount: number): UnionSchemaSamplePolicy {
  const count = Number.isFinite(sampleCount) && sampleCount > 0 ? Math.floor(sampleCount) : 0
  if (count < UNION_SCHEMA_MIN_SAMPLE_EVENTS) {
    return {
      status: 'needs_attention',
      sampleCount: count,
      message: UNION_SCHEMA_SAMPLE_NEEDS_ATTENTION_MESSAGE,
    }
  }
  if (count < UNION_SCHEMA_RECOMMENDED_SAMPLE_EVENTS) {
    return {
      status: 'warning',
      sampleCount: count,
      message: UNION_SCHEMA_SAMPLE_WARNING_MESSAGE,
    }
  }
  return { status: 'ready', sampleCount: count, message: null }
}

/** Prefer union schema total_events once generated; otherwise fall back to extracted event counts. */
export function resolveUnionSchemaSampleCount(source: {
  unionSchema?: UnionSchema | null
  eventCount?: number
  extractedEvents?: ReadonlyArray<unknown>
}): number {
  const fromUnion = source.unionSchema?.total_events
  if (typeof fromUnion === 'number' && Number.isFinite(fromUnion) && fromUnion >= 0) {
    return fromUnion
  }
  if (source.extractedEvents?.length) {
    return source.extractedEvents.length
  }
  if (typeof source.eventCount === 'number' && Number.isFinite(source.eventCount) && source.eventCount >= 0) {
    return source.eventCount
  }
  return 0
}
