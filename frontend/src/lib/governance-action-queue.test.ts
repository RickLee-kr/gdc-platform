import { describe, expect, it } from 'vitest'
import type { GovernanceOperationsQueueResponse } from '../api/gdcGovernanceOperations'
import { buildGovernanceActionQueue } from './governance-action-queue'

const sampleQueue: GovernanceOperationsQueueResponse = {
  action_required: [
    {
      priority: 'critical',
      category: 'failed_replays',
      count: 2,
      label: '2 Failed replay jobs',
      recommended_action: 'Execute or retry failed replay jobs',
    },
  ],
  pending_approvals: [],
  violations: [
    {
      violation_id: 'v-1',
      policy_name: 'PII Policy',
      stream_name: 'Support',
      severity: 'LOW',
      status: 'OPEN',
    },
  ],
  quarantine: [],
  replays: [
    {
      replay_id: 9,
      stream_name: 'Support',
      status: 'FAILED',
      outcome: 'Failure',
      error_message: 'timeout',
    },
  ],
  notifications: [],
}

describe('buildGovernanceActionQueue', () => {
  it('sorts by priority critical first', () => {
    const items = buildGovernanceActionQueue(sampleQueue)
    expect(items[0]?.priority).toBe('critical')
    expect(items.some((i) => i.id === 'replay-9')).toBe(true)
    expect(items.some((i) => i.id === 'violation-v-1')).toBe(true)
  })

  it('includes Resolve and View details CTAs for violations', () => {
    const violation = buildGovernanceActionQueue(sampleQueue).find((i) => i.id === 'violation-v-1')
    expect(violation?.ctas.map((c) => c.label)).toEqual(['Resolve', 'View details'])
  })
})
