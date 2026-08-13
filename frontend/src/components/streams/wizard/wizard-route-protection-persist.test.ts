import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildRouteProtectionOverrideFromRules,
  buildRouteProtectionWantedRules,
  loadWizardRouteProtection,
  persistWizardRouteProtection,
  routeProtectionOverrideIntentsReady,
} from './wizard-route-protection-persist'
import { buildInitialState, DEFAULT_ROUTE_PROCESSING_INHERIT } from './wizard-state'
import { projectRouteProcessingStatusFromDeployIntent } from './wizard-deploy-projection'

vi.mock('../../../api/gdcRouteProtection', () => ({
  fetchRouteProtectionRules: vi.fn(async () => ({
    route_id: 1,
    stream_id: 1,
    protection_enabled: true,
    rules: [],
    rule_count: 0,
  })),
  createRouteProtectionRule: vi.fn(async () => ({
    rule: {
      id: 11,
      route_id: 102,
      stream_id: 1,
      field_path: '$.email',
      sensitivity_class: 'pii',
      protection_mode: 'full_mask',
      enabled: true,
      source_finding_id: null,
      created_by: 'wizard',
      created_at: '',
      updated_at: '',
    },
  })),
  patchRouteProtectionRule: vi.fn(async () => ({ rule: { id: 11 } })),
  deleteRouteProtectionRule: vi.fn(async () => undefined),
}))

import {
  createRouteProtectionRule,
  deleteRouteProtectionRule,
  fetchRouteProtectionRules,
} from '../../../api/gdcRouteProtection'

describe('wizard route protection source of truth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds wanted route protection rules from override intents', () => {
    const wanted = buildRouteProtectionWantedRules({
      intents: [
        {
          key: 'i1',
          detectedField: '$.email',
          protectionAction: 'mask_full',
          deliveryBehavior: 'continue',
        },
        {
          key: 'i2',
          detectedField: 'note',
          protectionAction: 'mask_partial',
          deliveryBehavior: 'continue',
        },
      ],
      unknownNormalFieldPolicy: 'pass_through',
      unknownSensitiveFieldPolicy: 'auto_protect',
    })
    expect(wanted).toEqual([
      { fieldPath: '$.email', sensitivityClass: 'pii', protectionMode: 'full_mask' },
    ])
  })

  it('persists Override routes to route protection APIs and clears Inherit', async () => {
    const state = buildInitialState()
    state.destinations.routeDrafts = [
      {
        key: 'route-a',
        destinationId: 10,
        enabled: true,
        failurePolicy: 'LOG_AND_CONTINUE',
        rateLimitJson: {},
        inherit: { ...DEFAULT_ROUTE_PROCESSING_INHERIT },
      },
      {
        key: 'route-b',
        destinationId: 20,
        enabled: true,
        failurePolicy: 'LOG_AND_CONTINUE',
        rateLimitJson: {},
        inherit: { transform: true, protection: false, classification: true, policy: true },
        overrides: {
          protection: {
            intents: [
              {
                key: 'i1',
                detectedField: '$.email',
                protectionAction: 'mask_full',
                deliveryBehavior: 'continue',
              },
            ],
            unknownNormalFieldPolicy: 'pass_through',
            unknownSensitiveFieldPolicy: 'auto_protect',
          },
        },
      },
    ]

    const result = await persistWizardRouteProtection(state, [101, 102])

    expect(result.saved).toBe(true)
    expect(result.routesUpdated).toBe(2)
    expect(createRouteProtectionRule).toHaveBeenCalledWith(
      102,
      expect.objectContaining({
        field_path: '$.email',
        protection_mode: 'full_mask',
        sensitivity_class: 'pii',
      }),
    )
    expect(createRouteProtectionRule).not.toHaveBeenCalledWith(101, expect.anything())
  })

  it('deletes stale route protection rows when switching Override to Inherit', async () => {
    vi.mocked(fetchRouteProtectionRules).mockResolvedValueOnce({
      route_id: 202,
      stream_id: 1,
      protection_enabled: true,
      rules: [
        {
          id: 9,
          route_id: 202,
          stream_id: 1,
          field_path: '$.email',
          sensitivity_class: 'pii',
          protection_mode: 'full_mask',
          enabled: true,
          source_finding_id: null,
          created_by: 'wizard',
          created_at: '',
          updated_at: '',
        },
      ],
      rule_count: 1,
    })
    const state = buildInitialState()
    state.destinations.routeDrafts = [
      {
        key: 'route-b',
        destinationId: 20,
        enabled: true,
        failurePolicy: 'LOG_AND_CONTINUE',
        rateLimitJson: {},
        inherit: { ...DEFAULT_ROUTE_PROCESSING_INHERIT },
      },
    ]

    await persistWizardRouteProtection(state, [202])
    expect(deleteRouteProtectionRule).toHaveBeenCalledWith(202, 9)
  })

  it('hydrates override from persisted route protection rules', async () => {
    vi.mocked(fetchRouteProtectionRules).mockResolvedValueOnce({
      route_id: 7,
      stream_id: 1,
      protection_enabled: true,
      rules: [
        {
          id: 3,
          route_id: 7,
          stream_id: 1,
          field_path: '$.email',
          sensitivity_class: 'pii',
          protection_mode: 'full_mask',
          enabled: true,
          source_finding_id: null,
          created_by: 'wizard',
          created_at: '',
          updated_at: '',
        },
      ],
      rule_count: 1,
    })
    const drafts = await loadWizardRouteProtection([
      {
        key: 'route-7',
        destinationId: 10,
        enabled: true,
        failurePolicy: 'LOG_AND_CONTINUE',
        rateLimitJson: {},
        inherit: { ...DEFAULT_ROUTE_PROCESSING_INHERIT },
      },
    ])
    expect(drafts[0]?.inherit.protection).toBe(false)
    expect(drafts[0]?.overrides?.protection?.intents[0]).toMatchObject({
      detectedField: '$.email',
      protectionAction: 'mask_full',
    })
  })

  it('projects protection override as route_protection, not intent_only', () => {
    const state = buildInitialState()
    const draft = {
      key: 'r1',
      destinationId: 10,
      enabled: true,
      failurePolicy: 'LOG_AND_CONTINUE' as const,
      rateLimitJson: {},
      inherit: { transform: true, protection: false, classification: true, policy: true },
      overrides: {
        protection: {
          intents: [
            {
              key: 'i1',
              detectedField: '$.email',
              protectionAction: 'mask_full' as const,
              deliveryBehavior: 'continue' as const,
            },
          ],
          unknownNormalFieldPolicy: 'pass_through' as const,
          unknownSensitiveFieldPolicy: 'auto_protect' as const,
        },
      },
    }
    expect(routeProtectionOverrideIntentsReady(draft)).toBe(true)
    const projection = projectRouteProcessingStatusFromDeployIntent(draft, state.dataProtection)
    expect(projection.concerns.protection.persistKind).toBe('route_protection')
    expect(projection.concerns.protection.persistKind).not.toBe('intent_only')
  })

  it('rebuilds override intents from persisted rules', () => {
    const override = buildRouteProtectionOverrideFromRules([
      {
        id: 1,
        route_id: 2,
        stream_id: 3,
        field_path: '$.email',
        sensitivity_class: 'pii',
        protection_mode: 'full_mask',
        enabled: true,
        source_finding_id: null,
        created_by: 'wizard',
        created_at: '',
        updated_at: '',
      },
    ])
    expect(override.intents).toHaveLength(1)
    expect(override.intents[0]).toMatchObject({
      detectedField: '$.email',
      protectionAction: 'mask_full',
    })
  })
})
