import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDeferredMount } from './use-deferred-mount'

describe('useDeferredMount', () => {
  beforeEach(() => {
    vi.stubEnv('MODE', 'development')
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it('does not mount immediately when delay is configured', () => {
    const { result } = renderHook(() => useDeferredMount(48))
    expect(result.current).toBe(false)
  })

  it('mounts after the configured delay and cleans up on unmount', () => {
    const { result, unmount } = renderHook(() => useDeferredMount(48))
    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(48)
    })
    expect(result.current).toBe(true)

    unmount()
    expect(() => act(() => vi.runOnlyPendingTimers())).not.toThrow()
  })

  it('mounts immediately when delay is zero', () => {
    vi.stubEnv('MODE', 'development')
    const { result } = renderHook(() => useDeferredMount(0))
    expect(result.current).toBe(true)
  })
})
