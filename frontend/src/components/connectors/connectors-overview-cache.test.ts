import { describe, expect, it } from 'vitest'
import {
  clearConnectorsOverviewSnapshot,
  readConnectorsOverviewSnapshot,
  writeConnectorsOverviewSnapshot,
} from './connectors-overview-cache'

describe('connectors overview session cache', () => {
  it('returns null when empty and retains rows across writes', () => {
    clearConnectorsOverviewSnapshot()
    expect(readConnectorsOverviewSnapshot()).toBeNull()

    writeConnectorsOverviewSnapshot({
      baseRows: [{ id: 1, name: 'A' } as never],
      opsRows: [],
      operationsBacked: false,
    })
    expect(readConnectorsOverviewSnapshot()?.baseRows).toHaveLength(1)
    clearConnectorsOverviewSnapshot()
    expect(readConnectorsOverviewSnapshot()).toBeNull()
  })
})
