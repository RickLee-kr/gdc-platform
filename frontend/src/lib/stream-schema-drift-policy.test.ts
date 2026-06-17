import { describe, expect, it } from 'vitest'
import { schemaDriftPolicyLabelsFromStreamConfig } from './stream-schema-drift-policy'

describe('schemaDriftPolicyLabelsFromStreamConfig', () => {
  it('returns defaults when config is absent (Case 1 / 2 defaults)', () => {
    expect(schemaDriftPolicyLabelsFromStreamConfig(null)).toEqual({
      unknownNormalField: 'Pass Through',
      unknownSensitiveField: 'Auto Protect',
    })
  })

  it('returns deployed policy labels (Case 1 / 2 custom)', () => {
    expect(
      schemaDriftPolicyLabelsFromStreamConfig({
        governance: {
          schema_drift_policy: {
            unknown_normal_field_policy: 'pass_through',
            unknown_sensitive_field_policy: 'auto_protect',
          },
        },
      }),
    ).toEqual({
      unknownNormalField: 'Pass Through',
      unknownSensitiveField: 'Auto Protect',
    })
  })
})
