import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectorApiHealthPanel } from './connector-api-health-panel'
import type { ConnectorApiHealthResponse } from '../../api/gdcConnectorApiHealth'

const fetchMock = vi.fn()

vi.mock('../../api/gdcConnectorApiHealth', async () => {
  const actual = await vi.importActual<typeof import('../../api/gdcConnectorApiHealth')>(
    '../../api/gdcConnectorApiHealth',
  )
  return {
    ...actual,
    fetchConnectorApiHealth: (...args: unknown[]) => fetchMock(...args),
  }
})

function healthyBody(): ConnectorApiHealthResponse {
  return {
    connector_id: 7,
    connector_name: 'Demo API',
    connector_status: 'RUNNING',
    health: 'HEALTHY',
    problem: 'Connector/API healthy',
    cause: 'Last auth verification succeeded',
    failure_kind: 'none',
    recommended_action: 'No action required.',
    last_success_at: '2026-08-26T12:00:00Z',
    last_failure_at: null,
    last_auth_check_at: '2026-08-26T12:00:00Z',
    last_auth_check_status: 'success',
    last_auth_error: null,
    credential_status: 'CONNECTED',
    credential_expires_at: null,
    source_rate_limited_count: 0,
    source_fetch_failed_count: 0,
    affected_streams: [],
    evidence: [],
    actions: [
      { id: 'test_connection', label: 'Test Connection', href_hint: 'connector_auth_test' },
      { id: 'view_evidence', label: 'View Evidence', href_hint: 'delivery_logs' },
    ],
    generated_at: '2026-08-26T12:01:00Z',
    evidence_limit: 100,
  }
}

describe('ConnectorApiHealthPanel', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('renders status, problem, cause, and action', async () => {
    fetchMock.mockResolvedValueOnce(healthyBody())
    render(
      <MemoryRouter>
        <ConnectorApiHealthPanel connectorId={7} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('connector-api-health-status')).toHaveTextContent('HEALTHY')
    })
    expect(screen.getByTestId('connector-api-health-problem')).toHaveTextContent('Connector/API healthy')
    expect(screen.getByTestId('connector-api-health-cause')).toHaveTextContent('Last auth verification succeeded')
    expect(screen.getByTestId('connector-api-health-action')).toHaveTextContent('No action required')
    expect(fetchMock).toHaveBeenCalledWith(7)
  })

  it('shows authentication failure and troubleshooter link when streams affected', async () => {
    fetchMock.mockResolvedValueOnce({
      ...healthyBody(),
      health: 'UNHEALTHY',
      problem: '401 Unauthorized',
      cause: 'Last Test Connection / auth check failed',
      failure_kind: 'authentication',
      recommended_action: 'Verify credentials and run Test Connection on this connector.',
      last_auth_check_status: 'failed',
      last_auth_error: '401 Unauthorized',
      last_failure_at: '2026-08-26T12:05:00Z',
      affected_streams: [
        { stream_id: 42, stream_name: 'Alerts', status: 'ERROR', primary_issue: '401 Unauthorized' },
      ],
      actions: [
        { id: 'test_connection', label: 'Test Connection', href_hint: 'connector_auth_test' },
        { id: 'open_troubleshooter', label: 'Open Data Flow Troubleshooter', href_hint: 'stream_troubleshoot:42' },
        { id: 'view_evidence', label: 'View Evidence', href_hint: 'delivery_logs' },
      ],
    })

    render(
      <MemoryRouter>
        <ConnectorApiHealthPanel connectorId={7} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('connector-api-health-status')).toHaveTextContent('UNHEALTHY')
    })
    expect(screen.getByTestId('connector-api-health-problem')).toHaveTextContent('401')
    expect(screen.getByTestId('connector-api-health-action')).toHaveTextContent('Verify credentials')
    const link = screen.getByRole('link', { name: 'Open Data Flow Troubleshooter' })
    expect(link).toHaveAttribute('href', expect.stringContaining('/streams/'))
  })
})
