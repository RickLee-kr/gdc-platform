import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EnrichmentAddFieldMenu } from './enrichment-add-field-menu'
import {
  ENRICHMENT_RULE_TYPES,
  defaultRuleForType,
  type EnrichmentRuleType,
} from './enrichment-rules-model'

const RULE_TYPE_LABELS: Record<EnrichmentRuleType, string> = {
  static: 'New Static',
  calculated: 'New Calculated',
  lookup: 'Region Display Name',
  conditional: 'Outcome Status',
  normalize: 'Normalize',
  timestamp_conversion: 'Timestamp Conversion',
  type_conversion: 'Type Conversion',
  jsonata: 'JSONata Template',
}

describe('EnrichmentAddFieldMenu (206f0f7 add-field menu)', () => {
  it('shows all 206f0f7 enrichment rule types in the dropdown', async () => {
    const user = userEvent.setup()
    render(<EnrichmentAddFieldMenu rules={[]} onRulesChange={() => {}} />)

    await user.click(screen.getByTestId('wizard-transform-add-field-trigger'))

    for (const meta of ENRICHMENT_RULE_TYPES) {
      expect(screen.getByTestId(`wizard-enrichment-add-${meta.type}`)).toHaveTextContent(meta.label)
    }
  })

  it.each(ENRICHMENT_RULE_TYPES.map((meta) => [meta.type, meta.label] as const))(
    'appends a %s rule via defaultRuleForType',
    async (type) => {
      const user = userEvent.setup()
      const onRulesChange = vi.fn()
      render(<EnrichmentAddFieldMenu rules={[]} onRulesChange={onRulesChange} />)

      await user.click(screen.getByTestId('wizard-transform-add-field-trigger'))
      await user.click(screen.getByTestId(`wizard-enrichment-add-${type}`))

      expect(onRulesChange).toHaveBeenCalledTimes(1)
      const next = onRulesChange.mock.calls[0]![0]
      expect(next).toHaveLength(1)
      expect(next[0]?.type).toBe(type)
      expect(next[0]?.label).toBe(RULE_TYPE_LABELS[type])
      const expected = defaultRuleForType(type, 0)
      expect(next[0]?.fieldName).toBe(expected.fieldName)
      expect(next[0]?.enabled).toBe(expected.enabled)
      if (type === 'static') expect(next[0]?.staticValue).toBe(expected.staticValue)
      if (type === 'calculated') expect(next[0]?.expression).toBe(expected.expression)
      if (type === 'lookup') {
        expect(next[0]?.lookupTable).toBe(expected.lookupTable)
        expect(next[0]?.lookupKeyField).toBe(expected.lookupKeyField)
      }
      if (type === 'conditional') {
        expect(next[0]?.conditionalDefault).toBe(expected.conditionalDefault)
        expect(next[0]?.conditions).toHaveLength(expected.conditions.length)
      }
      if (type === 'normalize') {
        expect(next[0]?.normalizeSourceField).toBe(expected.normalizeSourceField)
        expect(next[0]?.normalizeOperation).toBe(expected.normalizeOperation)
        expect(next[0]?.normalizeOnFailure).toBe(expected.normalizeOnFailure)
      }
      if (type === 'timestamp_conversion') {
        expect(next[0]?.tsSourceField).toBe(expected.tsSourceField)
        expect(next[0]?.tsInputFormat).toBe(expected.tsInputFormat)
        expect(next[0]?.tsOutputFormat).toBe(expected.tsOutputFormat)
        expect(next[0]?.fieldName).toBe(expected.tsSourceField)
      }
      if (type === 'jsonata') {
        expect(next[0]?.jtTemplate).toBe(expected.jtTemplate)
        expect(next[0]?.expression).toBe(expected.expression)
        expect(next[0]?.jtAdvancedOverride).toBe(false)
      }
    },
  )

  it('appends after existing rules using the current list length as index', async () => {
    const user = userEvent.setup()
    const existing = defaultRuleForType('static', 0)
    const onRulesChange = vi.fn()
    render(<EnrichmentAddFieldMenu rules={[existing]} onRulesChange={onRulesChange} />)

    await user.click(screen.getByTestId('wizard-transform-add-field-trigger'))
    await user.click(screen.getByTestId('wizard-enrichment-add-calculated'))

    const next = onRulesChange.mock.calls[0]![0]
    expect(next).toHaveLength(2)
    expect(next[1]?.type).toBe('calculated')
    expect(next[1]?.label).toBe('New Calculated')
    expect(next[1]?.fieldName).toBe('metadata.field_2')
  })
})
