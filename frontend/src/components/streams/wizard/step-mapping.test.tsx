import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StepMapping } from './step-mapping'
import { buildInitialState } from './wizard-state'

function readyTransformState() {
  const state = buildInitialState()
  state.apiTest.status = 'success'
  state.apiTest.parsedJson = { events: [{ id: 'e1', message: 'hello' }] }
  state.apiTest.extractedEvents = [{ id: 'e1', message: 'hello' }]
  state.apiTest.eventCount = 1
  state.apiTest.finishedAt = Date.now()
  state.stream.eventArrayPath = '$.events'
  return state
}

function stepMappingProps(state: ReturnType<typeof buildInitialState>) {
  return {
    state,
    onChangeMapping: vi.fn(),
    onChangeMappingMode: vi.fn(),
    onChangeFullEventJsonata: vi.fn(),
    onChangeFullEventRegexConfigJson: vi.fn(),
    transformRules: [],
    onChangeTransformRules: vi.fn(),
  }
}

describe('StepMapping legacy mapping step', () => {
  it('renders Basic, Advanced, and Expert tabs with wizard sample', () => {
    const state = readyTransformState()
    state.stream.useWholeResponseAsEvent = true

    render(<StepMapping {...stepMappingProps(state)} />)

    expect(screen.getByRole('tab', { name: /Basic · JSONPath/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Advanced · JSONata/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Expert · Full Event Regex/i })).toBeInTheDocument()
  })
})
