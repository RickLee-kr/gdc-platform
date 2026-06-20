import { describe, expect, it } from 'vitest'
import {
  accumulateRouteProcessingProjectedCounts,
  deployIntentPersistLabel,
  projectRouteProcessingStatusFromDeployIntent,
} from './wizard-deploy-projection'
import { buildInitialState } from './wizard-state'

function baseDraft(key: string, inherit?: Partial<{ transform: boolean; protection: boolean; classification: boolean; policy: boolean }>) {
  return {
    key,
    destinationId: 10,
    enabled: true,
    failurePolicy: 'LOG_AND_CONTINUE' as const,
    rateLimitJson: {},
    inherit: {
      transform: true,
      protection: true,
      classification: true,
      policy: true,
      ...inherit,
    },
  }
}

describe('projectRouteProcessingStatusFromDeployIntent', () => {
  it('returns Inherited statuses for default inherit flags', () => {
    const state = buildInitialState()
    const projection = projectRouteProcessingStatusFromDeployIntent(baseDraft('r1'), state.dataProtection)
    expect(projection.statuses).toEqual({
      transform: 'Inherited',
      protection: 'Inherited',
      classification: 'Inherited',
      policy: 'Inherited',
    })
    expect(projection.concerns.transform.persistKind).toBe('none')
  })

  it('marks transform override as intent only', () => {
    const state = buildInitialState()
    const projection = projectRouteProcessingStatusFromDeployIntent(
      baseDraft('r1', { transform: false }),
      state.dataProtection,
    )
    expect(projection.statuses.transform).toBe('Overridden')
    expect(projection.concerns.transform.persistKind).toBe('intent_only')
    expect(deployIntentPersistLabel(projection.concerns.transform.persistKind)).toBe('Intent only')
  })

  it('preserves Mixed status for protection when inherit off and field overrides exist', () => {
    const state = buildInitialState()
    state.dataProtection.routeOverrides = [
      {
        key: 'o1',
        routeDraftKey: 'r1',
        fieldPath: '$.email',
        protectionAction: 'mask_partial',
        deliveryBehavior: 'continue',
        enabled: true,
      },
    ]
    const projection = projectRouteProcessingStatusFromDeployIntent(
      baseDraft('r1', { protection: false }),
      state.dataProtection,
    )
    expect(projection.statuses.protection).toBe('Mixed')
    expect(projection.concerns.protection.persistKind).toBe('intent_only')
  })

  it('marks governance field protection override when inherit shared', () => {
    const state = buildInitialState()
    state.dataProtection.routeOverrides = [
      {
        key: 'o1',
        routeDraftKey: 'r1',
        fieldPath: '$.email',
        protectionAction: 'mask_partial',
        deliveryBehavior: 'continue',
        enabled: true,
      },
    ]
    const projection = projectRouteProcessingStatusFromDeployIntent(baseDraft('r1'), state.dataProtection)
    expect(projection.statuses.protection).toBe('Overridden')
    expect(projection.concerns.protection.persistKind).toBe('governance')
    expect(deployIntentPersistLabel(projection.concerns.protection.persistKind)).toBe(
      'Persisted through governance rules',
    )
  })

  it('accumulates override and mixed counts separately', () => {
    const state = buildInitialState()
    state.destinations.routeDrafts = [
      baseDraft('r1', { transform: false }),
      baseDraft('r2', { protection: false }),
    ]
    state.dataProtection.routeOverrides = [
      {
        key: 'o1',
        routeDraftKey: 'r2',
        fieldPath: '$.secret',
        protectionAction: 'mask_full',
        deliveryBehavior: 'continue',
        enabled: true,
      },
    ]
    const counts = accumulateRouteProcessingProjectedCounts(state.destinations.routeDrafts, state.dataProtection)
    expect(counts.transform).toEqual({ override: 1, mixed: 0 })
    expect(counts.protection).toEqual({ override: 0, mixed: 1 })
    expect(counts.classification).toEqual({ override: 0, mixed: 0 })
    expect(counts.policy).toEqual({ override: 0, mixed: 0 })
  })
})
