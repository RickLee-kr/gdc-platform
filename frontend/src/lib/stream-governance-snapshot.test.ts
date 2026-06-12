import { describe, expect, it } from 'vitest'
import {
  buildIssueWhyChain,
  deriveGovernanceIssues,
  deriveOperationalIssues,
  toOperatorEventLabel,
} from './stream-governance-snapshot'
import type { StreamIssueContext } from './stream-issue-context'

describe('stream-governance-snapshot', () => {
  const baseCtx: StreamIssueContext = {
    id: '42',
    status: 'RUNNING',
    connectorName: 'Okta',
    deliveryPctKnown: true,
    deliveryPct: 99,
    routesError: 0,
    lastActivityRelative: '1m ago',
    recentErrors: [],
  }

  it('maps schema drift summary to operational issue', () => {
    const issues = deriveGovernanceIssues({
      schemaDrift: {
        stream_id: 42,
        open_count: 2,
        acknowledged_count: 0,
        resolved_count: 0,
        by_category: { field_added: 2, field_removed: 0, field_type_changed: 0 },
        baseline_version: 1,
        baseline_established_at: null,
        baseline_reset_at: null,
        drift_detection_enabled: true,
      },
      sensitive: null,
      protection: null,
      policy: null,
      dynamicRouting: null,
      failover: null,
      replay: null,
      quarantine: null,
    })
    expect(issues[0]?.label).toBe('Schema drift detected')
  })

  it('builds why chain for destination failures', () => {
    const ctx: StreamIssueContext = {
      ...baseCtx,
      status: 'ERROR',
      routesError: 2,
      deliveryPctKnown: true,
      deliveryPct: 72,
      recentErrors: [{ message: '429 responses detected' }],
    }
    const issues = deriveOperationalIssues(ctx)
    const chain = buildIssueWhyChain(issues, ctx)
    expect(chain[0]?.label).toBe('Destination failure')
    expect(chain.some((s) => s.detail?.includes('429'))).toBe(true)
  })

  it('sanitizes timeline messages for operators', () => {
    expect(toOperatorEventLabel('schema drift detected on field user.email', 'schema_drift')).toBe('Schema drift detected')
    expect(toOperatorEventLabel('failover route activated', 'routing')).toBe('Failover activated')
  })
})
