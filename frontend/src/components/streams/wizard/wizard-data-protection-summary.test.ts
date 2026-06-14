import { describe, expect, it } from 'vitest'
import {
  protectionRulesReviewRows,
  schemaDriftPolicyPhase1Warnings,
  schemaDriftPolicyReviewSummary,
} from './wizard-data-protection-summary'
import { buildInitialState } from './wizard-state'

describe('schemaDriftPolicyPhase1Warnings', () => {
  it('warns when Auto Protect is selected for unknown sensitive fields', () => {
    const state = buildInitialState()
    expect(schemaDriftPolicyPhase1Warnings(state.dataProtection)).toHaveLength(1)
    expect(schemaDriftPolicyPhase1Warnings(state.dataProtection)[0]).toContain('Phase 1')
  })

  it('returns no warnings for require_review', () => {
    const state = buildInitialState()
    state.dataProtection.unknownSensitiveFieldPolicy = 'require_review'
    expect(schemaDriftPolicyPhase1Warnings(state.dataProtection)).toEqual([])
  })
})

describe('schemaDriftPolicyReviewSummary', () => {
  it('returns human-readable labels for default policies', () => {
    const state = buildInitialState()
    expect(schemaDriftPolicyReviewSummary(state.dataProtection)).toEqual({
      unknownNormalField: 'Pass Through',
      unknownSensitiveField: 'Auto Protect',
    })
  })

  it('returns human-readable labels for custom policies', () => {
    const state = buildInitialState()
    state.dataProtection.unknownNormalFieldPolicy = 'quarantine'
    state.dataProtection.unknownSensitiveFieldPolicy = 'require_review'
    expect(schemaDriftPolicyReviewSummary(state.dataProtection)).toEqual({
      unknownNormalField: 'Quarantine',
      unknownSensitiveField: 'Require Review',
    })
  })

  it('builds protection rule review rows', () => {
    const state = buildInitialState()
    state.dataProtection.intents = [
      { key: 'r1', detectedField: '$.email', protectionAction: 'audit', deliveryBehavior: 'continue' },
    ]
    expect(protectionRulesReviewRows(state.dataProtection.intents)).toEqual([
      {
        detectedField: '$.email',
        protectionAction: 'Audit only',
        deliveryBehavior: 'Continue delivery',
      },
    ])
  })
})
