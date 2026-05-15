import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { OperationsBackupPage } from './operations-backup-page'

const emptyCounts = {
  connectors: 0,
  sources: 0,
  streams: 0,
  mappings: 0,
  enrichments: 0,
  destinations: 0,
  routes: 0,
  checkpoints: 0,
}

vi.mock('../../api/gdcBackup', () => ({
  buildWorkspaceExportPath: () => 'http://localhost/api/v1/backup/workspace/export',
  downloadBackupUrl: vi.fn(async () => {}),
  postImportPreview: vi.fn(async () => ({
    ok: false,
    export_kind: null,
    counts: emptyCounts,
    conflicts: [{ code: 'MISSING_CONNECTORS', message: 'Import bundle must include a non-empty connectors array.' }],
    warnings: [],
    unsupported_items: [],
    preview_token: '',
  })),
  postImportApply: vi.fn(),
}))

describe('OperationsBackupPage', () => {
  it('runs preview and shows conflict summary', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <OperationsBackupPage />
      </MemoryRouter>,
    )
    const ta = screen.getByRole('textbox', { name: 'Import JSON payload' })
    fireEvent.change(ta, { target: { value: '{"version":2,"connectors":[]}' } })
    await user.click(screen.getByRole('button', { name: 'Validate & preview' }))
    expect(await screen.findByText('Conflicts')).toBeInTheDocument()
    expect(screen.getByText(/MISSING_CONNECTORS/i)).toBeInTheDocument()
  })
})
