import { describe, expect, it } from 'vitest'
import {
  defaultRuleForType,
  enrichmentDictFromRules,
  localTimestampConversionIssues,
} from './enrichment-rules-model'
import {
  buildTimestampJsonataTemplate,
  timestampFormatsEquivalent,
} from './timestamp-conversion-template'

describe('timestamp conversion model', () => {
  it('defaults to event_time → event_time unix_ms → utc_iso8601', () => {
    const rule = defaultRuleForType('timestamp_conversion', 0)
    expect(rule.fieldName).toBe('event_time')
    expect(rule.tsSourceField).toBe('event_time')
    expect(rule.tsInputFormat).toBe('unix_ms')
    expect(rule.tsOutputFormat).toBe('utc_iso8601')
  })

  it('serializes timestamp_conversion under __rules', () => {
    const rule = {
      ...defaultRuleForType('timestamp_conversion', 0),
      fieldName: '@timestamp',
    }
    const payload = enrichmentDictFromRules([rule])
    expect(payload.__rules).toBeDefined()
    const ts = (payload.__rules as Record<string, unknown>)['@timestamp'] as Record<string, unknown>
    expect(ts).toMatchObject({
      type: 'timestamp_conversion',
      source_field: 'event_time',
      input_format: 'unix_ms',
      output_format: 'utc_iso8601',
      on_failure: 'keep_original',
    })
    expect(ts.timezone).toEqual({ mode: 'utc' })
  })

  it('flags missing source/target and identical formats', () => {
    const rule = {
      ...defaultRuleForType('timestamp_conversion', 0),
      fieldName: '',
      tsSourceField: '',
      tsInputFormat: 'unix_ms' as const,
      tsOutputFormat: 'unix_ms' as const,
    }
    const issues = localTimestampConversionIssues(rule)
    expect(issues.some((i) => i.code === 'missing_source_field')).toBe(true)
    expect(issues.some((i) => i.code === 'missing_target_field')).toBe(true)
    expect(issues.some((i) => i.code === 'timestamp_formats_identical')).toBe(true)
  })

  it('builds JSONata templates for common conversions', () => {
    expect(buildTimestampJsonataTemplate({ sourceField: 'event_time', inputFormat: 'unix_ms', outputFormat: 'utc_iso8601' })).toContain(
      '$fromMillis',
    )
    expect(buildTimestampJsonataTemplate({ sourceField: 'ts', inputFormat: 'unix_s', outputFormat: 'utc_iso8601' })).toContain(
      '* 1000',
    )
    expect(
      buildTimestampJsonataTemplate({
        sourceField: 'ts',
        inputFormat: 'iso8601',
        outputFormat: 'unix_ms',
      }),
    ).toContain('$toMillis')
  })

  it('detects equivalent formats', () => {
    expect(timestampFormatsEquivalent('unix_ms', 'unix_ms')).toBe(true)
    expect(timestampFormatsEquivalent('iso8601', 'utc_iso8601')).toBe(true)
    expect(timestampFormatsEquivalent('unix_ms', 'utc_iso8601')).toBe(false)
  })
})
