import { describe, expect, it } from 'vitest'
import {
  FIELD_IMPORTANCE_HELP,
  SAMPLE_RECORD_FIELD_IMPORTANCE,
  TRANSFORM_FIELD_IMPORTANCE,
} from './field-importance'

describe('SAMPLE_RECORD_FIELD_IMPORTANCE', () => {
  it('classifies Record Path and Checkpoint as required, Event Root as optional', () => {
    expect(SAMPLE_RECORD_FIELD_IMPORTANCE.recordPath).toBe('required')
    expect(SAMPLE_RECORD_FIELD_IMPORTANCE.checkpoint).toBe('required')
    expect(SAMPLE_RECORD_FIELD_IMPORTANCE.eventRoot).toBe('optional')
  })

  it('documents operator-facing help for each field', () => {
    expect(FIELD_IMPORTANCE_HELP.recordPath).toMatch(/confirm/i)
    expect(FIELD_IMPORTANCE_HELP.checkpoint).toMatch(/never auto/i)
    expect(FIELD_IMPORTANCE_HELP.eventRoot).toMatch(/optional/i)
  })
})

describe('TRANSFORM_FIELD_IMPORTANCE', () => {
  it('marks output fields required and transform rules optional', () => {
    expect(TRANSFORM_FIELD_IMPORTANCE.outputFields).toBe('required')
    expect(TRANSFORM_FIELD_IMPORTANCE.transformRules).toBe('optional')
    expect(TRANSFORM_FIELD_IMPORTANCE.outputVerification).toBe('recommended')
  })
})
