import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PipelineDebuggerPanel } from './pipeline-debugger-panel'
import * as pipelineDebugApi from '../../api/gdcRuntimePipelineDebug'
import * as mappingSample from '../../utils/mappingSourceSample'

vi.mock('../../api/gdcRuntimePipelineDebug')
vi.mock('../../utils/mappingSourceSample')

describe('PipelineDebuggerPanel', () => {
  it('renders pipeline stages from API response', async () => {
    vi.mocked(mappingSample.fetchMappingSourceSample).mockResolvedValue({
      ok: true,
      sourceType: 'HTTP_API_POLLING',
      rawPayload: { items: [{ id: '1' }] },
      treeDocument: {},
      extractedEvents: [{ id: '1' }],
      eventArrayPath: '$.items',
      eventRootPath: '',
      sampleEventIndex: 0,
      message: null,
      recordsLabel: '1 event',
      fetchedAt: '2026-01-01',
    })
    vi.mocked(pipelineDebugApi.runStreamPipelineDebug).mockResolvedValue({
      stream_id: 42,
      raw_event: { id: '1' },
      mapped_event: { event_id: '1' },
      enriched_event: { event_id: '1', product: 'GDC' },
      formatted_payload: '{"event_id":"1"}',
      routes: [
        {
          route_id: 10,
          destination_id: 20,
          destination_type: 'WEBHOOK_POST',
          formatter_summary: { url: 'https://example.com/hook' },
          delivery_preview: '{"event_id":"1"}',
        },
      ],
      warnings: [],
      errors: [],
    })

    render(<PipelineDebuggerPanel streamId={42} />)

    await waitFor(() => {
      expect(screen.getByText('Pipeline debugger')).toBeInTheDocument()
    })
    expect(screen.getByText('Raw event')).toBeInTheDocument()
    expect(screen.getByText('Mapped event')).toBeInTheDocument()
    expect(screen.getByText('Enriched event')).toBeInTheDocument()
    expect(screen.getByText('Formatted payload')).toBeInTheDocument()
    expect(screen.getByText(/Route 10/)).toBeInTheDocument()
    expect(pipelineDebugApi.runStreamPipelineDebug).toHaveBeenCalledWith(42, {
      raw_event: { items: [{ id: '1' }] },
    })
  })
})
