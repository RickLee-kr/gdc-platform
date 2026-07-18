import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EnrichmentRulesEditor } from './enrichment-rules-editor'
import {
  defaultRuleForType,
  enrichmentDictFromRules,
  enrichmentRulesFromDict,
  normalizeWizardEnrichmentRule,
} from './enrichment-rules-model'
import {
  applyIanaTimezoneSelection,
  applyTimestampTimezoneSelection,
  previewTimestampConversion,
  TIMESTAMP_SOURCE_TIMEZONE_VALUE,
  timestampTimezoneSelectionValue,
  unionPathToSourceField,
} from './timestamp-conversion-template'
import type { UnionSchema } from '../../../utils/unionSchema'

const UNION_SCHEMA: UnionSchema = {
  total_events: 10,
  fields: [
    {
      field_path: '$.event_time',
      field_type: 'integer',
      occurrence_count: 10,
      sample_values: [1679333933200],
    },
    {
      field_path: '$.created_at',
      field_type: 'string',
      occurrence_count: 8,
      sample_values: ['2023-03-20T22:18:53.200Z'],
    },
  ],
}

describe('Timestamp Conversion field pickers', () => {
  it('lists Union Schema fields as Source Field candidates and supports search', async () => {
    const user = userEvent.setup()
    const rule = defaultRuleForType('timestamp_conversion', 0)
    render(
      <EnrichmentRulesEditor
        rules={[rule]}
        onChange={() => {}}
        unionSchema={UNION_SCHEMA}
        targetFieldCandidates={['@timestamp', 'event_name']}
      />,
    )

    await user.click(screen.getByLabelText(/Expand rule/i))
    await user.click(screen.getByTestId('ts-source-field-trigger'))
    expect(screen.getByTestId('ts-source-field-option-event_time')).toBeInTheDocument()
    expect(screen.getByTestId('ts-source-field-option-created_at')).toBeInTheDocument()

    await user.type(screen.getByTestId('ts-source-field-search'), 'created')
    expect(screen.getByTestId('ts-source-field-option-created_at')).toBeInTheDocument()
    expect(screen.queryByTestId('ts-source-field-option-event_time')).not.toBeInTheDocument()
  })

  it('preserves a Source Field missing from the current Union Schema', async () => {
    const user = userEvent.setup()
    const rule = {
      ...defaultRuleForType('timestamp_conversion', 0),
      tsSourceField: 'legacy_ts',
      fieldName: 'legacy_ts',
    }
    render(
      <EnrichmentRulesEditor
        rules={[rule]}
        onChange={() => {}}
        unionSchema={UNION_SCHEMA}
      />,
    )

    await user.click(screen.getByLabelText(/Expand rule/i))
    expect(screen.getByTestId('ts-source-field-missing-warning')).toHaveTextContent(
      'This field is not present in the current Union Schema.',
    )
    expect(screen.getByTestId('ts-source-field-trigger')).toHaveTextContent('legacy_ts')
  })

  it('allows selecting an existing Target Field and creating a new one', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const rule = defaultRuleForType('timestamp_conversion', 0)
    render(
      <EnrichmentRulesEditor
        rules={[rule]}
        onChange={onChange}
        unionSchema={UNION_SCHEMA}
        targetFieldCandidates={['@timestamp', 'event_name']}
      />,
    )

    await user.click(screen.getByLabelText(/Expand rule/i))
    await user.click(screen.getByTestId('ts-target-field-trigger'))
    await user.click(screen.getByTestId('ts-target-field-option-@timestamp'))
    expect(onChange).toHaveBeenCalled()
    const afterSelect = onChange.mock.calls.at(-1)![0][0]
    expect(afterSelect.fieldName).toBe('@timestamp')

    onChange.mockClear()
    await user.click(screen.getByTestId('ts-target-field-trigger'))
    await user.type(screen.getByTestId('ts-target-field-search'), 'custom_ts')
    await user.click(screen.getByTestId('ts-target-field-create'))
    const afterCreate = onChange.mock.calls.at(-1)![0][0]
    expect(afterCreate.fieldName).toBe('custom_ts')
  })

  it('does not render a duplicate Target Field input', async () => {
    const user = userEvent.setup()
    const rule = defaultRuleForType('timestamp_conversion', 0)
    render(
      <EnrichmentRulesEditor
        rules={[rule]}
        onChange={() => {}}
        unionSchema={UNION_SCHEMA}
      />,
    )
    await user.click(screen.getByLabelText(/Expand rule/i))
    const card = screen.getByTestId('timestamp-conversion-fields')
    expect(within(card).getAllByText(/^Target Field$/i)).toHaveLength(1)
    expect(screen.queryByPlaceholderText('metadata.field_name')).not.toBeInTheDocument()
    expect(screen.getByTestId('ts-card-summary')).toHaveTextContent('event_time → event_time')
  })

  it('maps Input/Output Format selects to runtime enum values', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const rule = defaultRuleForType('timestamp_conversion', 0)
    render(<EnrichmentRulesEditor rules={[rule]} onChange={onChange} unionSchema={UNION_SCHEMA} />)
    await user.click(screen.getByLabelText(/Expand rule/i))

    await user.selectOptions(screen.getByTestId('ts-input-format'), 'unix_s')
    expect(onChange.mock.calls.at(-1)![0][0].tsInputFormat).toBe('unix_s')

    await user.selectOptions(screen.getByTestId('ts-output-format'), 'unix_ms')
    expect(onChange.mock.calls.at(-1)![0][0].tsOutputFormat).toBe('unix_ms')

    const input = screen.getByTestId('ts-input-format')
    expect(within(input).getByRole('option', { name: 'ISO 8601 / RFC 3339' })).toHaveValue('iso8601')
    expect(within(input).getByRole('option', { name: 'Auto' })).toHaveValue('auto')
  })

  it('shows Source Timezone for mode=source and persists UTC selection', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const rule = {
      ...defaultRuleForType('timestamp_conversion', 0),
      tsTimezoneMode: 'source' as const,
      tsCustomTimezone: '',
    }
    render(<EnrichmentRulesEditor rules={[rule]} onChange={onChange} unionSchema={UNION_SCHEMA} />)
    await user.click(screen.getByLabelText(/Expand rule/i))
    expect(screen.getByTestId('ts-timezone-trigger')).toHaveTextContent('Source Timezone')
    expect(screen.queryByTestId('ts-timezone-source-note')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('ts-timezone-trigger'))
    expect(screen.getByTestId('ts-timezone-option-source')).toBeInTheDocument()
    await user.click(screen.getByTestId('ts-timezone-option-UTC'))
    expect(onChange.mock.calls.at(-1)![0][0]).toMatchObject({
      tsTimezoneMode: 'utc',
      tsCustomTimezone: '',
    })
  })

  it('uses IANA timezone combobox and can switch to Source Timezone', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const rule = {
      ...defaultRuleForType('timestamp_conversion', 0),
      tsTimezoneMode: 'custom' as const,
      tsCustomTimezone: 'Asia/Seoul',
    }
    render(<EnrichmentRulesEditor rules={[rule]} onChange={onChange} unionSchema={UNION_SCHEMA} />)
    await user.click(screen.getByLabelText(/Expand rule/i))
    expect(screen.getByTestId('ts-timezone-trigger')).toHaveTextContent('Asia/Seoul')

    await user.click(screen.getByTestId('ts-timezone-trigger'))
    await user.click(screen.getByTestId('ts-timezone-option-source'))
    expect(onChange.mock.calls.at(-1)![0][0]).toMatchObject({
      tsTimezoneMode: 'source',
      tsCustomTimezone: '',
    })
  })

  it('maps timezone selection helpers to runtime storage modes', () => {
    expect(timestampTimezoneSelectionValue('source', '')).toBe(TIMESTAMP_SOURCE_TIMEZONE_VALUE)
    expect(timestampTimezoneSelectionValue('utc', '')).toBe('UTC')
    expect(timestampTimezoneSelectionValue('custom', 'Asia/Tokyo')).toBe('Asia/Tokyo')
    expect(applyTimestampTimezoneSelection(TIMESTAMP_SOURCE_TIMEZONE_VALUE)).toEqual({
      tsTimezoneMode: 'source',
      tsCustomTimezone: '',
    })
    expect(applyTimestampTimezoneSelection('UTC')).toEqual({
      tsTimezoneMode: 'utc',
      tsCustomTimezone: '',
    })
    expect(applyTimestampTimezoneSelection('Asia/Seoul')).toEqual({
      tsTimezoneMode: 'custom',
      tsCustomTimezone: 'Asia/Seoul',
    })
    expect(applyIanaTimezoneSelection('Asia/Seoul')).toEqual({
      tsTimezoneMode: 'custom',
      tsCustomTimezone: 'Asia/Seoul',
    })
  })

  it('hydrates Edit Wizard settings for source/utc/custom timezones', () => {
    for (const tz of [
      { mode: 'source' as const, custom: '', expected: { mode: 'source' } },
      { mode: 'utc' as const, custom: '', expected: { mode: 'utc' } },
      {
        mode: 'custom' as const,
        custom: 'Asia/Tokyo',
        expected: { mode: 'custom', iana: 'Asia/Tokyo' },
      },
    ]) {
      const rule = {
        ...defaultRuleForType('timestamp_conversion', 0),
        fieldName: '@timestamp',
        tsSourceField: 'event_time',
        tsInputFormat: 'unix_ms' as const,
        tsOutputFormat: 'utc_iso8601' as const,
        tsTimezoneMode: tz.mode,
        tsCustomTimezone: tz.custom,
        tsOnFailure: 'set_null' as const,
      }
      const stored = enrichmentDictFromRules([rule])
      const ts = (stored.__rules as Record<string, unknown>)['@timestamp'] as Record<string, unknown>
      expect(ts.timezone).toEqual(tz.expected)
      const restored = enrichmentRulesFromDict(stored as Record<string, unknown>)
      expect(restored[0]).toMatchObject({
        tsTimezoneMode: tz.mode,
        tsCustomTimezone: tz.custom,
        tsSourceField: 'event_time',
        tsInputFormat: 'unix_ms',
        tsOutputFormat: 'utc_iso8601',
        tsOnFailure: 'set_null',
        fieldName: '@timestamp',
      })
    }
  })

  it('previews using Union Schema sample_values and shows failure reasons', async () => {
    const user = userEvent.setup()
    const rule = defaultRuleForType('timestamp_conversion', 0)
    const { rerender } = render(
      <EnrichmentRulesEditor rules={[rule]} onChange={() => {}} unionSchema={UNION_SCHEMA} />,
    )
    await user.click(screen.getByLabelText(/Expand rule/i))
    expect(screen.getByTestId('ts-preview-before')).toHaveTextContent('1679333933200')
    expect(screen.getByTestId('ts-preview-after').textContent).toMatch(/2023-03-20T17:38:53\.200Z/)

    const badRule = {
      ...rule,
      tsInputFormat: 'unix_ms' as const,
      tsSourceField: 'created_at',
      fieldName: 'created_at',
    }
    rerender(<EnrichmentRulesEditor rules={[badRule]} onChange={() => {}} unionSchema={UNION_SCHEMA} />)
    expect(screen.getByTestId('ts-preview-warning').textContent).toMatch(/Preview unavailable/i)
    expect(screen.getByTestId('ts-preview-warning').textContent).toMatch(/Unix Milliseconds/i)
  })

  it('defaults Target Field to Source Field and prefills from selected path', () => {
    const rule = defaultRuleForType('timestamp_conversion', 0, { sourceField: 'created_at' })
    expect(rule.tsSourceField).toBe('created_at')
    expect(rule.fieldName).toBe('created_at')
    expect(unionPathToSourceField('$.event_time')).toBe('event_time')
  })

  it('hydrates bare IANA timezone strings as custom', () => {
    const hydrated = normalizeWizardEnrichmentRule({
      id: 'r1',
      type: 'timestamp_conversion',
      fieldName: '@timestamp',
      source_field: 'event_time',
      input_format: 'unix_ms',
      output_format: 'utc_iso8601',
      timezone: 'Asia/Seoul',
      on_failure: 'keep_original',
    })
    expect(hydrated).toMatchObject({
      tsTimezoneMode: 'custom',
      tsCustomTimezone: 'Asia/Seoul',
    })
  })
})

describe('previewTimestampConversion', () => {
  it('converts unix ms sample to UTC ISO', () => {
    const result = previewTimestampConversion({
      raw: 1679333933200,
      inputFormat: 'unix_ms',
      outputFormat: 'utc_iso8601',
    })
    expect(result.warning).toBeNull()
    expect(String(result.after)).toBe('2023-03-20T17:38:53.200Z')
  })

  it('explains format mismatch failures', () => {
    const result = previewTimestampConversion({
      raw: 'not-a-number',
      inputFormat: 'unix_ms',
      outputFormat: 'utc_iso8601',
    })
    expect(result.warning).toMatch(/Preview unavailable/)
    expect(result.warning).toMatch(/Unix Milliseconds/)
  })
})
