import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { StepDelivery } from './step-delivery'
import { buildInitialState } from './wizard-state'

vi.mock('../../../api/gdcDestinations', () => ({
  fetchDestinationsList: vi.fn(async () => [
    {
      id: 1,
      name: 'Stellar Syslog',
      destination_type: 'SYSLOG_UDP',
      config_json: { host: '10.0.0.1', port: 514 },
      rate_limit_json: {},
      enabled: true,
      streams_using_count: 0,
      routes: [],
    },
    {
      id: 2,
      name: 'Backup Webhook',
      destination_type: 'WEBHOOK_POST',
      config_json: { url: 'https://hook.example.com' },
      rate_limit_json: {},
      enabled: true,
      streams_using_count: 0,
      routes: [],
    },
  ]),
}))

describe('StepDelivery', () => {
  it('loads real destinations from API and shows operational destinations copy', async () => {
    const state = buildInitialState()
    const onChange = vi.fn()
    render(
      <MemoryRouter>
        <StepDelivery state={state} onChange={onChange} />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Stellar Syslog')).toBeInTheDocument()
    expect(screen.getByText('Backup Webhook')).toBeInTheDocument()
    expect(
      screen.getByText(/Configure where enriched events will be delivered/i),
    ).toBeInTheDocument()

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          destinationApiBacked: true,
        }),
      )
    })
  })
})
