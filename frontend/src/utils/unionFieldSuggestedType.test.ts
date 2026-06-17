import { describe, expect, it } from 'vitest'
import { suggestUnionFieldTypeLabel } from './unionFieldSuggestedType'

describe('suggestUnionFieldTypeLabel', () => {
  it('maps email fields to Email Address', () => {
    expect(suggestUnionFieldTypeLabel('$.email')).toBe('Email Address')
    expect(suggestUnionFieldTypeLabel('$.user.e_mail')).toBe('Email Address')
  })

  it('maps api key fields to API Key', () => {
    expect(suggestUnionFieldTypeLabel('$.api_key')).toBe('API Key')
    expect(suggestUnionFieldTypeLabel('$.apikey')).toBe('API Key')
  })

  it('maps credit_card fields to Credit Card', () => {
    expect(suggestUnionFieldTypeLabel('$.credit_card')).toBe('Credit Card')
    expect(suggestUnionFieldTypeLabel('$.billing.credit_card_number')).toBe('Credit Card')
  })

  it('returns em dash for other fields', () => {
    expect(suggestUnionFieldTypeLabel('$.user')).toBe('—')
    expect(suggestUnionFieldTypeLabel('$.status')).toBe('—')
  })
})
