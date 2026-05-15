import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RemoteFileConnectorFields } from './remote-file-connector-fields'
import type { ConnectorWritePayload } from '../../api/gdcConnectors'

describe('RemoteFileConnectorFields', () => {
  it('renders protocol, host, and known_hosts helper text', () => {
    const form: ConnectorWritePayload = {
      source_type: 'REMOTE_FILE_POLLING',
      host: 'sftp.example.com',
      port: 22,
      remote_username: 'u',
      remote_password: '',
      remote_file_protocol: 'sftp',
      known_hosts_policy: 'strict',
      known_hosts_text: '',
      connection_timeout_seconds: 20,
    }
    const set = vi.fn() as <K extends keyof ConnectorWritePayload>(key: K, value: ConnectorWritePayload[K]) => void
    render(
      <RemoteFileConnectorFields
        form={form}
        set={set}
        passwordConfigured={false}
        privateKeyConfigured={false}
        passphraseConfigured={false}
      />,
    )
    expect(screen.getByLabelText('Protocol')).toBeInTheDocument()
    expect(screen.getByLabelText('Host *')).toHaveValue('sftp.example.com')
    expect(screen.getByText(/Strict mode/i)).toBeInTheDocument()
    expect(screen.getByText(/ssh-keyscan/i)).toBeInTheDocument()
  })
})
