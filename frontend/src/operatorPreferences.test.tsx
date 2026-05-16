import { beforeEach, describe, expect, it } from 'vitest'
import {
  loadDashboardRefreshMs,
  loadLogsAutoRefresh,
  loadPersistedEntityIds,
  loadRuntimeRefreshEvery,
  loadStreamRuntimeMetricsAutoRefresh,
  loadStreamsAutoRefresh,
  persistDashboardRefreshMs,
  persistEntityIds,
  persistLogsAutoRefresh,
  persistRuntimeRefreshEvery,
  persistStreamRuntimeMetricsAutoRefresh,
  persistStreamsAutoRefresh,
  STORAGE_KEYS,
} from './localPreferences'

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

  it('auto refresh 기본값은 Off/false이다', () => {
    expect(loadStreamsAutoRefresh()).toBe('Off')
    expect(loadRuntimeRefreshEvery()).toBe('off')
    expect(loadDashboardRefreshMs()).toBeNull()
    expect(loadLogsAutoRefresh()).toBe(false)
    expect(loadStreamRuntimeMetricsAutoRefresh()).toBe(false)
  })

  it('저장된 auto refresh 설정을 복원한다', () => {
    persistStreamsAutoRefresh('30s')
    persistRuntimeRefreshEvery('1m')
    persistDashboardRefreshMs(60_000)
    persistLogsAutoRefresh(true)
    persistStreamRuntimeMetricsAutoRefresh(true)
    expect(loadStreamsAutoRefresh()).toBe('30s')
    expect(loadRuntimeRefreshEvery()).toBe('1m')
    expect(loadDashboardRefreshMs()).toBe(60_000)
    expect(loadLogsAutoRefresh()).toBe(true)
    expect(loadStreamRuntimeMetricsAutoRefresh()).toBe(true)
  })

  it('explicit 플래그 없이 저장된 interval 키는 무시하고 Off로 둔다', () => {
    localStorage.setItem(STORAGE_KEYS.autoRefreshStreams, '5s')
    localStorage.setItem(STORAGE_KEYS.autoRefreshRuntime, '10s')
    localStorage.setItem(STORAGE_KEYS.autoRefreshDashboard, '30000')
    expect(loadStreamsAutoRefresh()).toBe('Off')
    expect(loadRuntimeRefreshEvery()).toBe('off')
    expect(loadDashboardRefreshMs()).toBeNull()
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
