import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { StepSource } from './step-source'
import { buildInitialState } from './wizard-state'

vi.mock('../../../api/gdcCatalog', () => ({
  fetchCatalogSnapshot: vi.fn(async () => ({ connectors: [], sources: [], apiBacked: false })),
}))

vi.mock('../../../api/gdcConnectors', () => ({
  fetchConnectorById: vi.fn(async () => null),
}))

vi.mock('../../../api/gdcSources', () => ({
  fetchSourceById: vi.fn(async () => null),
}))

describe('StepSource', () => {
  it('shows create connector CTA when no connector exists', async () => {
    const state = buildInitialState()
    render(
      <MemoryRouter>
        <StepSource state={state} onChange={() => {}} />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Create a Generic HTTP Connector first')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Connector Create Page' })).toHaveAttribute('href', '/connectors/new')
  })
})
