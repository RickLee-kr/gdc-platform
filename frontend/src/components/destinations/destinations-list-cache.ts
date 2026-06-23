import type { DestinationListItem } from '../../api/gdcDestinations'

let lastRows: DestinationListItem[] | null = null

export function readDestinationsListSnapshot(): DestinationListItem[] | null {
  return lastRows
}

export function writeDestinationsListSnapshot(rows: DestinationListItem[]): void {
  if (rows.length === 0) return
  lastRows = rows
}

export function clearDestinationsListSnapshot(): void {
  lastRows = null
}
