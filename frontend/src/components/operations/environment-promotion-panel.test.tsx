import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentPromotionPanel } from './environment-promotion-panel'
import type { PromotionPreviewResponse } from '../../api/gdcEnvironmentPromotion'

vi.mock('../../lib/rbac', () => ({
  useSessionCapabilities: () => ({
    environment_promotion_preview: true,
    environment_promotion_apply: true,
    backup_import_preview: true,
    backup_import_apply: true,
  }),
}))

const previewMock = vi.fn()
const exportMock = vi.fn()
const applyMock = vi.fn()

vi.mock('../../api/gdcEnvironmentPromotion', async () => {
  const actual = await vi.importActual<typeof import('../../api/gdcEnvironmentPromotion')>(
    '../../api/gdcEnvironmentPromotion',
  )
  return {
    ...actual,
    previewPromotion: (...args: unknown[]) => previewMock(...args),
    exportPromotionBundle: (...args: unknown[]) => exportMock(...args),
    applyPromotion: (...args: unknown[]) => applyMock(...args),
  }
})

function basePreview(overrides: Partial<PromotionPreviewResponse> = {}): PromotionPreviewResponse {
  return {
    source_environment: 'development',
    target_environment: 'staging',
    mode: 'additive',
    target_fingerprint: 'abc123fingerprint',
    promotion_token: 'tok',
    has_changes: true,
    changed_fields: [
      {
        entity_type: 'stream',
        entity_name: 'alerts',
        path: 'polling_interval',
        change: 'modified',
        old: 60,
        new: 120,
      },
    ],
    affected: {
      entities: [{ entity_type: 'stream', name: 'alerts', action: 'compare' }],
      streams: 1,
      routes: 1,
      destinations: 0,
      connectors: 1,
    },
    blocking_issues: [],
    warnings: [{ code: 'MASKED_AUTH_IN_BUNDLE', message: 'Re-enter credentials', severity: 'warning' }],
    can_promote: true,
    preview_only: true,
    stale_target: false,
    secrets_excluded: true,
    checkpoints_excluded: true,
    import_ok: true,
    entity_counts: { connectors: 1, streams: 1 },
    ...overrides,
  }
}

describe('EnvironmentPromotionPanel', () => {
  beforeEach(() => {
    previewMock.mockReset()
    exportMock.mockReset()
    applyMock.mockReset()
  })

  it('renders source/target controls and preview CTA', () => {
    render(<EnvironmentPromotionPanel />)
    expect(screen.getByTestId('environment-promotion-panel')).toBeInTheDocument()
    expect(screen.getByTestId('environment-promotion-source')).toBeInTheDocument()
    expect(screen.getByTestId('environment-promotion-target')).toBeInTheDocument()
    expect(screen.getByTestId('environment-promotion-preview')).toBeInTheDocument()
  })

  it('shows diff, impact, blocking, and promote status from preview', async () => {
    previewMock.mockResolvedValue(
      basePreview({
        can_promote: false,
        blocking_issues: [
          {
            code: 'RUNNING_STREAMS_BLOCK_RESTORE',
            message: 'Stop running streams before full-restore promotion',
            severity: 'blocking',
          },
        ],
      }),
    )
    render(<EnvironmentPromotionPanel />)
    const textarea = screen.getByTestId('environment-promotion-json')
    textarea.focus()
    // populate json so preview button enables
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(textarea, { target: { value: '{"version":2,"connectors":[{"id":1,"name":"c"}]}' } })
    fireEvent.click(screen.getByTestId('environment-promotion-preview'))
    expect(await screen.findByTestId('environment-promotion-status')).toHaveTextContent('Promotion blocked')
    expect(screen.getByTestId('environment-promotion-diff')).toHaveTextContent('polling_interval')
    expect(screen.getByTestId('environment-promotion-affected')).toHaveTextContent('1 stream(s)')
    expect(screen.getByTestId('environment-promotion-blocking')).toHaveTextContent('Stop running streams')
    expect(screen.getByTestId('environment-promotion-warnings')).toHaveTextContent('Re-enter credentials')
  })
})
