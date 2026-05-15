import { STORAGE_KEYS, type DisplayDensity } from '../localPreferences'
import type { AppSection, TabKey } from '../runtimeTypes'
import type { PersistedIds } from './runtimeState'

const TAB_ORDER: TabKey[] = ['connector', 'source', 'stream', 'mapping', 'route', 'destination']

function hasLocalStorageValue(key: string): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    const v = localStorage.getItem(key)
    return typeof v === 'string' && v.trim().length > 0
  } catch {
    return false
  }
}

export type WorkspaceRestoreStatus = {
  idsRestored: boolean
  densityRestored: boolean
  apiOverrideRestored: boolean
  note: string
}

export function detectWorkspaceRestoreStatus(): WorkspaceRestoreStatus {
  const idsRestored = hasLocalStorageValue(STORAGE_KEYS.entityIds)
  const densityRestored = hasLocalStorageValue(STORAGE_KEYS.displayDensity)
  const apiOverrideRestored = hasLocalStorageValue(STORAGE_KEYS.apiBaseUrlOverride)
  const note = `ids=${idsRestored ? 'loaded' : 'default'} · density=${densityRestored ? 'loaded' : 'default'} · api_override=${apiOverrideRestored ? 'loaded' : 'default'}`
  return { idsRestored, densityRestored, apiOverrideRestored, note }
}

export function firstUnsavedRuntimeTab(unsavedByTab: Record<TabKey, string[]>): TabKey | null {
  for (const tab of TAB_ORDER) {
    if (unsavedByTab[tab].length > 0) return tab
  }
  return null
}

export function summarizeUnsavedTabs(unsavedByTab: Record<TabKey, string[]>): { count: number; lines: string[] } {
  const lines: string[] = []
  for (const tab of TAB_ORDER) {
    if (unsavedByTab[tab].length > 0) {
      lines.push(`${tab}: ${unsavedByTab[tab].join(', ')}`)
    }
  }
  return { count: lines.length, lines }
}

export type WorkspaceSummaryModel = {
  idsLine: string
  apiBaseUrl: string
  density: DisplayDensity
  activeSection: AppSection
  activeTab: TabKey
  lastSuccess: string
  lastError: string
  unsavedCount: number
  unsavedLines: string[]
}

export function buildWorkspaceSummaryModel(params: {
  ids: PersistedIds
  apiBaseUrl: string
  density: DisplayDensity
  activeSection: AppSection
  activeTab: TabKey
  lastSuccess: string
  lastError: string
  unsavedByTab: Record<TabKey, string[]>
}): WorkspaceSummaryModel {
  const v = (s: string) => s.trim() || '—'
  const unsaved = summarizeUnsavedTabs(params.unsavedByTab)
  return {
    idsLine: `connector=${v(params.ids.connectorId)} · source=${v(params.ids.sourceId)} · stream=${v(params.ids.streamId)} · route=${v(params.ids.routeId)} · destination=${v(params.ids.destinationId)}`,
    apiBaseUrl: params.apiBaseUrl,
    density: params.density,
    activeSection: params.activeSection,
    activeTab: params.activeTab,
    lastSuccess: params.lastSuccess || '아직 없음',
    lastError: params.lastError || '아직 없음',
    unsavedCount: unsaved.count,
    unsavedLines: unsaved.lines,
  }
}
