import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TemplateDraftPreviewModal } from './template-draft-preview-modal'

vi.mock('../../api/gdcTemplateDrafts', () => ({
  previewTemplateDraftInference: vi.fn(async () => ({
    event_array_path: '$.data.events',
    event_array_candidates: [{ path: '$.data.events', confidence: 0.9, reason: 'test', count: 1 }],
    mapping_candidates: [{ output_field: 'event_id', source_json_path: '$.id', confidence: 0.88, reason: 'id field' }],
    enrichment_candidates: [{ field_name: 'vendor', suggested_value: 'acme', confidence: 0.75, reason: 'metadata' }],
    checkpoint_recommendation: { field_path: '$.data.next_cursor', checkpoint_type: 'CURSOR', confidence: 0.9, reason: 'cursor' },
    normalized_event_preview: { event_id: '1' },
  })),
  createTemplateDraft: vi.fn(async () => ({ id: 'draft-test', display_name: 'Saved' })),
}))

describe('TemplateDraftPreviewModal', () => {
  it('renders inference preview and save action', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <TemplateDraftPreviewModal
        open
        onClose={onClose}
        importSource="CURL"
        displayNameDefault="Imported draft"
        requestStructure={{ method: 'GET', endpoint: '/v1/events', base_url: 'https://api.example.com' }}
        samplePayload={{ data: { events: [{ id: '1' }] } }}
      />,
    )
    expect(screen.getByRole('dialog', { name: /Template Draft preview/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Mapping candidates' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Save Template Draft/i }))
  })
})
