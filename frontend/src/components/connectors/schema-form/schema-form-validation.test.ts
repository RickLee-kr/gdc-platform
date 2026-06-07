import { describe, expect, it } from 'vitest'
import { validateSchemaForm } from './schema-form-validation'
import type { GdcAuthSchema } from './schema-form-types'

const schema: GdcAuthSchema = {
  type: 'bearer',
  fields: [
    { name: 'token', label: 'API Token', required: true, min_length: 8, max_length: 128 },
    {
      name: 'region',
      label: 'Region',
      enum: ['us-1', 'eu-1'],
    },
  ],
}

describe('validateSchemaForm', () => {
  it('flags required fields', () => {
    const errors = validateSchemaForm(schema, {})
    expect(errors.some((e) => e.field === 'token')).toBe(true)
  })

  it('enforces min_length and max_length', () => {
    const short = validateSchemaForm(schema, { token: 'abc' })
    expect(short[0]?.message).toContain('at least 8')

    const long = validateSchemaForm(schema, { token: 'x'.repeat(200) })
    expect(long[0]?.message).toContain('at most 128')
  })

  it('enforces enum values', () => {
    const errors = validateSchemaForm(schema, { token: '12345678', region: 'ap-1' })
    expect(errors.some((e) => e.field === 'region')).toBe(true)
  })
})
