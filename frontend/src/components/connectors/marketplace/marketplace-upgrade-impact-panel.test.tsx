import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MarketplaceUpgradeImpactPanel } from './marketplace-upgrade-impact-panel'
import type { UpgradeImpactPreviewResponse } from '../../../api/gdcMarketplace'

function basePreview(overrides: Partial<UpgradeImpactPreviewResponse> = {}): UpgradeImpactPreviewResponse {
  return {
    package_id: 'acme',
    current_pack_version: '1.0.0',
    proposed_pack_version: '1.1.0',
    current_digest: 'abc',
    proposed_digest: 'def',
    current_updated_at: '2026-08-27T00:00:00Z',
    has_changes: true,
    changed_fields: [{ path: 'auth.type', change: 'modified', old: 'bearer', new: 'api_key' }],
    affected: {
      streams: [{ id: 1, name: 'Events', status: 'RUNNING' }],
      routes: [{ id: 1, stream_id: 1, destination_id: 2, enabled: true }],
      destinations: [{ id: 2, name: 'Webhook' }],
      stream_ids_added: ['alerts'],
      stream_ids_removed: [],
      stream_ids_deprecated: [],
    },
    test: { status: 'WARNING', summary: 'Candidate package validated with warnings.', checks: ['archive_staged'] },
    blocking_issues: [],
    warnings: [{ code: 'AUTH_CHANGE', message: 'Package authentication contract changed.', severity: 'warning' }],
    can_upgrade: true,
    can_apply: true,
    recommended_actions: [{ id: 'test_connection', label: 'Test connection with existing credentials' }],
    preview_only: true,
    stale_base: false,
    runtime_impact: 'Catalog upgrade',
    delivery_impact: 'Running streams keep current config',
    schema_baseline_unchanged: true,
    checkpoint_unchanged: true,
    stream_config_unchanged: true,
    ...overrides,
  }
}

describe('MarketplaceUpgradeImpactPanel', () => {
  it('shows test, changes, impact, warnings, and apply readiness', () => {
    render(<MarketplaceUpgradeImpactPanel preview={basePreview()} />)
    expect(screen.getByTestId('marketplace-upgrade-apply-status')).toHaveTextContent('Safe to upgrade')
    expect(screen.getByTestId('marketplace-upgrade-test')).toHaveTextContent('WARNING')
    expect(screen.getByTestId('marketplace-upgrade-changed-fields')).toHaveTextContent('auth.type')
    expect(screen.getByTestId('marketplace-upgrade-affected')).toHaveTextContent('1 stream(s)')
    expect(screen.getByTestId('marketplace-upgrade-warnings')).toHaveTextContent('authentication')
  })

  it('shows blocking issues', () => {
    render(
      <MarketplaceUpgradeImpactPanel
        preview={basePreview({
          can_upgrade: false,
          blocking_issues: [{ code: 'SAME_VERSION', message: 'Same version', severity: 'blocking' }],
        })}
      />,
    )
    expect(screen.getByTestId('marketplace-upgrade-apply-status')).toHaveTextContent('Upgrade blocked')
    expect(screen.getByTestId('marketplace-upgrade-blocking')).toHaveTextContent('Same version')
  })
})
