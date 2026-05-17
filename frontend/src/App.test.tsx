import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

vi.mock('./api/gdcAdmin', () => ({
  getAdminHttpsSettings: vi.fn(() =>
    Promise.resolve({
      enabled: false,
      certificate_ip_addresses: [],
      certificate_dns_names: [],
      redirect_http_to_https: false,
      certificate_valid_days: 365,
      current_access_url: 'http://127.0.0.1:8000',
      https_active: false,
      certificate_not_after: null,
      restart_required_after_save: false,
      http_listener_active: true,
      https_listener_active: false,
      redirect_http_to_https_effective: false,
      proxy_status: 'not_configured',
      proxy_health_ok: null,
      proxy_last_reload_at: null,
      proxy_last_reload_ok: null,
      proxy_last_reload_detail: null,
      proxy_fallback_to_http_last: false,
      browser_http_url: 'http://127.0.0.1:8000',
      browser_https_url: null,
    }),
  ),
  listAdminUsers: vi.fn(() => Promise.resolve([])),
  putAdminHttpsSettings: vi.fn(() =>
    Promise.resolve({
      ok: true,
      restart_required: true,
      certificate_not_after: null,
      message: 'Saved',
      proxy_reload_applied: true,
      proxy_https_effective: false,
      proxy_fallback_to_http: false,
    }),
  ),
  createAdminUser: vi.fn(() => Promise.resolve({ id: 1, username: 'u', role: 'VIEWER', status: 'ACTIVE', created_at: '', last_login_at: null })),
  updateAdminUser: vi.fn(() => Promise.resolve({ id: 1, username: 'u', role: 'VIEWER', status: 'ACTIVE', created_at: '', last_login_at: null })),
  deleteAdminUser: vi.fn(() => Promise.resolve(undefined)),
  postAdminPasswordChange: vi.fn(() => Promise.resolve(undefined)),
  getAdminSystemInfo: vi.fn(() =>
    Promise.resolve({
      app_name: 'GDC',
      app_version: '0.1.0',
      app_env: 'test',
      python_version: '3',
      database_reachable: true,
      database_url_masked: 'postgresql://****',
      platform: 'linux',
      server_time_utc: '2026-01-01T00:00:00Z',
      timezone: 'UTC',
      database_version: 'PostgreSQL 15',
      uptime_seconds: 3600,
    }),
  ),
  getAdminRetentionPolicy: vi.fn(() =>
    Promise.resolve({
      logs: { retention_days: 30, enabled: true, last_cleanup_at: null, next_cleanup_at: null },
      runtime_metrics: { retention_days: 90, enabled: true, last_cleanup_at: null, next_cleanup_at: null },
      preview_cache: { retention_days: 7, enabled: true, last_cleanup_at: null, next_cleanup_at: null },
      backup_temp: { retention_days: 14, enabled: true, last_cleanup_at: null, next_cleanup_at: null },
      cleanup_scheduler_active: false,
      cleanup_engine_message: 'Scheduled cleanup engine is not active yet.',
    }),
  ),
  getAdminAuditLog: vi.fn(() => Promise.resolve({ total: 0, items: [] })),
  getAdminConfigVersions: vi.fn(() => Promise.resolve({ total: 0, items: [] })),
  getAdminHealthSummary: vi.fn(() =>
    Promise.resolve({
      metrics_window_seconds: 3600,
      metrics: [
        {
          key: 'db_latency_ms',
          label: 'DB latency (avg sample)',
          available: true,
          value: '2 ms',
          status: 'good',
          notes: null,
          link_path: null,
        },
      ],
    }),
  ),
  getAuthWhoAmI: vi.fn(() =>
    Promise.resolve({ username: 'tester', role: 'ADMINISTRATOR', authenticated: true }),
  ),
  getAdminMaintenanceHealth: vi.fn(() =>
    Promise.resolve({
      generated_at: '2026-01-01T00:00:00Z',
      overall: 'OK',
      ok: [],
      warn: [],
      error: [],
      panels: {
        database: { status: 'OK', reachable: true, latency_ms: 2, database_url_masked: 'postgresql://****', version_short: 'PostgreSQL' },
        migrations: { status: 'OK', database_revision: 'r', script_heads: ['r'], in_sync: true },
        scheduler: { status: 'OK', startup_scheduler_active_gate: true, supervisor_uptime_seconds: 1, active_worker_count: 0 },
        retention: { status: 'OK', cleanup_scheduler_enabled: true, cleanup_thread_running: true, cleanup_interval_minutes: 60 },
        storage: { status: 'OK', disk: { path: '/', used_percent: 10, free_bytes: 100, total_bytes: 1000 } },
        destinations: { status: 'OK', window_hours: 1, destinations: [] },
        certificates: { status: 'OK', https_enabled: false, certificate_not_after: null, days_remaining: null },
        recent_failures: { status: 'OK', count_returned: 0, items: [] },
        support_bundle: { status: 'OK', download_method: 'GET', download_path: '/api/v1/admin/support-bundle' },
      },
    }),
  ),
  downloadAdminSupportBundle: vi.fn(() => Promise.resolve()),
  getAdminAlertSettings: vi.fn(() =>
    Promise.resolve({
      rules: [
        { alert_type: 'stream_paused', enabled: true, severity: 'WARNING', last_triggered_at: null },
        { alert_type: 'checkpoint_stalled', enabled: true, severity: 'CRITICAL', last_triggered_at: null },
      ],
      webhook_url: null,
      slack_webhook_url: null,
      email_to: null,
      channel_status: { webhook: 'not_configured', slack: 'not_configured', email: 'not_configured' },
      notification_delivery: 'planned',
    }),
  ),
  putAdminRetentionPolicy: vi.fn(() =>
    Promise.resolve({
      logs: { retention_days: 30, enabled: true, last_cleanup_at: null, next_cleanup_at: null },
      runtime_metrics: { retention_days: 90, enabled: true, last_cleanup_at: null, next_cleanup_at: null },
      preview_cache: { retention_days: 7, enabled: true, last_cleanup_at: null, next_cleanup_at: null },
      backup_temp: { retention_days: 14, enabled: true, last_cleanup_at: null, next_cleanup_at: null },
      cleanup_scheduler_active: false,
      cleanup_engine_message: 'Scheduled cleanup engine is not active yet.',
    }),
  ),
  putAdminAlertSettings: vi.fn(),
}))

function renderApp(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>,
  )
}

describe('DataRelay sidebar branding', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('exposes DataRelay home link, wordmark, and sidebar logo asset', () => {
    renderApp()
    const nav = screen.getByRole('complementary', { name: 'Primary navigation' })
    const home = within(nav).getByRole('link', { name: /DataRelay — Operations Center home/i })
    expect(home).toHaveAttribute('href', '/')
    expect(home).toHaveTextContent('Data')
    expect(home).toHaveTextContent('Relay')
    const logo = home.querySelector('img')
    expect(logo).not.toBeNull()
    expect(logo).toHaveAttribute('src', '/logo/datarelay-logo.svg')
  })

  it('honors VITE_DATARELAY_INSTANCE_LABEL for the instance subtitle', () => {
    vi.stubEnv('VITE_DATARELAY_INSTANCE_LABEL', 'prod-use1')
    renderApp()
    const nav = screen.getByRole('complementary', { name: 'Primary navigation' })
    expect(nav).toHaveTextContent('prod-use1')
  })

  it('falls back to datarelay-instance when VITE_DATARELAY_INSTANCE_LABEL is whitespace only', () => {
    vi.stubEnv('VITE_DATARELAY_INSTANCE_LABEL', '   ')
    renderApp()
    const nav = screen.getByRole('complementary', { name: 'Primary navigation' })
    expect(nav).toHaveTextContent('datarelay-instance')
  })
})

describe('App shell (phase: sidebar, header, dashboard)', () => {
  it('renders grouped primary navigation labels', () => {
    renderApp()
    const nav = screen.getByRole('complementary', { name: 'Primary navigation' })
    for (const label of [
      'Dashboard',
      'Operations Center',
      'Connectors',
      'Streams',
      'Templates',
      'Delivery',
      'Destinations',
      'Routes',
      'Operations',
      'Runtime',
      'Analytics',
      'Logs',
      'Settings',
      'Admin Settings',
      'DataRelay',
      'datarelay-instance',
    ]) {
      expect(nav).toHaveTextContent(label)
    }
  })

  it('logo links to Operations Center home', () => {
    renderApp()
    const nav = screen.getByRole('complementary', { name: 'Primary navigation' })
    const home = within(nav).getByRole('link', { name: /DataRelay — Operations Center home/i })
    expect(home).toHaveAttribute('href', '/')
  })

  it('renders Destinations management when Destinations is selected', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(screen.getByRole('button', { name: 'Destinations' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Destinations' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Destinations' })).toBeInTheDocument()
    expect(screen.getByText(/Manage reusable delivery targets/i)).toBeInTheDocument()
  })

  it('shows operator dashboard hierarchy driven by runtime APIs', () => {
    renderApp()
    expect(screen.getByRole('heading', { level: 2, name: 'Operations Center' })).toBeInTheDocument()
    expect(screen.getByText('Active Streams')).toBeInTheDocument()
    expect(screen.getByText(/Runtime volume \(1h\)/)).toBeInTheDocument()
    expect(screen.getByText('Pipeline health')).toBeInTheDocument()
    expect(screen.getByText('Telemetry rows by outcome')).toBeInTheDocument()
    expect(screen.getByText('Top failing routes')).toBeInTheDocument()
    expect(screen.getByText('Top unhealthy streams')).toBeInTheDocument()
    expect(screen.getByText('Destination health')).toBeInTheDocument()
    expect(screen.getByText('Recent deliveries')).toBeInTheDocument()
    expect(screen.getByText('Active alerts')).toBeInTheDocument()
  })

  it('renders dashboard KPI summary and header search', () => {
    renderApp()
    expect(screen.getByRole('region', { name: 'Operational KPI summary' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: /Search streams/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Runtime status')).toBeInTheDocument()
  })

  it('renders Connectors operational overview when Connectors is selected', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(screen.getByRole('button', { name: 'Connectors' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Connectors' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Connectors' })).toBeInTheDocument()
    expect(screen.getByText(/Manage your Generic HTTP connectors/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create Connector' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Host/Base URL' })).toBeInTheDocument()
  })


  it('renders Streams operational console when Streams is selected', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(screen.getByRole('button', { name: 'Streams' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Streams' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Streams' })).toBeInTheDocument()
    expect(screen.getByText(/Manage and monitor all data streams/i)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Stream KPI summary' })).toBeInTheDocument()
  })


  it('renders destination detail at /destinations/:destinationId', async () => {
    const gdcDest = await import('./api/gdcDestinations')
    vi.spyOn(gdcDest, 'fetchDestinationById').mockResolvedValue({
      id: 42,
      name: 'Stellar SIEM Syslog UDP',
      destination_type: 'SYSLOG_UDP',
      config_json: { host: '10.10.20.50', port: 514 },
      enabled: true,
      last_connectivity_test_success: true,
      created_at: '2026-01-08T09:14:22Z',
      updated_at: '2026-05-08T12:40:00Z',
    })
    vi.spyOn(gdcDest, 'fetchDestinationsList').mockResolvedValue([])
    renderApp('/destinations/42')
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 2, name: 'Stellar SIEM Syslog UDP' })).toBeInTheDocument()
    expect(screen.getByText(/SYSLOG UDP destination/i)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Destination KPI summary' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Routes Using This Destination' })).toBeInTheDocument()
  })

  it('renders Logs explorer when Logs is selected', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(screen.getByRole('button', { name: 'Logs' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Logs' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Logs' })).toBeInTheDocument()
    expect(screen.getByText(/Search and analyze logs across the pipeline/i)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Delivery outcomes (1h)' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Log level mix (1h)' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: /Search logs/i })).toBeInTheDocument()
  })

  it('renders Runtime operational overview when Runtime is selected', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(screen.getByRole('button', { name: 'Runtime' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Runtime' })).toBeInTheDocument()
    expect(screen.getByText(/Monitor real-time stream health and system resources/i)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Runtime KPI summary' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Stream status' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Detail' })).toBeInTheDocument()
  })

  it('renders Backup & Import workspace at /operations/backup', () => {
    renderApp('/operations/backup')
    expect(screen.getByRole('heading', { level: 2, name: 'Backup & Import' })).toBeInTheDocument()
    expect(screen.getByText(/Export portable JSON snapshots/i)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Workspace snapshot export' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Import configuration' })).toBeInTheDocument()
  })

  it('renders Templates library when Templates is selected', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(screen.getByRole('button', { name: 'Templates' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Templates' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Template library' })).toBeInTheDocument()
    expect(screen.getByText(/Browse static integration templates/i)).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search templates' })).toBeInTheDocument()
  })

  it('renders Admin Settings when Admin Settings is selected', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(screen.getByRole('button', { name: 'Admin Settings' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Admin settings' })).toBeInTheDocument()
    expect(screen.getByText(/Operational dashboard for HTTPS/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Maintenance Center' })).toBeInTheDocument()
    expect(screen.getByText(/Read-only readiness checks for production operations/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'User management' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'System & backup' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Retention / cleanup policy' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Audit log' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Config versioning' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Health monitoring' })).toBeInTheDocument()
    expect(screen.getByText('Backup & Import')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Alerting' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Dev validation lab status' })).not.toBeInTheDocument()
  })

  it('renders new stream wizard at /streams/new', () => {
    renderApp('/streams/new')
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Stream Creation Wizard' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Stream Onboarding Wizard' })).toBeInTheDocument()
    expect(screen.getByText(/Connector → .*Mapping → Enrichment → Destinations/i)).toBeInTheDocument()
    expect(screen.getByText(/Loading connector catalog/i)).toBeInTheDocument()
  })

  it('renders enrichment configuration at /streams/:streamId/enrichment', () => {
    renderApp('/streams/malop-api/enrichment')
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Enrichment Configuration' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Enrichment Configuration' })).toBeInTheDocument()
    expect(screen.getByText(/Add static fields and computed fields to enrich your events/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Static Fields' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Override Policy' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Enrichment Summary' })).toBeInTheDocument()
  })

  it('renders source test page at /streams/:streamId/api-test with HTTP-aware labels for malop-api', () => {
    renderApp('/streams/malop-api/api-test')
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
    const crumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumb).getByText('API Test & Preview')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'API Test & Preview' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'API Test & Preview' })).toBeInTheDocument()
    expect(screen.getByText(/Runs the saved HTTP request/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Request Configuration' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Response Preview' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'JSON Tree' })).toBeInTheDocument()
  })

  it('uses fixture slug for remote probe breadcrumb on api-test', () => {
    renderApp('/streams/fixture-remote-stream/api-test')
    const crumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumb).getByText('Remote Probe & Preview')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Remote Probe & Preview' })).toBeInTheDocument()
  })

  it('uses neutral shell title when stream slug has no source hint', () => {
    renderApp('/streams/unknown-zzz-stream/api-test')
    const crumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumb).getByText('Source Test & Preview')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Source Test & Preview' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Source Test & Preview' })).toBeInTheDocument()
  })

  it('renders stream runtime detail inspector at /streams/:streamId/runtime', () => {
    renderApp('/streams/malop-api/runtime')
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Runtime' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /malop-api/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Stream runtime KPIs' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Stream observability' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Runtime history' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Recent logs' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Route operational panel' })).toBeInTheDocument()
  })

  it('renders Routes operational console at /routes', () => {
    renderApp('/routes')
    expect(screen.getByRole('heading', { level: 1, name: 'Routes' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Routes' })).toBeInTheDocument()
    expect(screen.getByText(/Manage delivery routes between streams and destinations/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create Route' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Route KPI summary' })).toBeInTheDocument()
  })

  it('renders advanced health checks workspace at /validation without sidebar entry', () => {
    renderApp('/validation')
    expect(screen.getByRole('heading', { level: 1, name: 'Runtime health checks' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Runtime health checks workspace' })).toBeInTheDocument()
    const nav = screen.getByRole('complementary', { name: 'Primary navigation' })
    expect(within(nav).queryByRole('button', { name: 'Continuous validation' })).not.toBeInTheDocument()
  })
})
