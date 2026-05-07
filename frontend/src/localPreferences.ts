/** Browser localStorage keys for operator UI preferences only (no secrets). */

export const STORAGE_KEYS = {
  entityIds: 'gdc.entityIds',
  displayDensity: 'gdc.displayDensity',
  apiBaseUrlOverride: 'gdc.apiBaseUrlOverride',
} as const

export type DisplayDensity = 'comfortable' | 'compact'

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
