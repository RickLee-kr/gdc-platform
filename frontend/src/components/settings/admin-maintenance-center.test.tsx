import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminMaintenanceCenter } from './admin-maintenance-center'

vi.mock('../../api/gdcAdmin', () => ({
  getAdminMaintenanceHealth: vi.fn(() =>
    Promise.resolve({
      generated_at: '2026-05-12T12:00:00Z',
      overall: 'WARN',
      ok: [{ code: 'DB_OK', message: 'ok', panel: 'database' }],
      warn: [{ code: 'DB_LATENCY_HIGH', message: 'slow', panel: 'database' }],
      error: [],
      panels: {
        database: { status: 'WARN', reachable: true, latency_ms: 500, database_url_masked: 'postgresql://****', version_short: 'PostgreSQL' },
        migrations: { status: 'OK', database_revision: 'head', script_heads: ['head'], in_sync: true },
        scheduler: { status: 'OK', startup_scheduler_active_gate: true, supervisor_uptime_seconds: 10, active_worker_count: 1 },
        retention: { status: 'WARN', cleanup_scheduler_enabled: false, cleanup_thread_running: false, cleanup_interval_minutes: 60 },
        storage: { status: 'OK', disk: { path: '/', used_percent: 40, free_bytes: 1e12, total_bytes: 2e12 } },
        destinations: { status: 'OK', window_hours: 1, destinations: [] },
        certificates: { status: 'OK', https_enabled: false, certificate_not_after: null, days_remaining: null },
        recent_failures: { status: 'OK', count_returned: 0, items: [] },
        support_bundle: { status: 'OK', download_method: 'GET', download_path: '/api/v1/admin/support-bundle' },
      },
    }),
  ),
  downloadAdminSupportBundle: vi.fn(() => Promise.resolve()),
}))

describe('AdminMaintenanceCenter', () => {
  it('renders warning styling on database card when panel status is WARN', async () => {
    render(<AdminMaintenanceCenter backendRole="ADMINISTRATOR" busy={false} setBusy={() => {}} />)
    const card = await screen.findByTestId('maintenance-card-database')
    expect(card.className).toMatch(/amber-50/)
    expect(screen.getByTestId('maintenance-warnings-block')).toBeInTheDocument()
    expect(screen.getByTestId('maintenance-overall')).toHaveTextContent('WARN')
  })

  it('shows access note for non-administrator', () => {
    render(<AdminMaintenanceCenter backendRole="OPERATOR" busy={false} setBusy={() => {}} />)
    expect(screen.getByTestId('maintenance-access-note')).toBeInTheDocument()
    expect(screen.queryByTestId('maintenance-card-database')).not.toBeInTheDocument()
  })
})

describe('AdminMaintenanceCenter runbook shortcut', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('shows in-repo runbook path when hosted URL is not set', async () => {
    vi.stubEnv('VITE_ADMIN_BACKUP_RESTORE_RUNBOOK_URL', '')
    render(<AdminMaintenanceCenter backendRole="ADMINISTRATOR" busy={false} setBusy={() => {}} />)
    expect(await screen.findByTestId('maintenance-runbook-shortcut')).toBeInTheDocument()
    expect(screen.getByText('docs/admin/backup-restore.md')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Backup & Restore Runbook' })).not.toBeInTheDocument()
  })

  it('renders runbook link when VITE_ADMIN_BACKUP_RESTORE_RUNBOOK_URL is set', async () => {
    vi.stubEnv('VITE_ADMIN_BACKUP_RESTORE_RUNBOOK_URL', 'https://ops.example/docs/backup-restore')
    render(<AdminMaintenanceCenter backendRole="ADMINISTRATOR" busy={false} setBusy={() => {}} />)
    const link = await screen.findByRole('link', { name: 'Backup & Restore Runbook' })
    expect(link).toHaveAttribute('href', 'https://ops.example/docs/backup-restore')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
