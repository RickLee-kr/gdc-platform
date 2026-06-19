import { describe, expect, it } from 'vitest'
import { buildStreamGovernanceSummary, type RouteGovernanceSnapshot } from './governance-workspace-summary'

function snapshot(
  routeId: number,
  overrides: Partial<RouteGovernanceSnapshot> = {},
): RouteGovernanceSnapshot {
  return {
    routeId,
    routeName: `Route #${routeId}`,
    transform: 'Inherited',
    protection: 'Inherited',
    classification: 'Inherited',
    policy: 'Inherited',
    transformEffective: {
      route_id: routeId,
      stream_id: 10,
      persisted_source: 'stream',
      mapping_source: 'stream',
      enrichment_source: 'stream',
      fallback_used: true,
      mapping_count: 2,
      enrichment_count: 1,
      processing_status: 'Inherited',
      message: 'ok',
    },
    protectionEffective: {
      route_id: routeId,
      stream_id: 10,
      persisted_source: 'stream',
      fallback_used: true,
      rule_count: 3,
      processing_status: 'Inherited',
      message: 'ok',
    },
    classificationEffective: {
      route_id: routeId,
      stream_id: 10,
      persisted_source: 'stream',
      fallback_used: true,
      rule_count: 4,
      processing_status: 'Inherited',
      message: 'ok',
    },
    policyEffective: {
      route_id: routeId,
      stream_id: 10,
      persisted_source: 'stream',
      fallback_used: true,
      rule_count: 5,
      processing_status: 'Inherited',
    },
    ...overrides,
  }
}

describe('buildStreamGovernanceSummary', () => {
  it('derives stream rule counts from inherited routes and override counts from statuses', () => {
    const routes: RouteGovernanceSnapshot[] = [
      snapshot(1),
      snapshot(2, {
        transform: 'Overridden',
        protection: 'Mixed',
        classification: 'Overridden',
        policy: 'Inherited',
        transformEffective: {
          route_id: 2,
          stream_id: 10,
          persisted_source: 'route',
          mapping_source: 'route',
          enrichment_source: 'stream',
          fallback_used: false,
          mapping_count: 1,
          enrichment_count: 0,
          processing_status: 'Overridden',
          message: 'ok',
        },
        protectionEffective: {
          route_id: 2,
          stream_id: 10,
          persisted_source: 'route',
          fallback_used: false,
          rule_count: 2,
          processing_status: 'Mixed',
          message: 'ok',
        },
        classificationEffective: {
          route_id: 2,
          stream_id: 10,
          persisted_source: 'route',
          fallback_used: false,
          rule_count: 1,
          processing_status: 'Overridden',
          message: 'ok',
        },
      }),
    ]

    const summary = buildStreamGovernanceSummary(routes)
    expect(summary.protection.streamRulesCount).toBe(3)
    expect(summary.protection.routeOverrideCount).toBe(1)
    expect(summary.classification.streamRulesCount).toBe(4)
    expect(summary.classification.routeOverrideCount).toBe(1)
    expect(summary.policy.streamRulesCount).toBe(5)
    expect(summary.policy.routeOverrideCount).toBe(0)
    expect(summary.transform.streamRulesCount).toBe(3)
    expect(summary.transform.routeOverrideCount).toBe(1)
    expect(summary.routes.routeCount).toBe(2)
    expect(summary.routes.overriddenRoutesCount).toBe(1)
  })
})
