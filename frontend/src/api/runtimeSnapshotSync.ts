type SnapshotTimeBlock = {
  snapshot_id?: string | null
}

export type SnapshotAwareResponse = {
  snapshot_id?: string | null
  time?: SnapshotTimeBlock | null
}

export function createRuntimeSnapshotId(): string {
  return new Date().toISOString()
}

export function responseSnapshotId(value: SnapshotAwareResponse | null | undefined): string | null {
  const direct = value?.snapshot_id
  if (typeof direct === 'string' && direct.trim() !== '') return direct.trim()
  const nested = value?.time?.snapshot_id
  if (typeof nested === 'string' && nested.trim() !== '') return nested.trim()
  return null
}

export function snapshotMatches(expectedSnapshotId: string, value: SnapshotAwareResponse | null | undefined): boolean {
  const actual = responseSnapshotId(value)
  return actual === expectedSnapshotId
}

export function allSnapshotsMatch(
  expectedSnapshotId: string,
  values: Array<SnapshotAwareResponse | null | undefined>,
): boolean {
  return values.every((value) => snapshotMatches(expectedSnapshotId, value))
}

