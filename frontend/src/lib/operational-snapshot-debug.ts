/** DEV-only instrumentation for operational snapshot refresh (no production console noise). */

type SnapshotDebugState = {
  refreshCount: number
  suppressedDuplicateCount: number
  lastUpdatedAt: string | null
  lastReason: string | null
  hiddenPaused: boolean
}

const state: SnapshotDebugState = {
  refreshCount: 0,
  suppressedDuplicateCount: 0,
  lastUpdatedAt: null,
  lastReason: null,
  hiddenPaused: false,
}

function devEnabled(): boolean {
  return import.meta.env.DEV
}

export function logOperationalSnapshotRefresh(reason: string, updatedAt?: string | null): void {
  if (!devEnabled()) return
  state.refreshCount += 1
  state.lastReason = reason
  if (updatedAt != null) state.lastUpdatedAt = updatedAt
  console.info('[observability] operational snapshot refresh', {
    reason,
    refresh_count: state.refreshCount,
    updated_at: state.lastUpdatedAt,
  })
}

export function logOperationalSnapshotRefreshSuppressed(reason: string): void {
  if (!devEnabled()) return
  state.suppressedDuplicateCount += 1
  console.info('[observability] operational snapshot refresh suppressed', {
    reason,
    suppressed_count: state.suppressedDuplicateCount,
  })
}

export function logOperationalSnapshotVisibility(hidden: boolean): void {
  if (!devEnabled()) return
  state.hiddenPaused = hidden
  console.info('[observability] operational snapshot visibility', {
    hidden,
    polling_paused: hidden,
  })
}

export function getOperationalSnapshotDebugState(): Readonly<SnapshotDebugState> {
  return { ...state }
}

export function resetOperationalSnapshotDebugState(): void {
  state.refreshCount = 0
  state.suppressedDuplicateCount = 0
  state.lastUpdatedAt = null
  state.lastReason = null
  state.hiddenPaused = false
}
