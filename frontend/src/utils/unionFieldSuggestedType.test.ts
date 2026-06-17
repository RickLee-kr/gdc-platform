import { describe, expect, it } from 'vitest'
import { suggestUnionFieldTypeLabel } from './unionFieldSuggestedType'

describe('suggestUnionFieldTypeLabel', () => {
  it('maps email fields to Likely Email', () => {
    expect(suggestUnionFieldTypeLabel('$.email')).toBe('Likely Email')
    expect(suggestUnionFieldTypeLabel('$.user.e_mail')).toBe('Likely Email')
  })

  it('maps api key fields to Likely API Key', () => {
    expect(suggestUnionFieldTypeLabel('$.api_key')).toBe('Likely API Key')
    expect(suggestUnionFieldTypeLabel('$.apikey')).toBe('Likely API Key')
  })

  it('maps credit_card fields to Likely Credit Card', () => {
    expect(suggestUnionFieldTypeLabel('$.credit_card')).toBe('Likely Credit Card')
    expect(suggestUnionFieldTypeLabel('$.billing.card_number')).toBe('Likely Credit Card')
  })

  it('maps email sample values to Likely Email', () => {
    expect(suggestUnionFieldTypeLabel('$.contact', ['user@example.com'])).toBe('Likely Email')
  })

  it('returns em dash for other fields', () => {
    expect(suggestUnionFieldTypeLabel('$.user')).toBe('—')
    expect(suggestUnionFieldTypeLabel('$.status')).toBe('—')
    expect(suggestUnionFieldTypeLabel('$.id', ['12345'], 'string')).toBe('—')
  })
})
