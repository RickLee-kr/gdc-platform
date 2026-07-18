import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AdminOperationalDashboard } from './admin-settings-operational'

vi.mock('../../api/gdcAdmin', () => ({
  getAdminRetentionPolicy: vi.fn(async () => ({
    cleanup_scheduler_active: true,
    cleanup_scheduler_enabled: true,
    cleanup_interval_minutes: 60,
    cleanup_batch_size: 5000,
    cleanup_engine_message: 'Cleanup runs on the configured interval.',
    logs: { enabled: true, retention_days: 30 },
    runtime_metrics: { enabled: true, retention_days: 14 },
    preview_cache: { enabled: true, retention_days: 7 },
    backup_temp: { enabled: true, retention_days: 3 },
  })),
  getAdminAuditLog: vi.fn(async () => ({ items: [], total: 0 })),
  getAdminConfigVersions: vi.fn(async () => ({ items: [], total: 0 })),
  getAdminHealthSummary: vi.fn(async () => ({
    metrics_window_seconds: 3600,
    metrics: [],
  })),
  getAdminAlertSettings: vi.fn(async () => ({
    rules: [{ alert_type: 'delivery_failure', enabled: true, severity: 'WARNING', last_triggered_at: null }],
    webhook_url: 'https://example.com/hook',
    slack_webhook_url: null,
    email_to: null,
    channel_status: {},
    notification_delivery: {},
    cooldown_seconds: 600,
    monitor_enabled: true,
  })),
  getAdminAlertHistory: vi.fn(async () => ({ items: [], total: 0 })),
  putAdminRetentionPolicy: vi.fn(),
  putAdminAlertSettings: vi.fn(),
  postAdminRetentionCleanupRun: vi.fn(),
  postAdminAlertTest: vi.fn(),
}))

vi.mock('../../lib/feature-flags', () => ({
  isPlatformAlertingUiEnabled: () => true,
}))

describe('AdminOperationalDashboard modal a11y', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens retention dialog with labelled modal and Escape close', async () => {
    const user = userEvent.setup()
    const setPageMsg = vi.fn()
    const setPageErr = vi.fn()
    const setBusy = vi.fn()

    render(
      <MemoryRouter>
        <AdminOperationalDashboard
          reloadToken={0}
          readOnly={false}
          busy={false}
          setBusy={setBusy}
          setPageMsg={setPageMsg}
          setPageErr={setPageErr}
        />
      </MemoryRouter>,
    )

    const retentionOpen = await screen.findByRole('button', { name: /Manage retention policy/i })
    await user.click(retentionOpen)
    const dialog = await screen.findByTestId('admin-retention-dialog')
    expect(dialog).toHaveAttribute('role', 'dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Retention policy/i })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByTestId('admin-retention-dialog')).not.toBeInTheDocument()
    })
  })

  it('opens alerts dialog with aria-labelledby', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <AdminOperationalDashboard
          reloadToken={0}
          readOnly={false}
          busy={false}
          setBusy={() => {}}
          setPageMsg={() => {}}
          setPageErr={() => {}}
        />
      </MemoryRouter>,
    )

    await user.click(await screen.findByRole('button', { name: /Manage alerts/i }))
    const dialog = await screen.findByTestId('admin-alerts-dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Alert settings/i })).toBeInTheDocument()
  })
})
