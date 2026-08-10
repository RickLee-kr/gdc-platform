import type { OperationalRouteSnapshot } from '../api/operationalSnapshot'

/**
 * Build per-stream destination labels from Runtime Snapshot routes.
 * Dedupes by label string and sorts for stable UI/search.
 *
 * Includes disabled routes (catalog path did not filter enabled).
 * Missing destination_name falls back to Destination #<id>.
 */
export function destinationLabelsByStreamIdFromSnapshot(
  routes: readonly OperationalRouteSnapshot[] | null | undefined,
): Map<number, string[]> {
  const byStream = new Map<number, Set<string>>()
  for (const route of routes ?? []) {
    const sid = Number(route.stream_id)
    if (!Number.isFinite(sid)) continue
    const destName = (route.destination_name ?? '').trim()
    const label =
      destName ||
      (route.destination_id != null && Number.isFinite(Number(route.destination_id))
        ? `Destination #${Number(route.destination_id)}`
        : '')
    if (!label) continue
    const names = byStream.get(sid) ?? new Set<string>()
    names.add(label)
    byStream.set(sid, names)
  }
  const out = new Map<number, string[]>()
  for (const [sid, names] of byStream) {
    out.set(sid, [...names].sort((a, b) => a.localeCompare(b)))
  }
  return out
}
