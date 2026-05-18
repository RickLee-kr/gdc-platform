import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getAdminNetworkSettings,
  getAuthWhoAmI,
  postAdminNetworkSettingsApply,
  putAdminNetworkSettings,
  type NetworkSettingsApplyDto,
  type NetworkSettingsDto,
  type NetworkSettingsSaveDto,
} from '../../api/gdcAdmin'
import { AdminNetworkSettingsPage } from './admin-network-settings-page'

vi.mock('../../api/gdcAdmin', () => ({
  getAdminNetworkSettings: vi.fn(),
  postAdminNetworkSettingsApply: vi.fn(),
  putAdminNetworkSettings: vi.fn(),
  getAuthWhoAmI: vi.fn(),
}))

const restartCommand = 'docker compose -f docker-compose.platform.yml up -d --force-recreate reverse-proxy'

const initialSettings: NetworkSettingsDto = {
  http_port: 18080,
  https_port: 18443,
  env_example: {
    GDC_HTTP_PORT: '18080',
    GDC_HTTPS_PORT: '18443',
  },
  restart_required: false,
  restart_command: restartCommand,
}

function savedSettings(overrides: Partial<NetworkSettingsSaveDto> = {}): NetworkSettingsSaveDto {
  return {
    http_port: 19080,
    https_port: 19443,
    env_example: {
      GDC_HTTP_PORT: '19080',
      GDC_HTTPS_PORT: '19443',
    },
    restart_required: true,
    restart_command: restartCommand,
    message: 'Network settings saved to the database and platform .env. Apply the reverse-proxy change to update published ports.',
    ...overrides,
  }
}

function applyResult(overrides: Partial<NetworkSettingsApplyDto> = {}): NetworkSettingsApplyDto {
  return {
    success: true,
    command: restartCommand,
    stdout: 'recreated\n',
    stderr: '',
    exit_code: 0,
    message: 'Reverse proxy recreated. Reconnect using the configured HTTP/HTTPS port if the browser disconnects.',
    ...overrides,
  }
}

describe('AdminNetworkSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAdminNetworkSettings).mockResolvedValue(initialSettings)
    vi.mocked(putAdminNetworkSettings).mockResolvedValue(savedSettings())
    vi.mocked(postAdminNetworkSettingsApply).mockResolvedValue(applyResult())
    vi.mocked(getAuthWhoAmI).mockResolvedValue({ username: 'admin', role: 'ADMINISTRATOR', authenticated: true })
  })

  it('loads and displays current HTTP and HTTPS ports', async () => {
    render(<AdminNetworkSettingsPage />)

    expect(await screen.findByRole('heading', { name: 'Network / Reverse Proxy Settings' })).toBeInTheDocument()
    expect(screen.getByLabelText('HTTP Port')).toHaveValue('18080')
    expect(screen.getByLabelText('HTTPS Port')).toHaveValue('18443')
    expect(screen.getByTestId('network-env-example')).toHaveTextContent('GDC_HTTP_PORT=18080')
    expect(screen.getByTestId('network-env-example')).toHaveTextContent('GDC_HTTPS_PORT=18443')
  })

  it('does not swap HTTP and HTTPS field bindings', async () => {
    vi.mocked(getAdminNetworkSettings).mockResolvedValueOnce({
      http_port: 18080,
      https_port: 18443,
      env_example: {
        GDC_HTTP_PORT: '18080',
        GDC_HTTPS_PORT: '18443',
      },
      restart_required: false,
      restart_command: restartCommand,
    })

    render(<AdminNetworkSettingsPage />)

    expect(await screen.findByLabelText('HTTP Port')).toHaveValue('18080')
    expect(screen.getByLabelText('HTTPS Port')).toHaveValue('18443')
    expect(screen.getByTestId('network-env-example')).toHaveTextContent('GDC_HTTP_PORT=18080')
    expect(screen.getByTestId('network-env-example')).toHaveTextContent('GDC_HTTPS_PORT=18443')
  })

  it('validates required, numeric, range, and duplicate ports before submit', async () => {
    const user = userEvent.setup()
    render(<AdminNetworkSettingsPage />)
    const http = await screen.findByLabelText('HTTP Port')
    const https = screen.getByLabelText('HTTPS Port')
    await waitFor(() => expect(http).not.toBeDisabled())

    await user.clear(http)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.getByText('HTTP Port is required.')).toBeInTheDocument()

    await user.type(http, 'abc')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.getByText('HTTP Port must contain numbers only.')).toBeInTheDocument()

    await user.clear(http)
    await user.type(http, '70000')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.getByText('HTTP Port must be a valid TCP port between 1 and 65535.')).toBeInTheDocument()

    await user.clear(http)
    await user.type(http, '19080')
    await user.clear(https)
    await user.type(https, '19080')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.getByText('HTTP Port and HTTPS Port cannot match.')).toBeInTheDocument()
    expect(putAdminNetworkSettings).not.toHaveBeenCalled()
  })

  it('saves valid ports and renders restart-required guidance', async () => {
    const user = userEvent.setup()
    render(<AdminNetworkSettingsPage />)
    const http = await screen.findByLabelText('HTTP Port')
    const https = screen.getByLabelText('HTTPS Port')
    await waitFor(() => expect(http).not.toBeDisabled())

    await user.clear(http)
    await user.type(http, '19080')
    await user.clear(https)
    await user.type(https, '19443')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(putAdminNetworkSettings).toHaveBeenCalledWith({ http_port: 19080, https_port: 19443 })
    expect(await screen.findByText('Network settings saved')).toBeInTheDocument()
    expect(screen.getByText('Restart required')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply reverse-proxy change' })).toBeInTheDocument()
    expect(screen.getByText(/reconnect using HTTP 19080 or HTTPS 19443/i)).toBeInTheDocument()
  })

  it('applies reverse-proxy changes from the browser and renders command output', async () => {
    const user = userEvent.setup()
    render(<AdminNetworkSettingsPage />)

    const http = await screen.findByLabelText('HTTP Port')
    await waitFor(() => expect(http).not.toBeDisabled())
    await user.click(screen.getByRole('button', { name: 'Apply reverse-proxy change' }))

    expect(postAdminNetworkSettingsApply).toHaveBeenCalledWith()
    expect(await screen.findByText('Reverse proxy applied')).toBeInTheDocument()
    expect(screen.getByText(`${restartCommand} exited with 0`)).toBeInTheDocument()
    expect(screen.getByText('recreated')).toBeInTheDocument()
  })

  it('renders backend validation errors cleanly', async () => {
    vi.mocked(putAdminNetworkSettings).mockRejectedValueOnce(
      new Error('422: [NETWORK_PORT_INVALID] Port 8000 is a reserved platform service port.'),
    )
    const user = userEvent.setup()
    render(<AdminNetworkSettingsPage />)
    const http = await screen.findByLabelText('HTTP Port')
    await waitFor(() => expect(http).not.toBeDisabled())

    await user.clear(http)
    await user.type(http, '8000')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Port 8000 is a reserved platform service port.')
    expect(screen.queryByText('[NETWORK_PORT_INVALID]')).not.toBeInTheDocument()
  })
})
