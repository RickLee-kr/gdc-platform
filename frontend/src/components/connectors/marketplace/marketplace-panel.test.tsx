import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MarketplaceApiError, type MarketplaceCapabilitiesRead, type MarketplacePackageCard } from '../../../api/gdcMarketplace'
import { MarketplacePanel } from './marketplace-panel'

function renderPanel(ui: ReactElement = <MarketplacePanel />) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

const fetchMarketplaceCatalogMock = vi.fn()
const fetchMarketplacePackageDetailMock = vi.fn()
const fetchMarketplaceCapabilitiesMock = vi.fn()
const validatePackageUploadMock = vi.fn()
const installPackageUploadMock = vi.fn()
const upgradePackageUploadMock = vi.fn()
const previewPackageUpgradeImpactMock = vi.fn()
const rollbackPackageMock = vi.fn()
const uninstallPackageMock = vi.fn()
const createBuilderDraftMock = vi.fn()

vi.mock('../../../api/gdcMarketplace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/gdcMarketplace')>()
  return {
    ...actual,
    fetchMarketplaceCatalog: (...args: unknown[]) => fetchMarketplaceCatalogMock(...args),
    fetchMarketplacePackageDetail: (...args: unknown[]) => fetchMarketplacePackageDetailMock(...args),
    fetchMarketplaceCapabilities: (...args: unknown[]) => fetchMarketplaceCapabilitiesMock(...args),
    validatePackageUpload: (...args: unknown[]) => validatePackageUploadMock(...args),
    installPackageUpload: (...args: unknown[]) => installPackageUploadMock(...args),
    upgradePackageUpload: (...args: unknown[]) => upgradePackageUploadMock(...args),
    previewPackageUpgradeImpact: (...args: unknown[]) => previewPackageUpgradeImpactMock(...args),
    rollbackPackage: (...args: unknown[]) => rollbackPackageMock(...args),
    uninstallPackage: (...args: unknown[]) => uninstallPackageMock(...args),
    createBuilderDraft: (...args: unknown[]) => createBuilderDraftMock(...args),
  }
})

vi.mock('../../../api/gdcMarketplaceRegistries', () => ({
  fetchAllRegistryPackages: vi.fn(async () => ({ packages: [], count: 0, unavailable: false })),
  installFromRegistry: vi.fn(),
  installOfflineSignedBundle: vi.fn(),
  installFromGitUrl: vi.fn(),
}))

const CAPABILITIES: MarketplaceCapabilitiesRead = {
  git_acquisition: true,
  git_acquisition_reason: 'Git acquisition accepts HTTPS URLs to .tar.gz / .tgz package archives with SSRF controls.',
  remote_registry: true,
  remote_registry_default_enabled: false,
  private_registry: true,
  offline_signed_bundle: true,
  production_ai_provider_implemented: false,
  deterministic_builder_providers: ['fixture', 'manual'],
  auto_install: false,
  auto_stream_create: false,
  auto_stream_enable: false,
  auto_credential_create: false,
  trust_auto_promotion: false,
  supported_upload_formats: ['.tar.gz', '.tgz'],
  supported_origins: ['Builtin', 'Upload', 'Git', 'Private Registry', 'Remote Registry'],
}

function makeCard(overrides: Partial<MarketplacePackageCard> = {}): MarketplacePackageCard {
  return {
    package_id: 'acme.widgets',
    name: 'Acme Widgets',
    vendor: 'Acme Corp',
    product: 'Widgets',
    description: 'Pulls widget events from the Acme API.',
    package_kind: 'source',
    pack_version: '1.2.0',
    api_version: '1.0',
    origin: 'builtin',
    trust_tier: 'Official',
    validation_status: 'PASS',
    verification: { signature_status: 'UNSIGNED', signing_key_id: null, digest: null, evidence_date: null },
    license: { declared: 'MIT', decision: 'ALLOWED', decision_code: 'OK', decision_reason: 'Permissive license.' },
    provenance: {
      upstream_project: null,
      upstream_url: null,
      upstream_path: null,
      upstream_commit_or_version: null,
      modified_from_upstream: null,
      import_method: null,
    },
    compatibility: { warnings: [], requires: null },
    available_streams: [{ id: 'widget_events', name: 'Widget Events' }],
    installed: false,
    installed_version: null,
    update_available: false,
    previous_version: null,
    stream_extensions: [],
    requires: null,
    ...overrides,
  }
}

function resetMocks() {
  fetchMarketplaceCatalogMock.mockReset()
  fetchMarketplacePackageDetailMock.mockReset()
  fetchMarketplaceCapabilitiesMock.mockReset()
  validatePackageUploadMock.mockReset()
  installPackageUploadMock.mockReset()
  upgradePackageUploadMock.mockReset()
  previewPackageUpgradeImpactMock.mockReset()
  rollbackPackageMock.mockReset()
  uninstallPackageMock.mockReset()
  createBuilderDraftMock.mockReset()

  fetchMarketplaceCatalogMock.mockResolvedValue({ packages: [makeCard()], count: 1 })
  fetchMarketplaceCapabilitiesMock.mockResolvedValue(CAPABILITIES)
  previewPackageUpgradeImpactMock.mockResolvedValue({
    package_id: 'acme.widgets',
    current_pack_version: '1.0.0',
    proposed_pack_version: '1.2.0',
    current_digest: 'sha256:abc',
    proposed_digest: 'sha256:def',
    current_updated_at: '2026-01-01T00:00:00Z',
    has_changes: true,
    changed_fields: [{ path: 'pack_version', change: 'modified', old: '1.0.0', new: '1.2.0' }],
    affected: {
      streams: [],
      routes: [],
      destinations: [],
      stream_ids_added: [],
      stream_ids_removed: [],
      stream_ids_deprecated: [],
    },
    test: { status: 'PASS', summary: 'ok', checks: [] },
    blocking_issues: [],
    warnings: [],
    can_upgrade: true,
    can_apply: true,
    recommended_actions: [],
    preview_only: true,
    stale_base: false,
    runtime_impact: '',
    delivery_impact: '',
    schema_baseline_unchanged: true,
    checkpoint_unchanged: true,
    stream_config_unchanged: true,
  })
}

describe('MarketplacePanel — browse, search, filters', () => {
  beforeEach(() => {
    resetMocks()
  })

  it('renders package cards with trust tier, origin, version, and license', async () => {
    renderPanel()

    expect(await screen.findByTestId('marketplace-card-acme.widgets')).toBeInTheDocument()
    const card = screen.getByTestId('marketplace-card-acme.widgets')
    expect(within(card).getByText('Official')).toBeInTheDocument()
    expect(within(card).getByText('builtin')).toBeInTheDocument()
    expect(within(card).getByText('v1.2.0')).toBeInTheDocument()
    expect(within(card).getByText('MIT')).toBeInTheDocument()
  })

  it('shows the loading state before the catalog resolves', async () => {
    let resolveFn: ((v: unknown) => void) | undefined
    fetchMarketplaceCatalogMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFn = resolve
      }),
    )
    renderPanel()
    expect(screen.getByTestId('marketplace-loading')).toBeInTheDocument()
    resolveFn?.({ packages: [], count: 0 })
    await waitFor(() => expect(screen.queryByTestId('marketplace-loading')).not.toBeInTheDocument())
  })

  it('shows an empty state when no packages match', async () => {
    fetchMarketplaceCatalogMock.mockResolvedValue({ packages: [], count: 0 })
    renderPanel()
    expect(await screen.findByTestId('marketplace-empty')).toBeInTheDocument()
  })

  it('searches by query text and re-fetches the catalog', async () => {
    const user = userEvent.setup()
    renderPanel()
    await screen.findByTestId('marketplace-card-acme.widgets')

    await user.type(screen.getByTestId('marketplace-search-input'), 'widg')

    await waitFor(() => {
      const lastCall = fetchMarketplaceCatalogMock.mock.calls.at(-1)?.[0]
      expect(lastCall?.q).toBe('widg')
    })
  })

  it('shows a compatibility warning badge when the package has warnings', async () => {
    fetchMarketplaceCatalogMock.mockResolvedValue({
      packages: [makeCard({ compatibility: { warnings: ['Requires platform api_version >= 2.0'], requires: null } })],
      count: 1,
    })
    renderPanel()
    expect(await screen.findByTestId('marketplace-card-compat-warning-acme.widgets')).toBeInTheDocument()
  })
})

describe('MarketplacePanel — package detail', () => {
  beforeEach(() => {
    resetMocks()
  })

  it('opens the detail view with verification, license, and provenance fields', async () => {
    const user = userEvent.setup()
    fetchMarketplaceCatalogMock.mockResolvedValue({
      packages: [
        makeCard({
          verification: { signature_status: 'VALID', signing_key_id: 'key-1', digest: 'sha256:abc', evidence_date: '2026-01-01T00:00:00Z' },
        }),
      ],
      count: 1,
    })
    renderPanel()
    await user.click(await screen.findByTestId('marketplace-card-acme.widgets'))

    const detail = await screen.findByTestId('marketplace-detail')
    expect(within(detail).getByText('Acme Widgets')).toBeInTheDocument()
    expect(within(detail).getByText('VALID')).toBeInTheDocument()
    expect(within(detail).getByText('key-1')).toBeInTheDocument()
    expect(within(detail).getByText('MIT')).toBeInTheDocument()
  })

  it('discovers stream extensions on a source package detail', async () => {
    const user = userEvent.setup()
    fetchMarketplaceCatalogMock.mockResolvedValue({
      packages: [
        makeCard({
          stream_extensions: [{ package_id: 'acme.widgets.premium', name: 'Premium Widgets Stream Pack', installed: false }],
        }),
      ],
      count: 1,
    })
    renderPanel()
    await user.click(await screen.findByTestId('marketplace-card-acme.widgets'))

    expect(await screen.findByTestId('marketplace-stream-extensions-list')).toBeInTheDocument()
    expect(screen.getByTestId('marketplace-stream-extension-acme.widgets.premium')).toHaveTextContent(
      'Premium Widgets Stream Pack',
    )
  })

  it('shows no stream extensions message when none are found', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(await screen.findByTestId('marketplace-card-acme.widgets'))
    expect(await screen.findByTestId('marketplace-stream-extensions-empty')).toBeInTheDocument()
  })
})

describe('MarketplacePanel — lifecycle actions', () => {
  beforeEach(() => {
    resetMocks()
  })

  it('installs a package via upload and shows success with a stream-wizard CTA that does not auto-enable a stream', async () => {
    const user = userEvent.setup()
    validatePackageUploadMock.mockResolvedValue({
      status: 'PASS',
      package_id: 'acme.widgets',
      package_kind: 'source',
      pack_version: '1.2.0',
      name: 'Acme Widgets',
      vendor: 'Acme Corp',
      issues: [],
      signature_status: 'VALID',
      signing_key_id: 'key-1',
      digest: 'sha256:abc',
      license_decision: 'ALLOWED',
      license_decision_code: 'OK',
      license_decision_reason: 'Permissive license.',
      compatibility_warnings: [],
      blocked_reasons: [],
    })
    installPackageUploadMock.mockResolvedValue({
      package_id: 'acme.widgets',
      package_kind: 'source',
      pack_version: '1.2.0',
      origin: 'upload',
      status: 'installed',
      digest: 'sha256:abc',
      signature_status: 'VALID',
      signing_key_id: 'key-1',
      installed_path: '/tmp/acme.widgets',
      previous_version: null,
      previous_digest: null,
      installed_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })

    renderPanel()
    await user.click(await screen.findByTestId('marketplace-open-upload'))

    const file = new File(['dummy'], 'acme.tar.gz', { type: 'application/gzip' })
    await user.upload(screen.getByTestId('marketplace-upload-file-input'), file)
    await user.click(screen.getByTestId('marketplace-upload-validate-button'))

    expect(await screen.findByTestId('marketplace-validate-result')).toBeInTheDocument()
    await user.click(screen.getByTestId('marketplace-upload-install-button'))

    expect(await screen.findByTestId('marketplace-action-success')).toHaveTextContent('Installed acme.widgets')
    expect(await screen.findByTestId('marketplace-detail-post-install-cta')).toHaveTextContent(
      'not enabled for any stream yet',
    )
    expect(screen.getByRole('link', { name: 'Continue in Stream Wizard' })).toBeInTheDocument()
  })

  it('blocks install when validation fails', async () => {
    const user = userEvent.setup()
    validatePackageUploadMock.mockResolvedValue({
      status: 'FAIL',
      package_id: null,
      package_kind: null,
      pack_version: null,
      name: null,
      vendor: null,
      issues: ['Secret detected in manifest'],
      signature_status: 'UNSIGNED',
      signing_key_id: null,
      digest: null,
      license_decision: null,
      license_decision_code: null,
      license_decision_reason: null,
      compatibility_warnings: [],
      blocked_reasons: ['Secret scan failed'],
    })

    renderPanel()
    await user.click(await screen.findByTestId('marketplace-open-upload'))
    const file = new File(['dummy'], 'bad.tar.gz', { type: 'application/gzip' })
    await user.upload(screen.getByTestId('marketplace-upload-file-input'), file)
    await user.click(screen.getByTestId('marketplace-upload-validate-button'))

    expect(await screen.findByTestId('marketplace-validate-blocked')).toHaveTextContent('Secret scan failed')
    expect(screen.getByTestId('marketplace-upload-install-button')).toBeDisabled()
    expect(installPackageUploadMock).not.toHaveBeenCalled()
  })

  it('surfaces an install failure', async () => {
    const user = userEvent.setup()
    validatePackageUploadMock.mockResolvedValue({
      status: 'PASS',
      package_id: 'acme.widgets',
      package_kind: 'source',
      pack_version: '1.2.0',
      name: 'Acme Widgets',
      vendor: 'Acme Corp',
      issues: [],
      signature_status: 'VALID',
      signing_key_id: null,
      digest: null,
      license_decision: 'ALLOWED',
      license_decision_code: 'OK',
      license_decision_reason: null,
      compatibility_warnings: [],
      blocked_reasons: [],
    })
    installPackageUploadMock.mockRejectedValue(new MarketplaceApiError('500: install failed'))

    renderPanel()
    await user.click(await screen.findByTestId('marketplace-open-upload'))
    const file = new File(['dummy'], 'acme.tar.gz', { type: 'application/gzip' })
    await user.upload(screen.getByTestId('marketplace-upload-file-input'), file)
    await user.click(screen.getByTestId('marketplace-upload-validate-button'))
    await screen.findByTestId('marketplace-validate-result')
    await user.click(screen.getByTestId('marketplace-upload-install-button'))

    expect(await screen.findByTestId('marketplace-upload-error')).toHaveTextContent('install failed')
  })

  it('upgrades an installed package', async () => {
    const user = userEvent.setup()
    fetchMarketplaceCatalogMock.mockResolvedValue({
      packages: [makeCard({ installed: true, installed_version: '1.0.0', update_available: true })],
      count: 1,
    })
    validatePackageUploadMock.mockResolvedValue({
      status: 'PASS',
      package_id: 'acme.widgets',
      package_kind: 'source',
      pack_version: '1.2.0',
      name: 'Acme Widgets',
      vendor: 'Acme Corp',
      issues: [],
      signature_status: 'VALID',
      signing_key_id: null,
      digest: null,
      license_decision: 'ALLOWED',
      license_decision_code: 'OK',
      license_decision_reason: null,
      compatibility_warnings: [],
      blocked_reasons: [],
    })
    upgradePackageUploadMock.mockResolvedValue({
      package_id: 'acme.widgets',
      package_kind: 'source',
      pack_version: '1.2.0',
      origin: 'upload',
      status: 'installed',
      digest: 'sha256:def',
      signature_status: 'VALID',
      signing_key_id: null,
      installed_path: '/tmp/acme.widgets',
      previous_version: '1.0.0',
      previous_digest: 'sha256:abc',
      installed_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    })

    renderPanel()
    await user.click(await screen.findByTestId('marketplace-card-acme.widgets'))
    await user.click(await screen.findByTestId('marketplace-detail-upgrade'))

    const file = new File(['dummy'], 'acme-1.2.0.tar.gz', { type: 'application/gzip' })
    await user.upload(screen.getByTestId('marketplace-upload-file-input'), file)
    await user.click(screen.getByTestId('marketplace-upload-validate-button'))
    await screen.findByTestId('marketplace-validate-result')
    expect(await screen.findByTestId('marketplace-upgrade-impact-panel')).toBeInTheDocument()
    await user.click(screen.getByTestId('marketplace-upload-install-button'))

    expect(previewPackageUpgradeImpactMock).toHaveBeenCalledWith('acme.widgets', expect.any(File))
    expect(upgradePackageUploadMock).toHaveBeenCalledWith('acme.widgets', expect.any(File), {
      expectedBaseDigest: 'sha256:abc',
      expectedBaseUpdatedAt: '2026-01-01T00:00:00Z',
    })
    expect(await screen.findByTestId('marketplace-action-success')).toHaveTextContent('Upgraded acme.widgets')
  })

  it('rolls back an installed package', async () => {
    const user = userEvent.setup()
    fetchMarketplaceCatalogMock.mockResolvedValue({
      packages: [makeCard({ installed: true, installed_version: '1.2.0', previous_version: '1.1.0' })],
      count: 1,
    })
    rollbackPackageMock.mockResolvedValue({
      package_id: 'acme.widgets',
      package_kind: 'source',
      pack_version: '1.1.0',
      origin: 'upload',
      status: 'installed',
      digest: 'sha256:abc',
      signature_status: 'VALID',
      signing_key_id: null,
      installed_path: '/tmp/acme.widgets',
      previous_version: '1.2.0',
      previous_digest: 'sha256:def',
      installed_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-03T00:00:00Z',
    })

    renderPanel()
    await user.click(await screen.findByTestId('marketplace-card-acme.widgets'))
    await user.click(await screen.findByTestId('marketplace-detail-rollback'))

    expect(await screen.findByTestId('marketplace-action-success')).toHaveTextContent('Rolled back acme.widgets to 1.1.0')
  })

  it('blocks uninstall when the package is a protected dependency', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fetchMarketplaceCatalogMock.mockResolvedValue({
      packages: [makeCard({ installed: true, installed_version: '1.2.0' })],
      count: 1,
    })
    uninstallPackageMock.mockRejectedValue(
      new MarketplaceApiError('409: [DEPENDENCY_PROTECTED] required by an installed stream extension', {
        errorCode: 'DEPENDENCY_PROTECTED',
      }),
    )

    renderPanel()
    await user.click(await screen.findByTestId('marketplace-card-acme.widgets'))
    await user.click(await screen.findByTestId('marketplace-detail-uninstall'))

    expect(await screen.findByTestId('marketplace-action-blocked')).toHaveTextContent('DEPENDENCY_PROTECTED')
  })

  it('uninstalls a package successfully', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fetchMarketplaceCatalogMock.mockResolvedValue({
      packages: [makeCard({ installed: true, installed_version: '1.2.0' })],
      count: 1,
    })
    uninstallPackageMock.mockResolvedValue({
      package_id: 'acme.widgets',
      package_kind: 'source',
      pack_version: '1.2.0',
      origin: 'upload',
      status: 'uninstalled',
      digest: 'sha256:abc',
      signature_status: 'VALID',
      signing_key_id: null,
      installed_path: '/tmp/acme.widgets',
      previous_version: null,
      previous_digest: null,
      installed_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-03T00:00:00Z',
    })

    renderPanel()
    await user.click(await screen.findByTestId('marketplace-card-acme.widgets'))
    await user.click(await screen.findByTestId('marketplace-detail-uninstall'))

    expect(await screen.findByTestId('marketplace-action-success')).toHaveTextContent('Uninstalled acme.widgets')
    expect(screen.queryByTestId('marketplace-detail')).not.toBeInTheDocument()
  })
})

describe('MarketplacePanel — Install from Git', () => {
  beforeEach(() => {
    resetMocks()
  })

  it('shows Git install enabled with SSRF-safe acquisition reason', async () => {
    renderPanel()
    expect(await screen.findByTestId('marketplace-git-install')).toBeInTheDocument()
    expect(screen.getByTestId('marketplace-git-install-button')).toBeDisabled()
    expect(screen.getByTestId('marketplace-git-install-reason')).toHaveTextContent('SSRF')
    expect(screen.getByTestId('marketplace-git-url-input')).toBeInTheDocument()
  })
})

describe('MarketplacePanel — Create with AI', () => {
  beforeEach(() => {
    resetMocks()
  })

  it('shows the AI provider unavailable banner', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(await screen.findByTestId('marketplace-open-ai-builder'))
    expect(await screen.findByTestId('marketplace-ai-provider-unavailable')).toBeInTheDocument()
  })

  it('generates a Local Draft using the deterministic fixture provider', async () => {
    const user = userEvent.setup()
    createBuilderDraftMock.mockResolvedValue({
      status: 'READY_DRAFT',
      package_generated: true,
      package_path: '/tmp/draft/acme.widgets',
      validation_status: 'valid',
      validation_issues: [],
      open_questions: [],
      conflicts: [],
      confidence_summary: {},
      evidence_summary: {},
      license_decision: null,
      license_decision_code: null,
      license_decision_reason: null,
      trust_candidate: 'Local Draft',
      validation_details: {},
      provider_name: 'fixture',
    })

    renderPanel()
    await user.click(await screen.findByTestId('marketplace-open-ai-builder'))
    await user.type(screen.getByTestId('marketplace-ai-builder-vendor'), 'Acme Corp')
    await user.click(screen.getByTestId('marketplace-ai-builder-submit'))

    expect(await screen.findByTestId('marketplace-ai-builder-result')).toBeInTheDocument()
    expect(screen.getByTestId('marketplace-ai-builder-result-trust')).toHaveTextContent('Local Draft')
    expect(createBuilderDraftMock).toHaveBeenCalledWith(expect.objectContaining({ provider_name: 'fixture' }))
  })

  it('surfaces an AI provider unavailable error from the backend', async () => {
    const user = userEvent.setup()
    createBuilderDraftMock.mockRejectedValue(
      new MarketplaceApiError('503: [AI_PROVIDER_UNAVAILABLE] AI provider is not available.', {
        errorCode: 'AI_PROVIDER_UNAVAILABLE',
      }),
    )

    renderPanel()
    await user.click(await screen.findByTestId('marketplace-open-ai-builder'))
    await user.click(screen.getByTestId('marketplace-ai-builder-submit'))

    expect(await screen.findByTestId('marketplace-ai-builder-error')).toHaveTextContent('AI_PROVIDER_UNAVAILABLE')
  })
})
