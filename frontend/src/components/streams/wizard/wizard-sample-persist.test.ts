import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StreamSampleDataResponse } from '../../../api/gdcStreamConfiguration'
import {
  apiTestPatchFromPersistedSample,
  buildWizardSamplePersistPayload,
} from './wizard-sample-persist'
import { buildInitialState } from './wizard-state'

vi.mock('../../../api/gdcStreamConfiguration', () => ({
  saveStreamSampleData: vi.fn(),
  fetchStreamSampleData: vi.fn(),
}))

describe('buildWizardSamplePersistPayload', () => {
  it('includes sample events, paths, and union schema for create/edit persist', () => {
    const state = buildInitialState()
    state.apiTest.status = 'success'
    state.apiTest.ok = true
    state.apiTest.finishedAt = 1_700_000_000_000
    state.apiTest.statusCode = 200
    state.apiTest.parsedJson = { data: [{ id: '1', msg: 'hi' }] }
    state.apiTest.extractedEvents = [{ id: '1', msg: 'hi' }]
    state.apiTest.unionSchema = {
      total_events: 1,
      fields: [{ field_path: 'id', field_type: 'string', occurrence_count: 1, sample_values: ['1'] }],
    }
    state.stream.eventArrayPath = 'data'
    state.stream.eventRootPath = ''

    const payload = buildWizardSamplePersistPayload({
      apiTest: state.apiTest,
      stream: state.stream,
      unionSchema: state.apiTest.unionSchema,
    })

    expect(payload).not.toBeNull()
    expect(payload?.sample_events).toEqual([{ id: '1', msg: 'hi' }])
    expect(payload?.record_path).toBe('$.data')
    expect(payload?.union_schema?.fields).toHaveLength(1)
    expect(payload?.last_test_response?.http_status).toBe(200)
  })

  it('returns null when there is nothing to persist', () => {
    const state = buildInitialState()
    expect(
      buildWizardSamplePersistPayload({
        apiTest: state.apiTest,
        stream: state.stream,
        unionSchema: null,
      }),
    ).toBeNull()
  })
})

describe('apiTestPatchFromPersistedSample', () => {
  it('restores apiTest and path confirmations from sample-data API', () => {
    const sample: StreamSampleDataResponse = {
      stream_id: 9,
      has_sample_data: true,
      last_test_response: {
        http_status: 200,
        finished_at: '2026-07-13T10:00:00.000Z',
        body_preview: '{"data":[{"id":"a"}]}',
      },
      sample_events: [{ id: 'a', severity: 'LOW' }],
      sample_count: 1,
      union_schema: {
        total_events: 1,
        fields: [
          { field_path: 'id', field_type: 'string', occurrence_count: 1, sample_values: ['a'] },
          { field_path: 'severity', field_type: 'string', occurrence_count: 1, sample_values: ['LOW'] },
        ],
      },
      event_root_path: null,
      record_path: '$.data',
      checkpoint_test_result: null,
      incremental_test_result: null,
      saved_at: '2026-07-13T10:00:00.000Z',
      message: 'ok',
    }

    const patch = apiTestPatchFromPersistedSample(sample)
    expect(patch).not.toBeNull()
    expect(patch?.apiTest.status).toBe('success')
    expect(patch?.apiTest.ok).toBe(true)
    expect(patch?.apiTest.extractedEvents).toEqual([{ id: 'a', severity: 'LOW' }])
    expect(patch?.apiTest.eventCount).toBe(1)
    expect(patch?.apiTest.unionSchema?.fields).toHaveLength(2)
    expect(patch?.stream.eventArrayPath).toBe('data')
    expect(patch?.stream.recordPathConfirmedForApiTestAt).toBe(patch?.apiTest.finishedAt)
  })

  it('returns null when sample-data is empty', () => {
    expect(apiTestPatchFromPersistedSample(null)).toBeNull()
    expect(
      apiTestPatchFromPersistedSample({
        stream_id: 1,
        has_sample_data: false,
        last_test_response: null,
        sample_events: [],
        sample_count: 0,
        union_schema: null,
        event_root_path: null,
        record_path: null,
        checkpoint_test_result: null,
        incremental_test_result: null,
        saved_at: null,
        message: 'No sample data saved yet',
      }),
    ).toBeNull()
  })

  it('restores whole-response record path as useWholeResponseAsEvent', () => {
    const patch = apiTestPatchFromPersistedSample({
      stream_id: 2,
      has_sample_data: true,
      last_test_response: { http_status: 200, finished_at: '2026-07-13T11:00:00.000Z' },
      sample_events: [{ id: '1' }],
      sample_count: 1,
      union_schema: {
        total_events: 1,
        fields: [{ field_path: 'id', field_type: 'string', occurrence_count: 1, sample_values: ['1'] }],
      },
      event_root_path: null,
      record_path: '$',
      checkpoint_test_result: null,
      incremental_test_result: null,
      saved_at: '2026-07-13T11:00:00.000Z',
      message: 'ok',
    })
    expect(patch?.stream.useWholeResponseAsEvent).toBe(true)
    expect(patch?.stream.eventArrayPath).toBe('')
  })
})

describe('persist round-trip helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('build → hydrate restores union schema and sample events', () => {
    const state = buildInitialState()
    state.apiTest.finishedAt = Date.parse('2026-07-13T12:00:00.000Z')
    state.apiTest.parsedJson = { items: [{ id: 'x' }] }
    state.apiTest.extractedEvents = [{ id: 'x' }]
    state.apiTest.statusCode = 200
    state.apiTest.unionSchema = {
      total_events: 1,
      fields: [{ field_path: 'id', field_type: 'string', occurrence_count: 1, sample_values: ['x'] }],
    }
    state.stream.eventArrayPath = 'items'

    const built = buildWizardSamplePersistPayload({
      apiTest: state.apiTest,
      stream: state.stream,
      unionSchema: state.apiTest.unionSchema,
    })
    expect(built).not.toBeNull()

    const sample: StreamSampleDataResponse = {
      stream_id: 3,
      has_sample_data: true,
      last_test_response: built!.last_test_response ?? null,
      sample_events: built!.sample_events ?? [],
      sample_count: built!.sample_events?.length ?? 0,
      union_schema: built!.union_schema ?? null,
      event_root_path: built!.event_root_path ?? null,
      record_path: built!.record_path ?? null,
      checkpoint_test_result: null,
      incremental_test_result: null,
      saved_at: '2026-07-13T12:00:00.000Z',
      message: 'ok',
    }

    const hydrated = apiTestPatchFromPersistedSample(sample)
    expect(hydrated?.apiTest.extractedEvents).toEqual([{ id: 'x' }])
    expect(hydrated?.apiTest.unionSchema?.fields[0]?.field_path).toBe('id')
    expect(hydrated?.stream.eventArrayPath).toBe('items')
  })
})
