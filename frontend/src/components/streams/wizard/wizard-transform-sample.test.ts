import { describe, expect, it } from 'vitest'
import { buildInitialState } from './wizard-state'
import { buildWizardTransformSample, wizardMappingRowsToModel } from './wizard-transform-sample'

describe('wizard-transform-sample', () => {
  it('builds external sample from wizard api test payload', () => {
    const state = buildInitialState()
    state.apiTest.status = 'success'
    state.apiTest.parsedJson = { Records: [{ id: '1', message: 'hi' }] }
    state.stream.eventArrayPath = '$.Records'
    state.stream.eventRootPath = ''

    const sample = buildWizardTransformSample(state)
    expect(sample?.ok).toBe(true)
    expect(sample?.extractedEvents).toHaveLength(1)
    expect(sample?.extractedEvents[0]?.id).toBe('1')
  })

  it('converts wizard mapping rows to workspace model', () => {
    const rows = wizardMappingRowsToModel([
      { id: 'r1', sourceJsonPath: '$.id', outputField: 'event_id', origin: 'auto' },
    ])
    expect(rows[0]?.origin).toBe('auto')
    expect(rows[0]?.outputField).toBe('event_id')
  })
})
