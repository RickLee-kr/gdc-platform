import { describe, expect, it } from 'vitest'
import { buildUnionSchema, formatUnionOccurrence, isRareUnionField, unionSchemaFromStreamConfig } from './unionSchema'

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

  it('unionSchemaFromStreamConfig parses persisted config_json payload', () => {
    const schema = unionSchemaFromStreamConfig({
      union_schema: {
        total_events: 3,
        fields: [
          {
            field_path: '$.id',
            field_type: 'string',
            occurrence_count: 3,
            sample_values: ['1'],
          },
        ],
        snapshot_at: '2026-06-17T00:00:00.000Z',
      },
    })
    expect(schema?.total_events).toBe(3)
    expect(schema?.fields[0]?.field_path).toBe('$.id')
  })
})
