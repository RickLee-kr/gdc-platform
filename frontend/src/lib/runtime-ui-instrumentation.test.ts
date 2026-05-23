import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getRuntimeUiMetrics,
  isRuntimeUiInstrumentationEnabled,
  recordRuntimeSectionRender,
  recordSnapshotRefreshRerender,
  recordVirtualWindow,
} from './runtime-ui-instrumentation'

describe('runtime-ui-instrumentation', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('PROD', false)
    localStorage.removeItem('GDC_RUNTIME_UI_DEBUG')
    vi.spyOn(console, 'debug').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    localStorage.removeItem('GDC_RUNTIME_UI_DEBUG')
  })

  it('is disabled in production builds', () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('PROD', true)
    expect(isRuntimeUiInstrumentationEnabled()).toBe(false)
    recordRuntimeSectionRender('StreamFlowGrid')
    expect(console.debug).not.toHaveBeenCalled()
  })

  it('logs in development when debug gate is enabled', () => {
    localStorage.setItem('GDC_RUNTIME_UI_DEBUG', '1')
    expect(isRuntimeUiInstrumentationEnabled()).toBe(true)
    recordRuntimeSectionRender('StreamFlowGrid')
    expect(console.debug).toHaveBeenCalled()
  })

  it('does not log in development unless debug gate is enabled', () => {
    expect(isRuntimeUiInstrumentationEnabled()).toBe(false)
    recordRuntimeSectionRender('StreamFlowGrid')
    expect(console.debug).not.toHaveBeenCalled()
  })

  it('records virtual window metrics without console noise by default', () => {
    recordVirtualWindow(2, 8, 12)
    recordSnapshotRefreshRerender([1, 2, 3])
    expect(getRuntimeUiMetrics().mountedCards).toBe(12)
    expect(getRuntimeUiMetrics().virtualWindowStart).toBe(2)
    expect(console.debug).not.toHaveBeenCalled()
  })
})
