import type { StreamSampleDataResponse } from '../../../api/gdcStreamConfiguration'
import { saveStreamSampleData } from '../../../api/gdcStreamConfiguration'
import type { UnionSchema, UnionSchemaField } from '../../../utils/unionSchema'
import type {
  WizardApiTestState,
  WizardConfigState,
  WizardIncrementalRequestTestResult,
} from './wizard-state'

export type WizardSamplePersistPayload = {
  last_test_response?: Record<string, unknown>
  sample_events?: Record<string, unknown>[]
  union_schema?: Record<string, unknown>
  event_root_path?: string
  record_path?: string
  incremental_test_result?: Record<string, unknown>
  checkpoint_test_result?: Record<string, unknown>
}

export function buildWizardSamplePersistPayload(args: {
  apiTest: WizardApiTestState
  stream: Pick<WizardConfigState, 'eventRootPath' | 'eventArrayPath' | 'useWholeResponseAsEvent'>
  unionSchema?: UnionSchema | null
  incrementalTestResult?: WizardIncrementalRequestTestResult | null
}): WizardSamplePersistPayload | null {
  const { apiTest, stream, unionSchema, incrementalTestResult } = args
  const hasApi = Boolean(apiTest.finishedAt && apiTest.parsedJson != null)
  const hasUnion = Boolean(unionSchema?.fields?.length)
  const hasIncremental = Boolean(incrementalTestResult)
  if (!hasApi && !hasUnion && !hasIncremental) return null

  const payload: WizardSamplePersistPayload = {}

  if (hasApi) {
    payload.last_test_response = {
      http_status: apiTest.statusCode,
      finished_at: apiTest.finishedAt ? new Date(apiTest.finishedAt).toISOString() : null,
      body_preview:
        typeof apiTest.rawBody === 'string'
          ? apiTest.rawBody.slice(0, 8000)
          : apiTest.parsedJson != null
            ? JSON.stringify(apiTest.parsedJson).slice(0, 8000)
            : null,
    }
    const events = apiTest.extractedEvents?.length
      ? apiTest.extractedEvents
      : apiTest.analysis?.sampleEvent
        ? [apiTest.analysis.sampleEvent as Record<string, unknown>]
        : []
    if (events.length) {
      payload.sample_events = events.slice(0, 50)
    }
  }

  if (unionSchema?.fields?.length) {
    payload.union_schema = {
      total_events: unionSchema.total_events,
      fields: unionSchema.fields,
      snapshot_at: new Date().toISOString(),
    }
  }

  if (stream.eventRootPath?.trim()) {
    payload.event_root_path = stream.eventRootPath.trim().startsWith('$')
      ? stream.eventRootPath.trim()
      : `$.${stream.eventRootPath.trim()}`
  }
  if (stream.eventArrayPath?.trim()) {
    payload.record_path = stream.eventArrayPath.trim().startsWith('$')
      ? stream.eventArrayPath.trim()
      : `$.${stream.eventArrayPath.trim()}`
  } else if (stream.useWholeResponseAsEvent) {
    payload.record_path = '$'
  }

  if (incrementalTestResult) {
    payload.incremental_test_result = {
      status: incrementalTestResult.status,
      http_status: incrementalTestResult.httpStatus,
      returned_record_count: incrementalTestResult.returnedRecordCount,
      message: incrementalTestResult.message,
      substituted_request_body: incrementalTestResult.substitutedRequestBody,
    }
  }

  return payload
}

export async function persistWizardSampleData(
  streamId: number,
  payload: WizardSamplePersistPayload,
): Promise<void> {
  if (!payload || Object.keys(payload).length === 0) return
  await saveStreamSampleData(streamId, payload)
}

function stripJsonPathPrefix(path: string | null | undefined): string {
  const trimmed = String(path ?? '').trim()
  if (!trimmed) return ''
  return trimmed.startsWith('$.') ? trimmed.slice(2) : trimmed
}

function normalizePersistedUnionSchema(raw: unknown): UnionSchema | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const fieldsRaw = obj.fields
  if (!Array.isArray(fieldsRaw) || fieldsRaw.length === 0) return null
  const fields: UnionSchemaField[] = []
  for (const item of fieldsRaw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const fieldPath = typeof row.field_path === 'string' ? row.field_path.trim() : ''
    if (!fieldPath) continue
    fields.push({
      field_path: fieldPath,
      field_type: typeof row.field_type === 'string' ? row.field_type : 'string',
      occurrence_count: typeof row.occurrence_count === 'number' ? row.occurrence_count : 1,
      sample_values: Array.isArray(row.sample_values) ? row.sample_values.slice(0, 5) : [],
    })
  }
  if (!fields.length) return null
  return {
    total_events: typeof obj.total_events === 'number' ? obj.total_events : fields.length,
    fields,
  }
}

export type PersistedSampleHydratePatch = {
  apiTest: Partial<WizardApiTestState>
  stream: Partial<WizardConfigState>
}

/**
 * Rebuild wizard apiTest (+ path confirmations) from GET .../sample-data.
 * Returns null when nothing useful was persisted (Edit Wizard keeps empty state).
 */
export function apiTestPatchFromPersistedSample(
  sample: StreamSampleDataResponse | null | undefined,
): PersistedSampleHydratePatch | null {
  if (!sample) return null

  const events = Array.isArray(sample.sample_events)
    ? sample.sample_events.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && !Array.isArray(e))
    : []
  const unionSchema = normalizePersistedUnionSchema(sample.union_schema)
  const lastTest =
    sample.last_test_response && typeof sample.last_test_response === 'object' && !Array.isArray(sample.last_test_response)
      ? sample.last_test_response
      : null

  if (!events.length && !unionSchema && !lastTest && !sample.event_root_path && !sample.record_path) {
    return null
  }

  const finishedAtRaw =
    typeof lastTest?.finished_at === 'string'
      ? Date.parse(lastTest.finished_at)
      : typeof sample.saved_at === 'string'
        ? Date.parse(sample.saved_at)
        : Number.NaN
  const finishedAt = Number.isFinite(finishedAtRaw) ? finishedAtRaw : Date.now()

  const bodyPreview = typeof lastTest?.body_preview === 'string' ? lastTest.body_preview : null
  let parsedJson: unknown = null
  if (bodyPreview) {
    try {
      parsedJson = JSON.parse(bodyPreview)
    } catch {
      parsedJson = null
    }
  }
  if (parsedJson == null && events.length) {
    parsedJson = events.length === 1 ? events[0] : { data: events }
  }

  const eventCount = sample.sample_count > 0 ? sample.sample_count : events.length
  const statusCode = typeof lastTest?.http_status === 'number' ? lastTest.http_status : 200

  const recordPathRaw = String(sample.record_path ?? '').trim()
  const useWholeResponseAsEvent = recordPathRaw === '$'
  const eventArrayPath = useWholeResponseAsEvent ? '' : stripJsonPathPrefix(recordPathRaw)
  const eventRootPath = stripJsonPathPrefix(sample.event_root_path)

  const apiTest: Partial<WizardApiTestState> = {
    status: 'success',
    ok: true,
    statusCode,
    finishedAt,
    startedAt: finishedAt,
    extractedEvents: events,
    eventCount,
    unionSchema,
    parsedJson,
    rawResponse: parsedJson,
    rawBody: bodyPreview,
    apiBacked: true,
    analysis: events[0]
      ? {
          responseSummary: {
            root_type: Array.isArray(parsedJson) ? 'array' : 'object',
            approx_size_bytes: bodyPreview?.length ?? 0,
            top_level_keys: [],
            item_count_root: Array.isArray(parsedJson) ? parsedJson.length : eventCount || null,
            truncation: null,
          },
          detectedArrays: [],
          detectedCheckpointCandidates: [],
          sampleEvent: events[0],
          selectedEventArrayDefault: null,
          flatPreviewFields: unionSchema?.fields.map((f) => f.field_path) ?? Object.keys(events[0]),
          eventRootCandidates: [],
          previewError: null,
        }
      : null,
  }

  const stream: Partial<WizardConfigState> = {
    eventRootPath,
    eventArrayPath,
    useWholeResponseAsEvent,
    recordPathConfirmedForApiTestAt: eventArrayPath || useWholeResponseAsEvent ? finishedAt : null,
    eventRootConfirmedForApiTestAt: eventRootPath ? finishedAt : null,
  }

  return { apiTest, stream }
}
