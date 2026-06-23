import { describe, expect, it } from 'vitest'
import {
  clearDestinationsListSnapshot,
  readDestinationsListSnapshot,
  writeDestinationsListSnapshot,
} from './destinations-list-cache'

describe('destinations list session cache', () => {
  it('skips empty writes and clears snapshot', () => {
    clearDestinationsListSnapshot()
    writeDestinationsListSnapshot([])
    expect(readDestinationsListSnapshot()).toBeNull()

    writeDestinationsListSnapshot([{ id: 2, name: 'Dest' } as never])
    expect(readDestinationsListSnapshot()).toHaveLength(1)
    clearDestinationsListSnapshot()
    expect(readDestinationsListSnapshot()).toBeNull()
  })
})
