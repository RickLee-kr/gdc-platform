import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { TemplatesOverviewPage } from './templates-overview-page'

const sampleTemplates = [
  {
    template_id: 'generic_rest_polling',
    name: 'Generic REST Polling',
    category: 'Common',
    description: 'Test description',
    source_type: 'HTTP_API_POLLING',
    auth_type: 'bearer',
    tags: ['rest'],
    included_components: ['connector', 'stream'],
    recommended_destinations: ['WEBHOOK_POST'],
  },
]

vi.mock('../../api/gdcTemplates', () => ({
  fetchTemplatesList: vi.fn(async () => sampleTemplates),
  fetchTemplateDetail: vi.fn(async () => ({
    template_id: 'generic_rest_polling',
    name: 'Generic REST Polling',
    category: 'Common',
    description: 'Detail',
    mapping_defaults: { event_array_path: '$.data' },
    enrichment_defaults: {},
    checkpoint_defaults: {},
    route_suggestions: [],
    setup_instructions: ['Step one'],
    preview: { sample_api_structure: { data: [] } },
  })),
  instantiateTemplate: vi.fn(async () => ({
    template_id: 'generic_rest_polling',
    connector_id: 1,
    source_id: 2,
    stream_id: 3,
    mapping_id: 4,
    enrichment_id: 5,
    checkpoint_id: 6,
    route_id: null,
    redirect_path: '/streams/3/runtime',
  })),
}))

vi.mock('../../api/gdcDestinations', () => ({
  fetchDestinationsList: vi.fn(async () => []),
}))

describe('TemplatesOverviewPage', () => {
  it('renders template cards and opens preview drawer', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <TemplatesOverviewPage />
      </MemoryRouter>,
    )
    expect(await screen.findByText('Generic REST Polling')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Preview' }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Template preview' })).toBeInTheDocument())
    expect(screen.getByText('Setup')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close preview' }))
  })

  it('filters templates by search', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <TemplatesOverviewPage />
      </MemoryRouter>,
    )
    await screen.findByText('Generic REST Polling')
    const search = screen.getByRole('searchbox', { name: 'Search templates' })
    await user.type(search, 'zzzz-notfound')
    expect(screen.getByText(/No templates match/i)).toBeInTheDocument()
  })

  it('opens use-template dialog', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <TemplatesOverviewPage />
      </MemoryRouter>,
    )
    await screen.findByText('Generic REST Polling')
    await user.click(screen.getByRole('button', { name: 'Use template' }))
    expect(screen.getByRole('dialog', { name: 'Use template' })).toBeInTheDocument()
  })
})
