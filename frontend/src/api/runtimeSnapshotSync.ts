type SnapshotTimeBlock = {
  snapshot_id?: string | null
  generated_at?: string | null
  since?: string | null
  until?: string | null
  window_start?: string | null
  window_end?: string | null
}

export type SnapshotAwareResponse = {
  snapshot_id?: string | null
  generated_at?: string | null
  window_start?: string | null
  window_end?: string | null
  time?: SnapshotTimeBlock | null
}

export function createRuntimeSnapshotId(): string {
  return new Date().toISOString()
}

/** Aligns snapshot_id with catalog/runtime read cache TTL (15s) within a refresh cycle. */
const REFRESH_CYCLE_SNAPSHOT_TTL_MS = 15_000
let refreshCycleSnapshot: { id: string; createdAt: number } | null = null

export function createRefreshCycleSnapshotId(): string {
  const now = Date.now()
  if (
    refreshCycleSnapshot != null &&
    now - refreshCycleSnapshot.createdAt < REFRESH_CYCLE_SNAPSHOT_TTL_MS
  ) {
    return refreshCycleSnapshot.id
  }
  const id = createRuntimeSnapshotId()
  refreshCycleSnapshot = { id, createdAt: now }
  return id
}

/** Forces the next refresh cycle to allocate a new snapshot_id (e.g. after mutations). */
export function resetRefreshCycleSnapshotId(): void {
  refreshCycleSnapshot = null
}

/** @deprecated Prefer {@link resetRefreshCycleSnapshotId} */
export function resetRefreshCycleSnapshotIdForTests(): void {
  resetRefreshCycleSnapshotId()
}

export function responseSnapshotId(value: SnapshotAwareResponse | null | undefined): string | null {
  const direct = value?.snapshot_id
  if (typeof direct === 'string' && direct.trim() !== '') return direct.trim()
  const nested = value?.time?.snapshot_id
  if (typeof nested === 'string' && nested.trim() !== '') return nested.trim()
  return null
}

function canonicalSnapshotToken(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const epochMs = Date.parse(trimmed)
  if (Number.isFinite(epochMs)) return `epoch:${epochMs}`
  return `raw:${trimmed}`
}

function timestampsMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = canonicalSnapshotToken(left)
  const b = canonicalSnapshotToken(right)
  return a != null && b != null && a === b
}

type SnapshotMetadataKey = 'generated_at' | 'window_start' | 'window_end'

function responseTimestamp(value: SnapshotAwareResponse | null | undefined, key: SnapshotMetadataKey): string | null {
  const direct = value?.[key]
  if (typeof direct === 'string' && direct.trim() !== '') return direct.trim()
  if (key === 'window_start') {
    const nestedStart = value?.time?.window_start ?? value?.time?.since
    return typeof nestedStart === 'string' && nestedStart.trim() !== '' ? nestedStart.trim() : null
  }
  if (key === 'window_end') {
    const nestedEnd = value?.time?.window_end ?? value?.time?.until
    return typeof nestedEnd === 'string' && nestedEnd.trim() !== '' ? nestedEnd.trim() : null
  }
  const nested = value?.time?.generated_at
  return typeof nested === 'string' && nested.trim() !== '' ? nested.trim() : null
}

function metadataInstantsAlign(values: Array<SnapshotAwareResponse | null | undefined>): boolean {
  const keys: SnapshotMetadataKey[] = ['generated_at', 'window_start', 'window_end']
  return keys.every((key) => {
    const observed = values.map((value) => responseTimestamp(value, key)).filter((value): value is string => value != null)
    if (observed.length <= 1) return true
    const expected = observed[0]
    return observed.every((value) => timestampsMatch(expected, value))
  })
}

export function snapshotMatches(expectedSnapshotId: string, value: SnapshotAwareResponse | null | undefined): boolean {
  const actual = responseSnapshotId(value)
  return timestampsMatch(actual, expectedSnapshotId)
}

export function allSnapshotsMatch(
  expectedSnapshotId: string,
  values: Array<SnapshotAwareResponse | null | undefined>,
): boolean {
  return values.every((value) => snapshotMatches(expectedSnapshotId, value)) && metadataInstantsAlign(values)
}

