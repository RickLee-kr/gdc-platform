import { describe, expect, it } from 'vitest'
import {
  collectWizardDetectedFieldCandidates,
  inferWizardSensitivityClass,
  suggestLikelySensitiveFields,
  suggestLikelySensitiveFieldsFromState,
} from './wizard-data-protection-fields'
import { buildInitialState } from './wizard-state'

describe('wizard-data-protection-fields', () => {
  it('infers secret class from password-like paths', () => {
    expect(inferWizardSensitivityClass('$.user.password')).toBe('secret')
    expect(inferWizardSensitivityClass('$.api_key')).toBe('secret')
  })

  it('infers pii class from email-like paths', () => {
    expect(inferWizardSensitivityClass('$.user.email')).toBe('pii')
  })

  it('collects candidates from mapped runtime event paths', () => {
    const state = buildInitialState()
    state.apiTest.extractedEvents = [{ email: 'a@b.c', token: 'x', id: '1' }]
    state.mapping = [{ id: 'm1', outputField: 'event_id', sourceJsonPath: '$.id' }]
    const candidates = collectWizardDetectedFieldCandidates(state)
    expect(candidates).toContain('$.email')
    expect(candidates).toContain('$.token')
    expect(candidates).toContain('$.event_id')
  })

  it('collects mapping rename output path after flatten', () => {
    const state = buildInitialState()
    state.apiTest.extractedEvents = [{ user: { email: 'a@b.c' } }]
    state.mapping = [{ id: 'm1', outputField: 'email', sourceJsonPath: '$.user.email' }]
    const candidates = collectWizardDetectedFieldCandidates(state)
    expect(candidates).toContain('$.email')
    expect(candidates).not.toContain('$.user.email')
  })

  it('suggests likely sensitive fields from candidates using union field rules', () => {
    const likely = suggestLikelySensitiveFields(['$.id', '$.user.email', '$.count', '$.random_field'])
    expect(likely).toContain('$.user.email')
    expect(likely).not.toContain('$.count')
    expect(likely).not.toContain('$.id')
    expect(likely).not.toContain('$.random_field')
  })

  it('suggests fields with email sample values even when field name is generic', () => {
    const samples = new Map<string, readonly unknown[]>([['$.contact', ['user@example.com']]])
    const likely = suggestLikelySensitiveFields(['$.contact', '$.status'], samples)
    expect(likely).toContain('$.contact')
    expect(likely).not.toContain('$.status')
  })

  it('suggests likely sensitive fields from wizard state with sample values', () => {
    const state = buildInitialState()
    state.apiTest.extractedEvents = [{ email: 'a@b.c', id: '1', status: 'ok' }]
    const likely = suggestLikelySensitiveFieldsFromState(state)
    expect(likely).toContain('$.email')
    expect(likely).not.toContain('$.id')
    expect(likely).not.toContain('$.status')
  })
})
