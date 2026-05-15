import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectorsOverviewPage } from './connectors-overview-page'

const fetchConnectorsListMock = vi.fn()
const deleteConnectorMock = vi.fn()

vi.mock('../../api/gdcConnectors', () => ({
  fetchConnectorsList: () => fetchConnectorsListMock(),
  deleteConnector: () => deleteConnectorMock(),
}))

function fakeConnector(id: number, name: string, extras: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    name,
    description: 'fixture',
    status: 'RUNNING',
    connector_type: 'generic_http',
    source_type: 'HTTP_API_POLLING',
    source_id: id,
    stream_count: 1,
    host: 'http://127.0.0.1:28080',
    base_url: 'http://127.0.0.1:28080',
    verify_ssl: false,
    http_proxy: null,
    common_headers: {},
    auth_type: 'no_auth',
    auth: { auth_type: 'no_auth' },
    created_at: '2026-05-11T12:49:13Z',
    updated_at: '2026-05-11T12:49:13Z',
    ...extras,
  }
}

describe('ConnectorsOverviewPage — Dev Validation Lab visibility', () => {
  beforeEach(() => {
    fetchConnectorsListMock.mockReset()
    deleteConnectorMock.mockReset()
  })

  it('renders [DEV VALIDATION] connectors with the Dev lab badge', async () => {
    fetchConnectorsListMock.mockResolvedValueOnce([
      fakeConnector(1, '[DEV VALIDATION] Generic REST'),
      fakeConnector(2, '[DEV VALIDATION] Basic Auth'),
      fakeConnector(3, 'Production Okta'),
    ])

    render(
      <MemoryRouter>
        <ConnectorsOverviewPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('[DEV VALIDATION] Generic REST')).toBeInTheDocument()
    expect(screen.getByText('[DEV VALIDATION] Basic Auth')).toBeInTheDocument()
    expect(screen.getByText('Production Okta')).toBeInTheDocument()
    const badges = screen.getAllByText('Dev lab')
    expect(badges.length).toBe(2)
  })

  it('"Dev validation lab only" filter hides non-lab connectors', async () => {
    const user = userEvent.setup()
    fetchConnectorsListMock.mockResolvedValueOnce([
      fakeConnector(1, '[DEV VALIDATION] Generic REST'),
      fakeConnector(2, 'Production Okta'),
    ])

    render(
      <MemoryRouter>
        <ConnectorsOverviewPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Production Okta')).toBeInTheDocument()
    const toggle = screen.getByLabelText('Dev validation lab only filter')
    await user.click(toggle)

    expect(screen.getByText('[DEV VALIDATION] Generic REST')).toBeInTheDocument()
    expect(screen.queryByText('Production Okta')).not.toBeInTheDocument()
  })
})
