import { describe, expect, it } from 'vitest'
import { humanizeQuarantineReason } from '../../lib/humanize-quarantine-reason'
import { render, screen } from '@testing-library/react'
import { QuarantinePanel } from './quarantine-panel'
import * as gdcQuarantine from '../../api/gdcQuarantine'
import { beforeEach, vi } from 'vitest'

describe('QuarantinePanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(gdcQuarantine, 'fetchStreamQuarantineSummary').mockResolvedValue({
      stream_id: 10,
      quarantined_count: 1,
      released_count: 0,
      discarded_count: 0,
      total_count: 1,
      last_released_at: null,
    })
    vi.spyOn(gdcQuarantine, 'fetchStreamQuarantineEvents').mockResolvedValue({
      stream_id: 10,
      event_count: 1,
      events: [
        {
          id: 7,
          stream_id: 10,
          quarantine_reason: 'policy:schema_drift:unknown_sensitive',
          quarantine_source: 'policy',
          status: 'quarantined',
          event_count: 1,
          created_at: '2026-06-14T10:00:00Z',
          updated_at: '2026-06-14T10:00:00Z',
          released_at: null,
          released_by: null,
        },
      ],
    })
  })

  it('shows humanized quarantine reason', async () => {
    render(<QuarantinePanel streamId={10} canOperate={false} />)
    expect(await screen.findByText('Schema Drift Policy — Unknown Sensitive Field')).toBeInTheDocument()
  })
})

describe('humanizeQuarantineReason manual case', () => {
  it('maps manual source to Manual Quarantine', () => {
    expect(humanizeQuarantineReason('hold', { quarantineSource: 'manual' })).toBe('Manual Quarantine')
  })
})
