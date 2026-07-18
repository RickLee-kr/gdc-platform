import { describe, expect, it } from 'vitest'
import { defaultRuleForType, enrichmentDictFromRules } from './enrichment-rules-model'
import { previewTypeConversion } from './type-conversion-template'

describe('type-conversion-template', () => {
  it('converts string to integer in preview', () => {
    const { value, warning } = previewTypeConversion('5', 'integer')
    expect(value).toBe(5)
    expect(warning).toBeNull()
  })

  it('converts string to boolean in preview', () => {
    const { value } = previewTypeConversion('true', 'boolean')
    expect(value).toBe(true)
  })

  it('parses JSON array string in preview', () => {
    const { value } = previewTypeConversion('["edr","alert"]', 'array')
    expect(value).toEqual(['edr', 'alert'])
  })

  it('serializes type_conversion under __rules', () => {
    const rule = defaultRuleForType('type_conversion', 0)
    rule.fieldName = 'severity'
    rule.tcSourceField = 'severity'
    rule.tcTargetType = 'integer'
    const dict = enrichmentDictFromRules([rule])
    const stored = (dict.__rules as Record<string, Record<string, unknown>>).severity
    expect(stored.type).toBe('type_conversion')
    expect(stored.source_field).toBe('severity')
    expect(stored.target_type).toBe('integer')
  })
})
