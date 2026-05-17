import { describe, expect, it } from 'vitest'
import { allSnapshotsMatch, responseSnapshotId, snapshotMatches } from './runtimeSnapshotSync'

describe('runtime snapshot synchronization helpers', () => {
  it('reads top-level and nested snapshot ids', () => {
    expect(responseSnapshotId({ snapshot_id: 's1' })).toBe('s1')
    expect(responseSnapshotId({ time: { snapshot_id: 's2' } })).toBe('s2')
    expect(responseSnapshotId({})).toBeNull()
  })

  it('detects mismatched snapshot responses', () => {
    expect(snapshotMatches('s1', { snapshot_id: 's1' })).toBe(true)
    expect(snapshotMatches('s1', { time: { snapshot_id: 's1' } })).toBe(true)
    expect(snapshotMatches('s1', {})).toBe(false)
    expect(snapshotMatches('s1', null)).toBe(false)
    expect(snapshotMatches('s1', { snapshot_id: 's2' })).toBe(false)
    expect(allSnapshotsMatch('s1', [{ snapshot_id: 's1' }, { time: { snapshot_id: 's1' } }])).toBe(true)
    expect(allSnapshotsMatch('s1', [{ snapshot_id: 's1' }, null])).toBe(false)
    expect(allSnapshotsMatch('s1', [{ snapshot_id: 's1' }, { time: { snapshot_id: 's2' } }])).toBe(false)
  })
})

