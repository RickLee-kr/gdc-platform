import { beforeEach, describe, expect, it, vi } from 'vitest'
import { persistWizardStreamArtifacts } from './wizard-stream-artifacts-persist'
import { buildInitialState } from './wizard-state'

const saveStreamSampleData = vi.fn()
const updateStream = vi.fn()
const fetchStreamById = vi.fn()

vi.mock('../../../api/gdcStreamConfiguration', () => ({
  saveStreamSampleData: (...args: unknown[]) => saveStreamSampleData(...args),
}))

vi.mock('../../../api/gdcStreams', () => ({
  updateStream: (...args: unknown[]) => updateStream(...args),
  fetchStreamById: (...args: unknown[]) => fetchStreamById(...args),
}))

describe('persistWizardStreamArtifacts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    saveStreamSampleData.mockResolvedValue({})
    updateStream.mockResolvedValue({})
    fetchStreamById.mockResolvedValue({ config_json: { method: 'GET' } })
  })

  it('persists sample-data and union_schema together (create/edit shared path)', async () => {
    const state = buildInitialState()
    state.apiTest.finishedAt = Date.now()
    state.apiTest.parsedJson = { data: [{ id: '1' }] }
    state.apiTest.extractedEvents = [{ id: '1' }]
    state.apiTest.statusCode = 200
    state.apiTest.unionSchema = {
      total_events: 1,
      fields: [{ field_path: 'id', field_type: 'string', occurrence_count: 1, sample_values: ['1'] }],
    }
    state.stream.eventArrayPath = 'data'

    const result = await persistWizardStreamArtifacts(42, state, {
      existingConfigJson: { method: 'GET', endpoint: '/x' },
    })

    expect(result.errors).toEqual([])
    expect(saveStreamSampleData).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        sample_events: [{ id: '1' }],
        record_path: '$.data',
        union_schema: expect.objectContaining({ total_events: 1 }),
      }),
    )
    expect(updateStream).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        config_json: expect.objectContaining({
          method: 'GET',
          endpoint: '/x',
          union_schema: expect.objectContaining({ total_events: 1 }),
        }),
      }),
    )
  })

  it('skips sample-data PUT when there is nothing to persist', async () => {
    const state = buildInitialState()
    const result = await persistWizardStreamArtifacts(7, state, { existingConfigJson: {} })
    expect(result.errors).toEqual([])
    expect(saveStreamSampleData).not.toHaveBeenCalled()
    expect(updateStream).not.toHaveBeenCalled()
  })
})
