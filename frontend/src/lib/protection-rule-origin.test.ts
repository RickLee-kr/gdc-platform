import { describe, expect, it } from 'vitest'
import { protectionRuleOrigin } from './protection-rule-origin'

describe('protectionRuleOrigin', () => {
  it('returns Operator when source_finding_id is set', () => {
    expect(protectionRuleOrigin(42)).toBe('Operator')
  })

  it('returns Wizard when source_finding_id is null', () => {
    expect(protectionRuleOrigin(null)).toBe('Wizard')
  })
})
