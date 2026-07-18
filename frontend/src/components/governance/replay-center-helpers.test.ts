import { describe, expect, it } from 'vitest'
import type { GovernanceReplayEntry } from '../../api/gdcGovernanceReplay'
import {
  buildReplayImpact,
  dedupeReplayIds,
  pruneReplaySelection,
} from './replay-center-helpers'

const sampleEntry: GovernanceReplayEntry = {
  id: 7,
  policy_id: 1,
  policy_name: 'Customer PII Policy',
  stream_id: 10,
  stream_name: 'Malop API',
  status: 'PENDING',
  created_at: '2026-06-06T10:00:00Z',
  completed_at: null,
  outcome: null,
  event_count: 1,
  correlation_id: 'q-42',
}

const failedEntry: GovernanceReplayEntry = {
  ...sampleEntry,
  id: 8,
  status: 'FAILED',
  outcome: 'Failure',
  completed_at: '2026-06-06T11:00:00Z',
}

const completedEntry: GovernanceReplayEntry = {
  ...sampleEntry,
  id: 9,
  status: 'COMPLETED',
  outcome: 'Success',
  completed_at: '2026-06-06T12:00:00Z',
}

describe('replay-center-helpers', () => {
  it('dedupes ids and prunes selections outside loaded retryable rows', () => {
    expect(dedupeReplayIds([7, 8, 7, 9])).toEqual([7, 8, 9])
    expect(pruneReplaySelection([7, 8, 9, 7], [sampleEntry, completedEntry])).toEqual([7])
  })

  it('buildReplayImpact reports selected count matching request ids', () => {
    const items = buildReplayImpact(
      [
        { ...sampleEntry, destination_name: 'SIEM A', route_id: 3 },
        { ...failedEntry, destination_name: 'SIEM B', route_id: 4 },
      ],
      '7d',
      { selectedCount: 2 },
    )
    expect(items[0]).toBe('Selected count: 2')
    expect(items).toContain('Stream count: 1')
    expect(items).toContain('Route count: 2')
    expect(items).toContain('Destination count: 2')
    expect(items).toContain('Replay time window: 7d')
    expect(items.some((i) => i.includes('currently loaded list'))).toBe(true)
  })
})
