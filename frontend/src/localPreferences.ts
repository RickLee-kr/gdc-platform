import { AUTO_REFRESH_OPTIONS } from './constants/streamConsoleFilters'

/** Browser localStorage keys for operator UI preferences only (no secrets). */

export const STORAGE_KEYS = {
  entityIds: 'gdc.entityIds',
  displayDensity: 'gdc.displayDensity',
  apiBaseUrlOverride: 'gdc.apiBaseUrlOverride',
  /** App shell light/dark (`dark` Tailwind class); operator preference only. */
  colorScheme: 'gdc.colorScheme',
  autoRefreshStreams: 'gdc.autoRefresh.streams',
  autoRefreshStreamsExplicit: 'gdc.autoRefresh.streams.explicit',
  autoRefreshRuntime: 'gdc.autoRefresh.runtime',
  autoRefreshRuntimeExplicit: 'gdc.autoRefresh.runtime.explicit',
  autoRefreshDashboard: 'gdc.autoRefresh.dashboard',
  autoRefreshDashboardExplicit: 'gdc.autoRefresh.dashboard.explicit',
  autoRefreshLogs: 'gdc.autoRefresh.logs',
  autoRefreshLogsExplicit: 'gdc.autoRefresh.logs.explicit',
  autoRefreshStreamRuntimeMetrics: 'gdc.autoRefresh.streamRuntimeMetrics',
  autoRefreshStreamRuntimeMetricsExplicit: 'gdc.autoRefresh.streamRuntimeMetrics.explicit',
  /** Bumped when auto-refresh preference semantics change (explicit opt-in required). */
  autoRefreshSchemaVersion: 'gdc.autoRefresh.schemaVersion',
} as const

const AUTO_REFRESH_SCHEMA_VERSION = '2'

export type StreamsAutoRefreshOption = (typeof AUTO_REFRESH_OPTIONS)[number]

export type RuntimeRefreshEvery = 'off' | '10s' | '30s' | '1m'

export type DisplayDensity = 'comfortable' | 'compact'

export type ColorScheme = 'light' | 'dark'

/** Persisted UI theme for the authenticated app shell (Tailwind `dark` class). Defaults to dark when unset (first login). */
export function loadColorScheme(): ColorScheme {
  const v = safeGetItem(STORAGE_KEYS.colorScheme)
  if (v === 'dark' || v === 'light') {
    return v
  }
  return 'dark'
}

export function persistColorScheme(scheme: ColorScheme): void {
  safeSetItem(STORAGE_KEYS.colorScheme, scheme)
}

export type PersistedEntityIds = {
  connectorId: string
  sourceId: string
  streamId: string
  routeId: string
  destinationId: string
}

function safeGetItem(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null
    }
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') {
      return
    }
    localStorage.setItem(key, value)
  } catch {
    /* ignore quota / private mode */
  }
}

function safeRemoveItem(key: string): void {
  try {
    if (typeof localStorage === 'undefined') {
      return
    }
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

function emptyEntityIds(): PersistedEntityIds {
  return {
    connectorId: '',
    sourceId: '',
    streamId: '',
    routeId: '',
    destinationId: '',
  }
}

export function loadPersistedEntityIds(): PersistedEntityIds {
  const raw = safeGetItem(STORAGE_KEYS.entityIds)
  if (!raw?.trim()) {
    return emptyEntityIds()
  }
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    return {
      connectorId: typeof o.connectorId === 'string' ? o.connectorId : '',
      sourceId: typeof o.sourceId === 'string' ? o.sourceId : '',
      streamId: typeof o.streamId === 'string' ? o.streamId : '',
      routeId: typeof o.routeId === 'string' ? o.routeId : '',
      destinationId: typeof o.destinationId === 'string' ? o.destinationId : '',
    }
  } catch {
    return emptyEntityIds()
  }
}

export function persistEntityIds(ids: PersistedEntityIds): void {
  safeSetItem(STORAGE_KEYS.entityIds, JSON.stringify(ids))
}

export function clearPersistedEntityIds(): void {
  safeRemoveItem(STORAGE_KEYS.entityIds)
}

export function loadDisplayDensity(): DisplayDensity {
  const v = safeGetItem(STORAGE_KEYS.displayDensity)
  if (v === 'compact' || v === 'comfortable') {
    return v
  }
  return 'comfortable'
}

export function persistDisplayDensity(density: DisplayDensity): void {
  safeSetItem(STORAGE_KEYS.displayDensity, density)
}

export function clearUiPreferenceKeys(): void {
  safeRemoveItem(STORAGE_KEYS.displayDensity)
}

function hasExplicitAutoRefresh(key: string): boolean {
  return safeGetItem(key) === '1'
}

function markExplicitAutoRefresh(key: string): void {
  safeSetItem(key, '1')
}

/**
 * One-time migration: legacy bundles never persisted explicit opt-in.
 * Orphan interval keys (if any) are ignored until the operator changes the control.
 */
export function migrateAutoRefreshPreferences(): void {
  if (safeGetItem(STORAGE_KEYS.autoRefreshSchemaVersion) === AUTO_REFRESH_SCHEMA_VERSION) {
    return
  }
  safeSetItem(STORAGE_KEYS.autoRefreshSchemaVersion, AUTO_REFRESH_SCHEMA_VERSION)
}

/** Streams console auto-refresh interval; default Off unless operator opted in. */
export function loadStreamsAutoRefresh(): StreamsAutoRefreshOption {
  if (!hasExplicitAutoRefresh(STORAGE_KEYS.autoRefreshStreamsExplicit)) {
    return 'Off'
  }
  const v = safeGetItem(STORAGE_KEYS.autoRefreshStreams)
  if (v && (AUTO_REFRESH_OPTIONS as readonly string[]).includes(v)) {
    return v as StreamsAutoRefreshOption
  }
  return 'Off'
}

export function persistStreamsAutoRefresh(value: StreamsAutoRefreshOption): void {
  markExplicitAutoRefresh(STORAGE_KEYS.autoRefreshStreamsExplicit)
  safeSetItem(STORAGE_KEYS.autoRefreshStreams, value)
}

/** Runtime overview refresh cadence; default off unless operator opted in. */
export function loadRuntimeRefreshEvery(): RuntimeRefreshEvery {
  if (!hasExplicitAutoRefresh(STORAGE_KEYS.autoRefreshRuntimeExplicit)) {
    return 'off'
  }
  const v = safeGetItem(STORAGE_KEYS.autoRefreshRuntime)
  if (v === 'off' || v === '10s' || v === '30s' || v === '1m') {
    return v
  }
  return 'off'
}

export function persistRuntimeRefreshEvery(value: RuntimeRefreshEvery): void {
  markExplicitAutoRefresh(STORAGE_KEYS.autoRefreshRuntimeExplicit)
  safeSetItem(STORAGE_KEYS.autoRefreshRuntime, value)
}

/** Dashboard auto-refresh interval in ms, or null when Off. */
export function loadDashboardRefreshMs(): number | null {
  if (!hasExplicitAutoRefresh(STORAGE_KEYS.autoRefreshDashboardExplicit)) {
    return null
  }
  const v = safeGetItem(STORAGE_KEYS.autoRefreshDashboard)
  if (v === 'off' || v == null || v.trim() === '') {
    return null
  }
  if (v === '30000') return 30_000
  if (v === '60000') return 60_000
  return null
}

export function persistDashboardRefreshMs(ms: number | null): void {
  markExplicitAutoRefresh(STORAGE_KEYS.autoRefreshDashboardExplicit)
  if (ms == null || ms <= 0) {
    safeSetItem(STORAGE_KEYS.autoRefreshDashboard, 'off')
    return
  }
  safeSetItem(STORAGE_KEYS.autoRefreshDashboard, String(ms))
}

/** Logs explorer auto-refresh toggle; default false unless operator opted in. */
export function loadLogsAutoRefresh(): boolean {
  if (!hasExplicitAutoRefresh(STORAGE_KEYS.autoRefreshLogsExplicit)) {
    return false
  }
  const v = safeGetItem(STORAGE_KEYS.autoRefreshLogs)
  if (v === '1' || v === 'true') return true
  if (v === '0' || v === 'false') return false
  return false
}

export function persistLogsAutoRefresh(enabled: boolean): void {
  markExplicitAutoRefresh(STORAGE_KEYS.autoRefreshLogsExplicit)
  safeSetItem(STORAGE_KEYS.autoRefreshLogs, enabled ? '1' : '0')
}

/** Stream runtime detail metrics polling; default false unless operator opted in. */
export function loadStreamRuntimeMetricsAutoRefresh(): boolean {
  if (!hasExplicitAutoRefresh(STORAGE_KEYS.autoRefreshStreamRuntimeMetricsExplicit)) {
    return false
  }
  const v = safeGetItem(STORAGE_KEYS.autoRefreshStreamRuntimeMetrics)
  if (v === '1' || v === 'true') return true
  if (v === '0' || v === 'false') return false
  return false
}

export function persistStreamRuntimeMetricsAutoRefresh(enabled: boolean): void {
  markExplicitAutoRefresh(STORAGE_KEYS.autoRefreshStreamRuntimeMetricsExplicit)
  safeSetItem(STORAGE_KEYS.autoRefreshStreamRuntimeMetrics, enabled ? '1' : '0')
}

/** Trimmed override URL or null if unset / empty. */
export function loadApiBaseUrlOverride(): string | null {
  const raw = safeGetItem(STORAGE_KEYS.apiBaseUrlOverride)
  if (raw === null) {
    return null
  }
  const t = raw.trim()
  return t.length > 0 ? t : null
}

export function persistApiBaseUrlOverride(url: string): void {
  const t = url.trim()
  if (t.length === 0) {
    clearApiBaseUrlOverride()
    return
  }
  safeSetItem(STORAGE_KEYS.apiBaseUrlOverride, t)
}

export function clearApiBaseUrlOverride(): void {
  safeRemoveItem(STORAGE_KEYS.apiBaseUrlOverride)
}

/**
 * Effective API origin for `fetch`: optional localStorage override, else Vite default base.
 */
export function getEffectiveApiBaseUrl(envDefaultBaseUrl: string): string {
  const o = loadApiBaseUrlOverride()
  return o !== null ? o : envDefaultBaseUrl
}
