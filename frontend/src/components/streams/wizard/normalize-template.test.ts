import { describe, expect, it } from 'vitest'
import {
  defaultRuleForType,
  enrichmentDictFromRules,
  enrichmentRulesFromDict,
} from './enrichment-rules-model'
import { previewNormalize, previewNormalizeRule } from './normalize-template'

describe('normalize-template', () => {
  it('normalizes email in preview', () => {
    const { value, warning } = previewNormalize(' ADMIN@Company.COM ', 'normalize_email')
    expect(value).toBe('admin@company.com')
    expect(warning).toBeNull()
  })

  it('normalizes username from DOMAIN\\user', () => {
    const { value } = previewNormalize('DOMAIN\\user01', 'normalize_username')
    expect(value).toBe('user01')
  })

  it('normalizes hostname to short name', () => {
    const { value } = previewNormalize('host01.company.local', 'normalize_hostname')
    expect(value).toBe('host01')
  })

  it('extracts domain from email', () => {
    const { value } = previewNormalize('user@company.com', 'extract_domain')
    expect(value).toBe('company.com')
  })

  it('removes domain from email', () => {
    const { value } = previewNormalize('user@company.com', 'remove_domain')
    expect(value).toBe('user')
  })

  it('previewNormalizeRule surfaces unavailable reasons', () => {
    expect(previewNormalizeRule({ raw: undefined, operation: 'trim' }).warning).toMatch(/Preview unavailable/)
    expect(previewNormalizeRule({ raw: 'x', operation: 'normalize_email' }).warning).toMatch(/Normalize Email/)
  })

  it('serializes normalize under __rules with operation', () => {
    const rule = defaultRuleForType('normalize', 0)
    rule.fieldName = 'email'
    rule.normalizeSourceField = 'email'
    rule.normalizeOperation = 'normalize_email'
    rule.normalizeOnFailure = 'keep_original'
    const dict = enrichmentDictFromRules([rule])
    const stored = (dict.__rules as Record<string, Record<string, unknown>>).email
    expect(stored.type).toBe('normalize')
    expect(stored.source_field).toBe('email')
    expect(stored.operation).toBe('normalize_email')
    expect(stored.on_failure).toBe('keep_original')
  })

  it('restores normalize rule from enrichment_json dict', () => {
    const rules = enrichmentRulesFromDict({
      __rules: {
        email: {
          type: 'normalize',
          source_field: 'raw_email',
          operation: 'normalize_email',
          on_failure: 'set_null',
          enabled: true,
          label: 'Normalize Email',
        },
      },
    })
    expect(rules).toHaveLength(1)
    expect(rules[0]?.type).toBe('normalize')
    expect(rules[0]?.fieldName).toBe('email')
    expect(rules[0]?.normalizeSourceField).toBe('raw_email')
    expect(rules[0]?.normalizeOperation).toBe('normalize_email')
    expect(rules[0]?.normalizeOnFailure).toBe('set_null')
  })

  it('defaults new normalize rules from selected source field', () => {
    const rule = defaultRuleForType('normalize', 0, { sourceField: 'user.email' })
    expect(rule.normalizeSourceField).toBe('user.email')
    expect(rule.fieldName).toBe('user.email')
  })
})
