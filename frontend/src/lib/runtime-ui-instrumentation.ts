const DEBUG_KEY = 'GDC_RUNTIME_UI_DEBUG'

type RuntimeUiMetrics = {
  renderCount: number
  mountedCards: number
  virtualWindowStart: number
  virtualWindowEnd: number
  lastRefreshAt: string | null
}

const metrics: RuntimeUiMetrics = {
  renderCount: 0,
  mountedCards: 0,
  virtualWindowStart: 0,
  virtualWindowEnd: 0,
  lastRefreshAt: null,
}

function readDebugFlag(): boolean {
  try {
    return globalThis.localStorage?.getItem(DEBUG_KEY) === '1'
  } catch {
    return false
  }
}

export function isRuntimeUiInstrumentationEnabled(): boolean {
  return import.meta.env.DEV && readDebugFlag()
}

export function recordRuntimeSectionRender(section: string): void {
  if (!isRuntimeUiInstrumentationEnabled()) return
  metrics.renderCount += 1
  console.debug('[runtime-ui]', section, { renderCount: metrics.renderCount })
}

export function recordVirtualWindow(start: number, end: number, mounted: number): void {
  if (!import.meta.env.DEV) return
  metrics.virtualWindowStart = start
  metrics.virtualWindowEnd = end
  metrics.mountedCards = mounted
}

export function recordSnapshotRefreshRerender(changedStreamIds: number[]): void {
  if (!isRuntimeUiInstrumentationEnabled()) return
  metrics.lastRefreshAt = new Date().toISOString()
  console.debug('[runtime-ui] snapshot refresh', {
    changedStreams: changedStreamIds.length,
    changedStreamIds: changedStreamIds.slice(0, 12),
  })
}

export function getRuntimeUiMetrics(): Readonly<RuntimeUiMetrics> {
  return metrics
}
