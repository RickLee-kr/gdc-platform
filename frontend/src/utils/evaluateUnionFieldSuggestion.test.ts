import { describe, expect, it } from 'vitest'
import { evaluateUnionFieldSuggestion } from './evaluateUnionFieldSuggestion'

describe('evaluateUnionFieldSuggestion', () => {
  it('marks email field name as sensitive with Likely Email', () => {
    const result = evaluateUnionFieldSuggestion('$.email', 'string')
    expect(result).toEqual({ sensitive: true, category: 'pii', suggestedType: 'Likely Email' })
  })

  it('marks email sample value as sensitive with Likely Email', () => {
    const result = evaluateUnionFieldSuggestion('$.user', 'string', ['user@example.com'])
    expect(result).toEqual({ sensitive: true, category: 'pii', suggestedType: 'Likely Email' })
  })

  it('marks PEM sample value as sensitive with Likely Private Key', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----'
    const result = evaluateUnionFieldSuggestion('$.key_material', 'string', [pem])
    expect(result).toEqual({ sensitive: true, category: 'secret', suggestedType: 'Likely Private Key' })
  })

  it('marks api_key field name as sensitive with Likely API Key', () => {
    const result = evaluateUnionFieldSuggestion('$.api_key', 'string')
    expect(result).toEqual({ sensitive: true, category: 'secret', suggestedType: 'Likely API Key' })
  })

  it('marks password field name as sensitive with Likely Password', () => {
    const result = evaluateUnionFieldSuggestion('$.password', 'string')
    expect(result).toEqual({ sensitive: true, category: 'secret', suggestedType: 'Likely Password' })
  })

  it('marks token field name as sensitive with Likely Token', () => {
    const result = evaluateUnionFieldSuggestion('$.token', 'string')
    expect(result).toEqual({ sensitive: true, category: 'secret', suggestedType: 'Likely Token' })
  })

  it('does not mark generic user field as sensitive', () => {
    const result = evaluateUnionFieldSuggestion('$.user', 'string', ['alice'])
    expect(result).toEqual({ sensitive: false, category: null, suggestedType: null })
  })

  it('does not mark id field as sensitive', () => {
    const result = evaluateUnionFieldSuggestion('$.id', 'string', ['12345'])
    expect(result).toEqual({ sensitive: false, category: null, suggestedType: null })
  })

  it('does not mark random_field as sensitive', () => {
    const result = evaluateUnionFieldSuggestion('$.random_field', 'string', ['value'])
    expect(result).toEqual({ sensitive: false, category: null, suggestedType: null })
  })
})
