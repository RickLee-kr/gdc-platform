import { describe, expect, it } from 'vitest'
import { defaultAdvancedRule } from '../types/advancedTransform'
import {
  buildEnrichmentWithAdvancedFields,
  buildFieldMappingsWithTransformRules,
  parseAdvancedFieldsFromEnrichment,
  parseTransformRulesFromFieldMappings,
  ruleDraftToApiPayload,
} from './advancedTransformConfig'

describe('advancedTransformConfig', () => {
  it('serializes jsonata rule for mapping transform_rules', () => {
    const rule = defaultAdvancedRule('advanced')
    rule.outputField = 'event_source'
    rule.expression = "vendor & '_' & product"
    rule.defaultValue = 'unknown'
    const payload = ruleDraftToApiPayload(rule)
    expect(payload.mode).toBe('jsonata')
    expect(payload.output_field).toBe('event_source')
    expect(payload.default_value).toBe('unknown')
  })

  it('builds field_mappings with transform_rules', () => {
    const rule = defaultAdvancedRule('expert')
    rule.outputField = 'src_ip'
    rule.pattern = 'src=(\\d+)'
    const fm = buildFieldMappingsWithTransformRules({ a: '$.x' }, [rule])
    expect(fm.a).toBe('$.x')
    expect(Array.isArray(fm.transform_rules)).toBe(true)
  })

  it('parses transform_rules from stored config', () => {
    const rules = parseTransformRulesFromFieldMappings({
      severity: '$.sev',
      transform_rules: [
        { output_field: 'score', mode: 'jsonata', expression: '1' },
      ],
    })
    expect(rules).toHaveLength(1)
    expect(rules[0]?.outputField).toBe('score')
  })

  it('builds enrichment advanced_fields', () => {
    const rule = defaultAdvancedRule('advanced')
    rule.outputField = 'event_source'
    rule.expression = 'vendor'
    const en = buildEnrichmentWithAdvancedFields({ vendor: 'A' }, [rule])
    expect(en.vendor).toBe('A')
    expect(Array.isArray(en.advanced_fields)).toBe(true)
  })

  it('parses advanced_fields from enrichment', () => {
    const rules = parseAdvancedFieldsFromEnrichment({
      vendor: 'A',
      advanced_fields: [{ field: 'event_source', mode: 'jsonata', expression: 'vendor' }],
    })
    expect(rules[0]?.outputField).toBe('event_source')
  })
})
