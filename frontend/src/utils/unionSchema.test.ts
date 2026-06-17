import { describe, expect, it } from 'vitest'
import {
  buildUnionSchema,
  formatUnionOccurrence,
  isRareUnionField,
  unionSchemaFromStreamConfig,
  type UnionSchema,
  type UnionSchemaField,
} from './unionSchema'

function fieldAt(schema: UnionSchema, path: string): UnionSchemaField {
  const field = schema.fields.find((f) => f.field_path === path)
  if (!field) throw new Error(`missing field ${path}`)
  return field
}

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
    expect(phone && isRareUnionField(phone, schema)).toBe(false)
    expect(user && formatUnionOccurrence(user, schema)).toBe('3/3')
  })

  describe('isRareUnionField (30% threshold)', () => {
    const tenEventSchema: UnionSchema = {
      total_events: 10,
      fields: [
        { field_path: '$.always', field_type: 'string', occurrence_count: 10, sample_values: [] },
        { field_path: '$.often', field_type: 'string', occurrence_count: 8, sample_values: [] },
        { field_path: '$.sometimes', field_type: 'string', occurrence_count: 3, sample_values: [] },
        { field_path: '$.seldom', field_type: 'string', occurrence_count: 2, sample_values: [] },
        { field_path: '$.once', field_type: 'string', occurrence_count: 1, sample_values: [] },
      ],
    }

    it('10/10 is not rare', () => {
      expect(isRareUnionField(fieldAt(tenEventSchema, '$.always'), tenEventSchema)).toBe(false)
    })

    it('8/10 is not rare', () => {
      expect(isRareUnionField(fieldAt(tenEventSchema, '$.often'), tenEventSchema)).toBe(false)
    })

    it('3/10 is not rare', () => {
      expect(isRareUnionField(fieldAt(tenEventSchema, '$.sometimes'), tenEventSchema)).toBe(false)
    })

    it('2/10 is rare', () => {
      expect(isRareUnionField(fieldAt(tenEventSchema, '$.seldom'), tenEventSchema)).toBe(true)
    })

    it('1/10 is rare', () => {
      expect(isRareUnionField(fieldAt(tenEventSchema, '$.once'), tenEventSchema)).toBe(true)
    })

    it('returns false when total_events is zero', () => {
      const schema: UnionSchema = {
        total_events: 0,
        fields: [{ field_path: '$.id', field_type: 'string', occurrence_count: 0, sample_values: [] }],
      }
      expect(isRareUnionField(fieldAt(schema, '$.id'), schema)).toBe(false)
    })

    it('returns false when occurrence_count is missing', () => {
      const schema: UnionSchema = {
        total_events: 10,
        fields: [{ field_path: '$.id', field_type: 'string', occurrence_count: undefined as unknown as number, sample_values: [] }],
      }
      expect(isRareUnionField(fieldAt(schema, '$.id'), schema)).toBe(false)
    })
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
