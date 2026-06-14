import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WizardBasicMappingPanel } from './wizard-basic-mapping-panel'
import { buildInitialState } from './wizard-state'

vi.mock('./metadata-mapping-menu', () => ({
  MetadataMappingMenu: () => <button type="button">Apply metadata profile</button>,
}))

describe('WizardBasicMappingPanel layout (206f0f7)', () => {
  it('uses side-by-side grid for sample tree and field mapping at xl breakpoint', () => {
    const state = buildInitialState()
    state.apiTest.status = 'success'
    state.apiTest.parsedJson = { events: [{ id: 'e1', message: 'hello' }] }
    state.apiTest.extractedEvents = [{ id: 'e1', message: 'hello' }]

    const { container } = render(<WizardBasicMappingPanel state={state} onChangeMapping={() => {}} />)

    expect(screen.getByText('Sample Event')).toBeInTheDocument()
    expect(screen.getByText('Field Mapping')).toBeInTheDocument()
    const grid = container.querySelector('.xl\\:grid-cols-\\[minmax\\(300px\\,1\\.15fr\\)_minmax\\(280px\\,1fr\\)_minmax\\(320px\\,1\\.05fr\\)\\]')
    expect(grid).toBeTruthy()
  })
})
