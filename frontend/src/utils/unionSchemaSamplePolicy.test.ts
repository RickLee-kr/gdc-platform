import { describe, expect, it } from 'vitest'
import {
  getUnionSchemaSampleStatus,
  UNION_SCHEMA_SAMPLE_NEEDS_ATTENTION_MESSAGE,
  UNION_SCHEMA_SAMPLE_WARNING_MESSAGE,
} from './unionSchemaSamplePolicy'

describe('getUnionSchemaSampleStatus', () => {
  it.each([
    [0, 'needs_attention'],
    [1, 'needs_attention'],
    [9, 'needs_attention'],
  ])('sample_count %i → needs_attention', (count, status) => {
    const policy = getUnionSchemaSampleStatus(count)
    expect(policy.status).toBe(status)
    expect(policy.message).toBe(UNION_SCHEMA_SAMPLE_NEEDS_ATTENTION_MESSAGE)
  })

  it.each([
    [10, 'warning'],
    [19, 'warning'],
  ])('sample_count %i → warning', (count, status) => {
    const policy = getUnionSchemaSampleStatus(count)
    expect(policy.status).toBe(status)
    expect(policy.message).toBe(UNION_SCHEMA_SAMPLE_WARNING_MESSAGE)
  })

  it.each([
    [20, 'ready'],
    [30, 'ready'],
  ])('sample_count %i → ready', (count, status) => {
    const policy = getUnionSchemaSampleStatus(count)
    expect(policy.status).toBe(status)
    expect(policy.message).toBeNull()
  })
})
