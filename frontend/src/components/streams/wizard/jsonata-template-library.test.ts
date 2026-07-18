import { describe, expect, it } from 'vitest'
import {
  defaultRuleForType,
  enrichmentDictFromRules,
  enrichmentRulesFromDict,
  syncJsonataExpression,
} from './enrichment-rules-model'
import {
  buildJsonataFromTemplate,
  defaultJsonataTemplateParams,
  previewJsonataTemplate,
  type JsonataTemplateParams,
} from './jsonata-template-library'

function params(patch: Partial<JsonataTemplateParams> = {}): JsonataTemplateParams {
  return { ...defaultJsonataTemplateParams(), ...patch }
}

describe('jsonata-template-library', () => {
  it('builds copy / rename / extract expressions', () => {
    expect(buildJsonataFromTemplate('copy_field', params({ sourceField: 'user_id' }))).toBe('user_id')
    expect(buildJsonataFromTemplate('rename_field', params({ sourceField: 'old_name' }))).toBe('old_name')
    expect(buildJsonataFromTemplate('extract_nested', params({ sourcePath: 'user.email' }))).toBe(
      'user.email',
    )
  })

  it('builds concat_fields expression', () => {
    const expr = buildJsonataFromTemplate(
      'concat_fields',
      params({ sourceFields: ['first_name', 'last_name'], separator: ' ' }),
    )
    expect(expr).toBe("$join([$string(first_name), $string(last_name)], ' ')")
  })

  it('builds default_value expression', () => {
    const expr = buildJsonataFromTemplate(
      'default_value',
      params({ sourceField: 'hostname', defaultValue: 'unknown' }),
    )
    expect(expr).toContain('hostname')
    expect(expr).toContain("'unknown'")
  })

  it('builds coalesce expression', () => {
    const expr = buildJsonataFromTemplate(
      'coalesce',
      params({ sourceFields: ['a', 'b', 'c'] }),
    )
    expect(expr).toContain('a')
    expect(expr).toContain('b')
    expect(expr).toContain('c')
  })

  it('builds conditional_value expression', () => {
    const expr = buildJsonataFromTemplate(
      'conditional_value',
      params({
        conditionField: 'status',
        operator: 'eq',
        compareValue: 'success',
        thenValue: 'ok',
        elseValue: 'fail',
      }),
    )
    expect(expr).toContain('status')
    expect(expr).toContain("'success'")
    expect(expr).toContain("'ok'")
    expect(expr).toContain("'fail'")
  })

  it('builds array_join expression', () => {
    expect(
      buildJsonataFromTemplate('array_join', params({ sourceField: 'tags', separator: ',' })),
    ).toBe("$join(tags, ',')")
  })

  it('builds static_value and build_object expressions', () => {
    expect(buildJsonataFromTemplate('static_value', params({ staticValue: 'hello' }))).toBe("'hello'")
    expect(buildJsonataFromTemplate('static_value', params({ staticValue: '42' }))).toBe('42')
    const obj = buildJsonataFromTemplate(
      'build_object',
      params({
        objectPairs: [
          { id: '1', key: 'id', valueField: 'user_id' },
          { id: '2', key: 'name', valueField: 'user_name' },
        ],
      }),
    )
    expect(obj).toBe("{'id': user_id, 'name': user_name}")
  })

  it('previews concat and coalesce on sample event', () => {
    const sample = { first_name: 'Ada', last_name: 'Lovelace', a: '', b: 'second' }
    const concat = previewJsonataTemplate(
      sample,
      'concat_fields',
      params({ sourceFields: ['first_name', 'last_name'], separator: ' ' }),
    )
    expect(concat.value).toBe('Ada Lovelace')
    expect(concat.warning).toBeNull()

    const coal = previewJsonataTemplate(sample, 'coalesce', params({ sourceFields: ['a', 'b'] }))
    expect(coal.value).toBe('second')
  })

  it('preview failures do not throw', () => {
    const result = previewJsonataTemplate(undefined, 'copy_field', params())
    expect(result.warning).toBeTruthy()
    expect(result.value).toBeNull()
  })

  it('serializes jsonata template under __rules', () => {
    const rule = defaultRuleForType('jsonata', 0)
    rule.fieldName = 'full_name'
    rule.jtTemplate = 'concat_fields'
    rule.jtParams = params({ sourceFields: ['first_name', 'last_name'], separator: ' ' })
    rule.jtAdvancedOverride = false
    const synced = syncJsonataExpression(rule)
    const dict = enrichmentDictFromRules([synced])
    const stored = (dict.__rules as Record<string, Record<string, unknown>>).full_name
    expect(stored.type).toBe('jsonata')
    expect(stored.template).toBe('concat_fields')
    expect(stored.expression).toBe("$join([$string(first_name), $string(last_name)], ' ')")
    expect(stored.target_field).toBe('full_name')
    expect(stored.advanced_override).toBeUndefined()
    expect((stored.template_params as Record<string, unknown>).source_fields).toEqual([
      'first_name',
      'last_name',
    ])
  })

  it('marks advanced override when expression is manually edited', () => {
    const rule = defaultRuleForType('jsonata', 0)
    rule.fieldName = 'full_name'
    rule.jtTemplate = 'concat_fields'
    rule.jtParams = params({ sourceFields: ['first_name', 'last_name'], separator: ' ' })
    rule.expression = '$string(first_name)'
    rule.jtAdvancedOverride = true
    const dict = enrichmentDictFromRules([rule])
    const stored = (dict.__rules as Record<string, Record<string, unknown>>).full_name
    expect(stored.advanced_override).toBe(true)
    expect(stored.expression).toBe('$string(first_name)')
  })

  it('restores template UI from enrichment_json when metadata present', () => {
    const rules = enrichmentRulesFromDict({
      __rules: {
        full_name: {
          type: 'jsonata',
          expression: "$join([$string(first_name), $string(last_name)], ' ')",
          template: 'concat_fields',
          template_params: {
            source_fields: ['first_name', 'last_name'],
            separator: ' ',
          },
          target_field: 'full_name',
          enabled: true,
          label: 'Concat Fields',
        },
      },
    })
    expect(rules).toHaveLength(1)
    expect(rules[0]?.type).toBe('jsonata')
    expect(rules[0]?.jtTemplate).toBe('concat_fields')
    expect(rules[0]?.jtAdvancedOverride).toBe(false)
    expect(rules[0]?.jtParams.sourceFields).toEqual(['first_name', 'last_name'])
  })

  it('restores as Advanced when template metadata missing', () => {
    const rules = enrichmentRulesFromDict({
      __rules: {
        custom: {
          type: 'jsonata',
          expression: 'user.id & "-" & user.name',
          enabled: true,
        },
      },
    })
    expect(rules[0]?.jtTemplate).toBe('')
    expect(rules[0]?.jtAdvancedOverride).toBe(true)
    expect(rules[0]?.expression).toBe('user.id & "-" & user.name')
  })

  it('restores as Advanced when stored expression differs from template', () => {
    const rules = enrichmentRulesFromDict({
      __rules: {
        full_name: {
          type: 'jsonata',
          expression: '$string(first_name)',
          template: 'concat_fields',
          template_params: {
            source_fields: ['first_name', 'last_name'],
            separator: ' ',
          },
          enabled: true,
        },
      },
    })
    expect(rules[0]?.jtAdvancedOverride).toBe(true)
  })
})
