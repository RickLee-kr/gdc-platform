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

  it('treats equivalent UTC snapshot timestamp formats as matching', () => {
    expect(snapshotMatches('2026-05-17T12:00:00Z', { snapshot_id: '2026-05-17T12:00:00.000+00:00' })).toBe(
      true,
    )
    expect(snapshotMatches('2026-05-17T12:00:00+00:00', { time: { snapshot_id: '2026-05-17T12:00:00Z' } })).toBe(
      true,
    )
    expect(snapshotMatches('2026-05-17T12:00:00.001Z', { snapshot_id: '2026-05-17T12:00:00Z' })).toBe(false)
  })

  it('normalizes snapshot metadata timestamps before consistency checks', () => {
    expect(
      allSnapshotsMatch('2026-05-17T12:00:00Z', [
        {
          snapshot_id: '2026-05-17T12:00:00Z',
          generated_at: '2026-05-17T12:00:00Z',
          window_start: '2026-05-17T11:00:00Z',
          window_end: '2026-05-17T12:00:00Z',
        },
        {
          time: {
            snapshot_id: '2026-05-17T12:00:00.000+00:00',
            generated_at: '2026-05-17T12:00:00.000+00:00',
            since: '2026-05-17T11:00:00.000+00:00',
            until: '2026-05-17T12:00:00.000+00:00',
          },
        },
      ]),
    ).toBe(true)
    expect(
      allSnapshotsMatch('2026-05-17T12:00:00Z', [
        {
          snapshot_id: '2026-05-17T12:00:00Z',
          generated_at: '2026-05-17T12:00:00Z',
          window_start: '2026-05-17T11:00:00Z',
          window_end: '2026-05-17T12:00:00Z',
        },
        {
          time: {
            snapshot_id: '2026-05-17T12:00:00.000+00:00',
            generated_at: '2026-05-17T12:00:01.000+00:00',
            since: '2026-05-17T11:00:00.000+00:00',
            until: '2026-05-17T12:00:00.000+00:00',
          },
        },
      ]),
    ).toBe(false)
  })
})

