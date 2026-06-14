import type { StreamsSectionKpi } from '../../api/streamsKpi'
import type { StreamConsoleRow } from '../../api/streamRows'
import type { StreamWorkflowInput } from '../../utils/streamWorkflow'

export type StreamsConsoleSnapshot = {
  displayRows: StreamConsoleRow[]
  workflowExtrasByStreamId: Record<string, Partial<StreamWorkflowInput>>
  sectionKpi: StreamsSectionKpi
  updatedAt: number
}

let lastSnapshot: StreamsConsoleSnapshot | null = null

export function readStreamsConsoleSnapshot(): StreamsConsoleSnapshot | null {
  return lastSnapshot
}

export function writeStreamsConsoleSnapshot(snapshot: Omit<StreamsConsoleSnapshot, 'updatedAt'>): void {
  if (snapshot.displayRows.length === 0) return
  lastSnapshot = { ...snapshot, updatedAt: Date.now() }
}

export function clearStreamsConsoleSnapshot(): void {
  lastSnapshot = null
}
