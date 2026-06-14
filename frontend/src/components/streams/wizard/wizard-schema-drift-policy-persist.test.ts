import { describe, expect, it, vi } from 'vitest'
import { buildInitialState } from './wizard-state'
import {
  buildSchemaDriftPolicyPersistPayload,
  persistWizardSchemaDriftPolicy,
} from './wizard-schema-drift-policy-persist'

vi.mock('../../../api/gdcStreams', () => ({
  updateStream: vi.fn(),
}))

import { updateStream } from '../../../api/gdcStreams'

describe('wizard schema drift policy persist', () => {
  it('buildSchemaDriftPolicyPersistPayload normalizes wizard enums', () => {
    const state = buildInitialState()
    state.dataProtection.unknownNormalFieldPolicy = 'require_review'
    state.dataProtection.unknownSensitiveFieldPolicy = 'quarantine'
    expect(buildSchemaDriftPolicyPersistPayload(state.dataProtection)).toEqual({
      unknown_normal_field_policy: 'require_review',
      unknown_sensitive_field_policy: 'quarantine',
    })
  })

  it('persistWizardSchemaDriftPolicy PATCHes governance.schema_drift_policy', async () => {
    vi.mocked(updateStream).mockResolvedValueOnce({
      id: 42,
      config_json: {},
    } as never)

    const state = buildInitialState()
    state.dataProtection.unknownNormalFieldPolicy = 'quarantine'
    state.dataProtection.unknownSensitiveFieldPolicy = 'auto_protect'

    const result = await persistWizardSchemaDriftPolicy(42, state.dataProtection, {
      existingConfigJson: { endpoint: '/events' },
    })

    expect(result.saved).toBe(true)
    expect(updateStream).toHaveBeenCalledWith(42, {
      config_json: {
        endpoint: '/events',
        governance: {
          schema_drift_policy: {
            unknown_normal_field_policy: 'quarantine',
            unknown_sensitive_field_policy: 'auto_protect',
          },
        },
      },
    })
  })

  it('persistWizardSchemaDriftPolicy returns errors on API failure', async () => {
    vi.mocked(updateStream).mockRejectedValueOnce(new Error('network down'))
    const state = buildInitialState()
    const result = await persistWizardSchemaDriftPolicy(1, state.dataProtection)
    expect(result.saved).toBe(false)
    expect(result.errors[0]).toContain('network down')
  })
})
