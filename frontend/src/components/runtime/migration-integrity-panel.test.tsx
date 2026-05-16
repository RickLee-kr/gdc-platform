import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { MigrationIntegrityReportDto } from '../../api/types/gdcApi'
import { MigrationIntegrityPanel } from './migration-integrity-panel'

const baseOk: MigrationIntegrityReportDto = {
  ok: true,
  status: 'ok',
  repo_heads: ['20260513_0019_must_change_pw'],
  db_revision: '20260513_0019_must_change_pw',
  db_revision_in_repo: true,
  db_revision_is_head: true,
  db_revision_is_known_orphan: false,
  head_count: 1,
  errors: [],
  warnings: [],
  infos: [],
  database_target: { dbname: 'datarelay' },
}

describe('MigrationIntegrityPanel', () => {
  it('renders collapsible OK summary without banner', async () => {
    const user = userEvent.setup()
    render(<MigrationIntegrityPanel report={{ ...baseOk }} />)

    expect(screen.queryByTestId('migration-integrity-banner')).not.toBeInTheDocument()

    const det = screen.getByTestId('migration-integrity-details')
    expect(det).not.toHaveAttribute('open')

    await user.click(within(det).getByTestId('migration-integrity-summary'))
    expect(det).toHaveAttribute('open')
  })

  it('hides banner in compact mode even when status is warn', () => {
    render(
      <MigrationIntegrityPanel
        compact
        report={{
          ...baseOk,
          status: 'warn',
          warnings: ['Process env DATABASE_URL differs from settings.DATABASE_URL'],
        }}
      />,
    )
    expect(screen.queryByTestId('migration-integrity-banner')).not.toBeInTheDocument()
    expect(screen.getByTestId('migration-integrity-details')).toBeInTheDocument()
  })

  it('shows banner and warning copy for warn state', async () => {
    const user = userEvent.setup()
    const msg = 'Process env DATABASE_URL differs from settings.DATABASE_URL'
    render(
      <MigrationIntegrityPanel
        report={{
          ...baseOk,
          status: 'warn',
          warnings: [msg],
        }}
      />,
    )

    const banner = screen.getByTestId('migration-integrity-banner')
    expect(banner).toBeInTheDocument()
    expect(within(banner).getByText(/migration integrity/i)).toBeInTheDocument()
    expect(banner.textContent).toContain(msg)

    const det = screen.getByTestId('migration-integrity-details')
    await user.click(within(det).getByTestId('migration-integrity-summary'))
    expect(det.textContent).toContain(msg)
  })
})
