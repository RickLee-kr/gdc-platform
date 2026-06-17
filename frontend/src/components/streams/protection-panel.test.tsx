import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as gdcProtection from '../../api/gdcProtection'
import * as gdcRuntime from '../../api/gdcRuntime'
import { ProtectionPanel } from './protection-panel'

describe('ProtectionPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(gdcProtection, 'fetchStreamProtectionSummary').mockResolvedValue({
      stream_id: 10,
      protection_enabled: true,
      protection_rules: 2,
      protected_events: 5,
      protected_fields: 3,
      last_protected_at: null,
      enabled_rule_count: 2,
      full_mask_count: 1,
      partial_mask_count: 1,
      hash_count: 0,
      disabled_rule_count: 0,
      tokenization_count: 0,
      vault_entry_count: 0,
      total_rules: 2,
      total_protected_events: 5,
      total_protected_fields: 3,
    })
    vi.spyOn(gdcProtection, 'fetchStreamProtectionRules').mockResolvedValue({
      stream_id: 10,
      rules: [
        {
          id: 1,
          stream_id: 10,
          field_path: '$.email',
          sensitivity_class: 'pii',
          protection_mode: 'partial_mask',
          enabled: true,
          source_finding_id: 99,
          created_by: 'operator',
          created_at: '2026-06-14T10:00:00Z',
          updated_at: '2026-06-14T10:00:00Z',
        },
        {
          id: 2,
          stream_id: 10,
          field_path: '$.api_key',
          sensitivity_class: 'secret',
          protection_mode: 'full_mask',
          enabled: true,
          source_finding_id: null,
          created_by: 'wizard',
          created_at: '2026-06-14T09:00:00Z',
          updated_at: '2026-06-14T09:00:00Z',
        },
      ],
      rule_count: 2,
    })
    vi.spyOn(gdcRuntime, 'searchRuntimeDeliveryLogs').mockResolvedValue({
      total_returned: 1,
      filters: {},
      logs: [
        {
          id: 501,
          connector_id: null,
          stream_id: 10,
          route_id: null,
          destination_id: null,
          run_id: null,
          stage: 'schema_drift_policy_auto_protect_applied',
          level: 'INFO',
          status: null,
          message: 'Auto protect applied: $.email (partial_mask)',
          retry_count: 0,
          http_status: null,
          latency_ms: null,
          error_code: null,
          created_at: '2026-06-14T10:32:01.000Z',
        },
      ],
    })
  })

  it('shows protection rule origin and recent auto protect activity', async () => {
    render(<ProtectionPanel streamId={10} canOperate={false} />)

    await waitFor(() => {
      expect(screen.getByTestId('protection-rule-origin-1')).toHaveTextContent('Operator')
      expect(screen.getByTestId('protection-rule-origin-2')).toHaveTextContent('Wizard')
    })

    const activity = screen.getByTestId('auto-protect-activity-501')
    expect(activity).toBeInTheDocument()
    expect(activity).toHaveTextContent('$.email')
    expect(activity).toHaveTextContent('partial_mask')
  })

  it('shows empty state when no auto protect activity', async () => {
    vi.spyOn(gdcRuntime, 'searchRuntimeDeliveryLogs').mockResolvedValue({
      total_returned: 0,
      filters: {},
      logs: [],
    })

    render(<ProtectionPanel streamId={10} canOperate={false} />)

    await waitFor(() => {
      expect(screen.getByText('No recent auto protect activity.')).toBeInTheDocument()
    })
  })
})
