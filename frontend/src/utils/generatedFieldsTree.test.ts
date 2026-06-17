import { describe, expect, it } from 'vitest'
import { defaultRuleForType } from '../components/streams/wizard/enrichment-rules-model'
import {
  buildGeneratedFieldTreeNodes,
  enrichmentFieldNameToJsonPath,
  generatedFieldPathMap,
  ruleToSyntheticUnionField,
  visibleGeneratedEnrichmentRules,
} from './generatedFieldsTree'

describe('generatedFieldsTree', () => {
  it('normalizes enrichment field names to json paths', () => {
    expect(enrichmentFieldNameToJsonPath('user_risk')).toBe('$.user_risk')
    expect(enrichmentFieldNameToJsonPath('$.normalized_ip')).toBe('$.normalized_ip')
  })

  it('keeps only enabled rules with field names', () => {
    const rules = [
      { ...defaultRuleForType('static', 0), fieldName: 'user_risk', enabled: true },
      { ...defaultRuleForType('calculated', 1), fieldName: '', enabled: true },
      { ...defaultRuleForType('lookup', 2), fieldName: 'user_department', enabled: false },
    ]
    expect(visibleGeneratedEnrichmentRules(rules)).toHaveLength(1)
    expect(visibleGeneratedEnrichmentRules(rules)[0]?.fieldName).toBe('user_risk')
  })

  it('builds synthetic union fields for static and calculated rules', () => {
    const staticRule = {
      ...defaultRuleForType('static', 0),
      fieldName: 'vendor',
      staticValue: 'Acme',
    }
    const calculatedRule = {
      ...defaultRuleForType('calculated', 1),
      fieldName: 'user_risk',
    }

    expect(ruleToSyntheticUnionField(staticRule)).toEqual({
      field_path: '$.vendor',
      field_type: 'string',
      occurrence_count: 0,
      sample_values: ['Acme'],
    })
    expect(ruleToSyntheticUnionField(calculatedRule)).toEqual({
      field_path: '$.user_risk',
      field_type: 'generated',
      occurrence_count: 0,
      sample_values: [],
    })
  })

  it('builds generated field tree nodes in rule order', () => {
    const rules = [
      { ...defaultRuleForType('static', 0), fieldName: 'user_risk', staticValue: 'high' },
      { ...defaultRuleForType('normalize', 1), fieldName: 'normalized_ip' },
    ]
    const nodes = buildGeneratedFieldTreeNodes(rules)
    expect(nodes.map((n) => n.path)).toEqual(['$.user_risk', '$.normalized_ip'])
    expect(generatedFieldPathMap(rules).size).toBe(2)
  })
})
