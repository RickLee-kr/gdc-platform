import { describe, expect, it } from 'vitest'
import { COMMON_DEST_FIELDS, loadRecentDestinations } from './destination-field-chip'

describe('destination-field-chip helpers', () => {
  it('exposes curated common destination fields', () => {
    expect(COMMON_DEST_FIELDS).toContain('event_name')
    expect(COMMON_DEST_FIELDS).toContain('src_ip')
    expect(COMMON_DEST_FIELDS.length).toBeGreaterThan(10)
  })

  it('loadRecentDestinations returns an array', () => {
    expect(Array.isArray(loadRecentDestinations())).toBe(true)
  })
})
