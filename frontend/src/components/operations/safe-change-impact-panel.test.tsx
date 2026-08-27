import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SafeChangeImpactPanel } from './safe-change-impact-panel'
import type { SafeChangePreviewResponse } from '../../api/gdcSafeChange'

function basePreview(overrides: Partial<SafeChangePreviewResponse> = {}): SafeChangePreviewResponse {
  return {
    entity_type: 'ROUTE_CONFIG',
    entity_id: 1,
    entity_name: 'Demo Stream',
    current_updated_at: '2026-08-26T00:00:00Z',
    has_changes: true,
    changed_fields: [{ path: 'enabled', change: 'modified', old: true, new: false }],
    affected: {
      streams: [{ id: 1, name: 'Demo Stream', status: 'STOPPED' }],
      routes: [{ id: 1, stream_id: 1, destination_id: 2, enabled: true }],
      destinations: [{ id: 2, name: 'Webhook' }],
    },
    runtime_impact: 'Affects 1 field change(s), 1 stream(s), 1 route(s), 1 destination(s).',
    delivery_impact: 'Enabled routes may deliver differently after apply.',
    test: { status: 'WARNING', summary: 'Preview completed with warnings.', checks: ['config_diff'] },
    blocking_issues: [],
    warnings: [{ code: 'ENABLEMENT_CHANGE', message: 'Enable/disable state will change.', severity: 'warning' }],
    can_apply: true,
    recommended_actions: [{ id: 'verify_after_apply', label: 'Verify delivery health after apply' }],
    preview_only: true,
    stale_base: false,
    ...overrides,
  }
}

describe('SafeChangeImpactPanel', () => {
  it('shows changed fields, warnings, and apply-ready status', () => {
    render(<SafeChangeImpactPanel preview={basePreview()} />)
    expect(screen.getByTestId('safe-change-apply-status')).toHaveTextContent('Safe to apply')
    expect(screen.getByTestId('safe-change-test')).toHaveTextContent('WARNING')
    expect(screen.getByTestId('safe-change-changed-fields')).toHaveTextContent('enabled')
    expect(screen.getByTestId('safe-change-warnings')).toHaveTextContent('Enable/disable')
    expect(screen.getByTestId('safe-change-affected')).toHaveTextContent('1 stream(s)')
  })

  it('shows blocking issues and blocks apply messaging', () => {
    render(
      <SafeChangeImpactPanel
        preview={basePreview({
          can_apply: false,
          blocking_issues: [
            {
              code: 'CONNECTED_STREAMS_RUNNING',
              message: 'Stop connected running streams before applying.',
              severity: 'blocking',
            },
          ],
        })}
      />,
    )
    expect(screen.getByTestId('safe-change-apply-status')).toHaveTextContent('Apply blocked')
    expect(screen.getByTestId('safe-change-blocking')).toHaveTextContent('Stop connected running streams')
  })
})
