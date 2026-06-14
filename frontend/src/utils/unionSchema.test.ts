import { describe, expect, it } from 'vitest'
import { buildUnionSchema, formatUnionOccurrence, isRareUnionField } from './unionSchema'

describe('unionSchema', () => {
  it('aggregates occurrence counts across events', () => {
    const schema = buildUnionSchema([
      { user: 'a', email: 'a@test.com', phone: '010' },
      { user: 'b', email: 'b@test.com' },
      { user: 'c', email: 'c@test.com' },
    ])
    expect(schema.total_events).toBe(3)
    const user = schema.fields.find((f) => f.field_path === '$.user')
    const phone = schema.fields.find((f) => f.field_path === '$.phone')
    expect(user?.occurrence_count).toBe(3)
    expect(phone?.occurrence_count).toBe(1)
    expect(phone && isRareUnionField(phone, schema)).toBe(true)
    expect(user && formatUnionOccurrence(user, schema)).toBe('3/3')
  })

  it('collects up to five sample values', () => {
    const schema = buildUnionSchema([
      { id: '1' },
      { id: '2' },
      { id: '3' },
      { id: '4' },
      { id: '5' },
      { id: '6' },
    ])
    const idField = schema.fields.find((f) => f.field_path === '$.id')
    expect(idField?.sample_values.length).toBeLessThanOrEqual(5)
  })
})
