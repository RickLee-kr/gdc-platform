import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import * as gdcTemplates from '../../api/gdcTemplates'
import { TemplateUseModal } from './template-use-modal'

vi.mock('../../api/gdcTemplates', () => ({
  fetchTemplatesList: vi.fn(),
  fetchTemplateDetail: vi.fn(),
  instantiateTemplate: vi.fn(),
}))

vi.mock('../../api/gdcDestinations', () => ({
  fetchDestinationsList: vi.fn(async () => []),
}))

const bearerTemplate = {
  template_id: 'generic_rest_polling',
  name: 'Generic REST Polling',
  category: 'Common',
  description: 'd',
  source_type: 'HTTP_API_POLLING',
  auth_type: 'bearer',
  tags: [] as string[],
  included_components: [] as string[],
  recommended_destinations: [] as string[],
}

describe('TemplateUseModal', () => {
  it('submits and calls onCreated with redirect path', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onCreated = vi.fn()
    vi.mocked(gdcTemplates.instantiateTemplate).mockResolvedValue({
      template_id: 'generic_rest_polling',
      connector_id: 1,
      source_id: 2,
      stream_id: 3,
      mapping_id: 4,
      enrichment_id: 5,
      checkpoint_id: 6,
      route_id: null,
      redirect_path: '/streams/3/runtime',
    })

    render(
      <TemplateUseModal open template={bearerTemplate} onClose={onClose} onCreated={onCreated} />,
    )

    await user.clear(screen.getByLabelText(/Connector name/i, { selector: 'input' }))
    await user.type(screen.getByLabelText(/Connector name/i, { selector: 'input' }), 'My connector')
    await user.type(screen.getByLabelText(/Host \/ base URL/i, { selector: 'input' }), 'https://api.example.com')
    await user.type(screen.getByLabelText(/^Bearer token$/i, { selector: 'input' }), 'secret-token')
    await user.click(screen.getByRole('button', { name: /Create scaffolding/i }))

    await waitFor(() => {
      expect(gdcTemplates.instantiateTemplate).toHaveBeenCalledWith(
        'generic_rest_polling',
        expect.objectContaining({
          connector_name: 'My connector',
          host: 'https://api.example.com',
          credentials: { bearer_token: 'secret-token' },
        }),
      )
    })
    expect(onCreated).toHaveBeenCalledWith('/streams/3/runtime')
    expect(onClose).toHaveBeenCalled()
  })
})
