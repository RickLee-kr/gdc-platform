import { describe, expect, it } from 'vitest'
import { buildFlowTimelineStages, GOVERNANCE_NO_CHANGE_DETAIL } from './stream-flow-timeline'
import type { StreamGovernanceSnapshot } from '../../lib/stream-governance-snapshot'
import { computeStreamWorkflow } from '../../utils/streamWorkflow'

function baseWorkflow() {
  return computeStreamWorkflow({
    streamId: '42',
    status: 'RUNNING',
    events1h: 10,
    deliveryPct: 100,
    routesTotal: 1,
    routesOk: 1,
    hasConnector: true,
    hasApiTest: true,
    hasMapping: true,
    hasEnrichment: true,
    hasSaved: true,
    enabledDeliveryRoute: true,
  })
}

function defaultGovernance(): StreamGovernanceSnapshot {
  return {
    schemaDrift: {
      stream_id: 42,
      open_count: 0,
      acknowledged_count: 0,
      resolved_count: 0,
      by_category: { field_added: 0, field_removed: 0, field_type_changed: 0 },
      baseline_version: 1,
      baseline_established_at: null,
      baseline_reset_at: null,
      drift_detection_enabled: true,
    },
    sensitive: {
      stream_id: 42,
      open_count: 0,
      acknowledged_count: 0,
      resolved_count: 0,
      by_class: { secret: 0, pii: 0, security_metadata: 0 },
      detection_enabled: true,
      confirm_runs_required: 3,
    },
    protection: {
      stream_id: 42,
      protection_enabled: true,
      enabled_rule_count: 0,
      disabled_rule_count: 0,
      full_mask_count: 0,
      partial_mask_count: 0,
      hash_count: 0,
      tokenization_count: 0,
      vault_entry_count: 0,
      by_mode: { full_mask: 0, partial_mask: 0, hash: 0, tokenization: 0 },
      by_class: { secret: 0, pii: 0, security_metadata: 0 },
      total_rules: 0,
      total_protected_events: 0,
      total_protected_fields: 0,
      last_protected_at: null,
      protection_rules: 0,
      protected_events: 0,
      protected_fields: 0,
    },
    policy: {
      stream_id: 42,
      total_policies: 0,
      matched_policies: 0,
      audit_events: 0,
      enabled_policy_count: 0,
      disabled_policy_count: 0,
      last_evaluated_at: null,
    },
    dynamicRouting: null,
    failover: null,
    replay: null,
    quarantine: null,
  }
}

describe('buildFlowTimelineStages governance labels', () => {
  it('shows No Change with ok status for default wizard governance settings', () => {
    const stages = buildFlowTimelineStages({
      streamId: '42',
      displayStatus: 'RUNNING',
      workflow: baseWorkflow(),
      deliveryPct: 100,
      routesErr: 0,
      usesPushIngest: false,
      governance: defaultGovernance(),
    })

    for (const key of ['schema_drift', 'sensitive', 'protection', 'policy'] as const) {
      const stage = stages.find((s) => s.key === key)
      expect(stage, key).toBeDefined()
      expect(stage?.detail).toBe(GOVERNANCE_NO_CHANGE_DETAIL)
      expect(stage?.status).toBe('ok')
    }
  })

  it('shows activity-specific labels when governance is actively engaged', () => {
    const governance = defaultGovernance()
    governance.protection!.enabled_rule_count = 2
    governance.protection!.total_rules = 2
    governance.policy!.matched_policies = 3

    const stages = buildFlowTimelineStages({
      streamId: '42',
      displayStatus: 'RUNNING',
      workflow: baseWorkflow(),
      deliveryPct: 100,
      routesErr: 0,
      usesPushIngest: false,
      governance,
    })

    expect(stages.find((s) => s.key === 'protection')?.detail).toBe('Active')
    expect(stages.find((s) => s.key === 'policy')?.detail).toBe('3 matched')
  })
})
