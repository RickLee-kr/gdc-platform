import { renderHook, waitFor, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { OperationalSnapshotResponse } from '../../api/operationalSnapshot'
import { RuntimeOperationalProvider, useRuntimeOperational } from './runtime-operational-provider'

const snapshot: OperationalSnapshotResponse = {
  global: {
    health_status: 'HEALTHY',
    total_streams: 1,
    enabled_streams: 1,
    running_streams: 1,
    error_streams: 0,
    total_routes: 0,
    enabled_routes: 0,
    total_destinations: 0,
    enabled_destinations: 0,
    total_eps_1m: 1,
    total_eps_5m: 1,
    avg_latency_ms: 5,
    last_activity_at: '2026-05-22T12:00:00Z',
  },
  streams: [],
  routes: [],
  destinations: [],
  problems: [],
  updated_at: '2026-05-22T12:00:00Z',
}

vi.mock('../../api/operationalSnapshot', () => ({
  clearOperationalSnapshotCache: vi.fn(),
  getOperationalSnapshot: vi.fn(),
}))

vi.mock('../../hooks/use-document-visible', () => ({
  useDocumentVisible: vi.fn(() => true),
}))

function wrapper({ children }: { children: ReactNode }) {
  return <RuntimeOperationalProvider>{children}</RuntimeOperationalProvider>
}

describe('RuntimeOperationalProvider', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../../api/operationalSnapshot')
    vi.mocked(mod.getOperationalSnapshot).mockReset()
    vi.mocked(mod.getOperationalSnapshot).mockResolvedValue(snapshot)
  })

  it('loads snapshot once and exposes updated_at', async () => {
    const mod = await import('../../api/operationalSnapshot')
    const { result } = renderHook(() => useRuntimeOperational(), { wrapper })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mod.getOperationalSnapshot).toHaveBeenCalledTimes(1)
    expect(result.current.snapshot?.updated_at).toBe('2026-05-22T12:00:00Z')
    expect(result.current.lastUpdatedAt).toBe('2026-05-22T12:00:00Z')
  })

  it('refresh clears cache and re-fetches snapshot', async () => {
    const mod = await import('../../api/operationalSnapshot')
    const { result } = renderHook(() => useRuntimeOperational(), { wrapper })

    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      result.current.refresh()
    })
    await waitFor(() => expect(mod.getOperationalSnapshot).toHaveBeenCalledTimes(2))
    expect(mod.clearOperationalSnapshotCache).toHaveBeenCalled()
  })

  it('does not run parallel snapshot fetches when refresh overlaps in-flight load', async () => {
    const mod = await import('../../api/operationalSnapshot')
    let concurrent = 0
    let maxConcurrent = 0
    vi.mocked(mod.getOperationalSnapshot).mockImplementation(async () => {
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise((r) => setTimeout(r, 40))
      concurrent -= 1
      return snapshot
    })

    const { result } = renderHook(() => useRuntimeOperational(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.refresh()
      result.current.refresh()
    })
    await waitFor(() => expect(mod.getOperationalSnapshot.mock.calls.length).toBeGreaterThanOrEqual(2))
    await waitFor(() => expect(result.current.snapshot?.updated_at).toBe('2026-05-22T12:00:00Z'))

    expect(maxConcurrent).toBe(1)
    expect(mod.getOperationalSnapshot.mock.calls.length).toBeLessThanOrEqual(3)
  })

  it('surfaces error when snapshot is null', async () => {
    const mod = await import('../../api/operationalSnapshot')
    vi.mocked(mod.getOperationalSnapshot).mockReset()
    vi.mocked(mod.getOperationalSnapshot).mockResolvedValue(null)
    const { result } = renderHook(() => useRuntimeOperational(), { wrapper })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toMatch(/operational snapshot/i)
    expect(result.current.snapshot).toBeNull()
  })
})
