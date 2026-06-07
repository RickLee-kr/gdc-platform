import { describe, expect, it } from 'vitest'
import { GOVERNANCE_LOG_DRILLDOWN_STAGES, rowMatchesStageFilter } from './delivery-log-stages'
import type { LogExplorerRow } from './logs-types'

function rowWithStage(stage: string): LogExplorerRow {
  return {
    id: '1',
    eventId: 'evt_1',
    timeIso: '2026-06-05T10:00:00Z',
    level: 'INFO',
    connector: 'c1',
    stream: 's1',
    route: 'r1',
    message: 'ok',
    durationMs: 0,
    contextJson: { stage },
    relatedEventId: null,
  }
}

describe('delivery-log-stages', () => {
  it('exports governance drill-down tokens used in URLs', () => {
    expect(GOVERNANCE_LOG_DRILLDOWN_STAGES.classification).toBe('classification_complete')
    expect(GOVERNANCE_LOG_DRILLDOWN_STAGES.protection).toBe('protection_complete')
    expect(GOVERNANCE_LOG_DRILLDOWN_STAGES.policy).toBe('policy_evaluation_complete')
  })

  it('does not client-filter out rows when API stage filter is active', () => {
    const row = rowWithStage('classification_complete')
    expect(rowMatchesStageFilter(row, 'classification_complete', 'classification_complete')).toBe(true)
  })

  it('matches pipeline category labels when no API stage filter', () => {
    const row = rowWithStage('mapping')
    expect(rowMatchesStageFilter(row, 'MAPPING', undefined)).toBe(true)
    expect(rowMatchesStageFilter(row, 'DELIVERY', undefined)).toBe(false)
  })
})
