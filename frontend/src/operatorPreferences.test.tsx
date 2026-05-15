import { beforeEach, describe, expect, it } from 'vitest'
import { loadPersistedEntityIds, persistEntityIds, STORAGE_KEYS } from './localPreferences'

describe('로컬 ID 설정 지속성', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('저장된 ID를 loadPersistedEntityIds로 복원한다', () => {
    localStorage.setItem(
      STORAGE_KEYS.entityIds,
      JSON.stringify({
        connectorId: 'c-1',
        sourceId: 's-1',
        streamId: 'st-1',
        routeId: 'r-1',
        destinationId: 'd-1',
      }),
    )
    const ids = loadPersistedEntityIds()
    expect(ids.connectorId).toBe('c-1')
    expect(ids.streamId).toBe('st-1')
  })

  it('persistEntityIds가 localStorage에 반영된다', () => {
    persistEntityIds({
      connectorId: '',
      sourceId: '',
      streamId: 'stream-99',
      routeId: '',
      destinationId: '',
    })
    const raw = localStorage.getItem(STORAGE_KEYS.entityIds)
    expect(raw).toBeTruthy()
    expect(raw).toContain('stream-99')
  })
})
