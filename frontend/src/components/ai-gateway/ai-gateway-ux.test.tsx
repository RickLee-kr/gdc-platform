import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AiStreamsPage } from './ai-streams-page'
import { AiProvidersPage } from './ai-providers-page'
import { AiTrafficPage } from './ai-traffic-page'
import * as gdcAiStreams from '../../api/gdcAiStreams'
import * as gdcAiProviders from '../../api/gdcAiProviders'
import * as gdcStreams from '../../api/gdcStreams'

describe('AI Gateway UX (Sprint 2)', () => {
  beforeEach(() => {
    vi.spyOn(gdcAiStreams, 'fetchAiStreamsList').mockResolvedValue([])
    vi.spyOn(gdcAiProviders, 'fetchAiProvidersList').mockResolvedValue([])
    vi.spyOn(gdcStreams, 'fetchStreamsList').mockResolvedValue([])
    vi.spyOn(gdcAiProviders, 'fetchAiTrafficSummary').mockResolvedValue({
      window_hours: 24,
      stream_id: null,
      requests: 0,
      success_count: 0,
      failure_count: 0,
      success_rate: 0,
      error_rate: 0,
      avg_latency_ms: 0,
      top_providers: [],
      failover_count: 0,
      replay_count: 0,
      inspected_count: 0,
      blocked_count: 0,
      masked_count: 0,
      redacted_count: 0,
      policy_blocks: 0,
      prompt_masks: 0,
      response_masks: 0,
    })
  })

  it('shows empty state CTA on AI providers page', async () => {
    render(
      <MemoryRouter>
        <AiProvidersPage />
      </MemoryRouter>,
    )
    expect(await screen.findByTestId('ai-providers-empty-state')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Streams setup' })).toHaveAttribute('href', '/streams')
  })

  it('shows empty state CTA on AI streams page', async () => {
    render(
      <MemoryRouter>
        <AiStreamsPage />
      </MemoryRouter>,
    )
    expect(await screen.findByTestId('ai-streams-empty-state')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create stream' })).toHaveAttribute('href', '/streams')
  })

  it('renders stream and provider names instead of raw IDs', async () => {
    vi.spyOn(gdcAiStreams, 'fetchAiStreamsList').mockResolvedValue([
      {
        id: 1,
        stream_id: 10,
        provider_id: 20,
        slug: 'chat-api',
        model: 'gpt-4o',
        enabled: true,
      },
    ])
    vi.spyOn(gdcAiProviders, 'fetchAiProvidersList').mockResolvedValue([
      {
        id: 20,
        name: 'OpenAI Prod',
        provider_type: 'OPENAI',
        enabled: true,
        endpoint_url: 'https://api.openai.com',
        default_model: 'gpt-4o',
        timeout_seconds: 30,
        auth_json: {},
      },
    ])
    vi.spyOn(gdcStreams, 'fetchStreamsList').mockResolvedValue([
      { id: 10, name: 'Support Bot', connector_id: 1, source_id: 1, enabled: true } as never,
    ])

    render(
      <MemoryRouter>
        <AiStreamsPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Support Bot')).toBeInTheDocument()
    expect(screen.getByText('OpenAI Prod')).toBeInTheDocument()
    expect(screen.queryByText('10')).not.toBeInTheDocument()
    expect(screen.queryByText('20')).not.toBeInTheDocument()
  })

  it('shows traffic empty state when no requests recorded', async () => {
    render(
      <MemoryRouter>
        <AiTrafficPage />
      </MemoryRouter>,
    )
    expect(await screen.findByTestId('ai-traffic-empty-state')).toBeInTheDocument()
  })
})
