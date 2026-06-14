import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildDataProtectionPersistPreview,
  persistWizardDataProtectionIntents,
  protectionActionNeedsFieldRule,
} from './wizard-data-protection-persist'
import { buildInitialState } from './wizard-state'

vi.mock('../../../api/gdcPolicy', () => ({
  createPolicyRule: vi.fn(async () => ({ rule: { id: 1 } })),
}))

vi.mock('../../../api/gdcClassification', () => ({
  createClassificationRule: vi.fn(async () => ({ rule: { id: 2 } })),
}))

import { createPolicyRule } from '../../../api/gdcPolicy'
import { createClassificationRule } from '../../../api/gdcClassification'

describe('wizard-data-protection-persist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('flags enforcement incomplete for masking intents', () => {
    const state = buildInitialState()
    state.dataProtection.intents = [
      {
        key: 'a',
        detectedField: '$.user.email',
        protectionAction: 'mask_partial',
        deliveryBehavior: 'continue',
      },
    ]
    const preview = buildDataProtectionPersistPreview(state.dataProtection)
    expect(preview.enforcementIncomplete).toBe(true)
    expect(preview.warnings.some((w) => w.includes('runtime detection'))).toBe(true)
  })

  it('does not flag enforcement incomplete for audit-only intents', () => {
    const state = buildInitialState()
    state.dataProtection.intents = [
      {
        key: 'a',
        detectedField: '$.user.email',
        protectionAction: 'audit',
        deliveryBehavior: 'continue',
      },
    ]
    const preview = buildDataProtectionPersistPreview(state.dataProtection)
    expect(preview.enforcementIncomplete).toBe(false)
  })

  it('persists policy and classification rules grouped by sensitivity class', async () => {
    const state = buildInitialState()
    state.dataProtection.intents = [
      {
        key: 'a',
        detectedField: '$.user.email',
        protectionAction: 'mask_partial',
        deliveryBehavior: 'quarantine',
      },
      {
        key: 'b',
        detectedField: '$.api_key',
        protectionAction: 'mask_full',
        deliveryBehavior: 'block',
      },
    ]

    const result = await persistWizardDataProtectionIntents(42, state.dataProtection)
    expect(result.saved).toBe(true)
    expect(result.policyRulesCreated).toBe(2)
    expect(result.classificationRulesCreated).toBe(2)
    expect(createPolicyRule).toHaveBeenCalledTimes(2)
    expect(createClassificationRule).toHaveBeenCalledTimes(2)
    expect(result.enforcementIncomplete).toBe(true)
  })

  it('maps block delivery to quarantine policy action', async () => {
    const state = buildInitialState()
    state.dataProtection.intents = [
      {
        key: 'a',
        detectedField: '$.secret',
        protectionAction: 'audit',
        deliveryBehavior: 'block',
      },
    ]
    await persistWizardDataProtectionIntents(7, state.dataProtection)
    expect(createPolicyRule).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        action_type: 'quarantine',
        condition_json: { sensitivity_class: 'secret' },
      }),
    )
  })

  it('skips persist when no intents configured', async () => {
    const result = await persistWizardDataProtectionIntents(1, buildInitialState().dataProtection)
    expect(result.saved).toBe(true)
    expect(createPolicyRule).not.toHaveBeenCalled()
    expect(createClassificationRule).not.toHaveBeenCalled()
  })

  it('identifies field-level protection actions', () => {
    expect(protectionActionNeedsFieldRule('audit')).toBe(false)
    expect(protectionActionNeedsFieldRule('mask_partial')).toBe(true)
  })
})
