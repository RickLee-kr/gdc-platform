import type { TabKey } from '../runtimeTypes'
import type { PersistedIds } from './runtimeState'
import { RUNTIME_MESSAGES } from './runtimeMessages'

export type ReadinessRowKey =
  | 'connector'
  | 'source'
  | 'stream'
  | 'mapping'
  | 'route'
  | 'destination'
  | 'previewGate'
  | 'runtimeGate'

export type ReadinessRow = {
  key: ReadinessRowKey
  label: string
  ok: boolean
}

function dirty(tab: TabKey, unsavedByTab: Record<TabKey, string[]>): boolean {
  return unsavedByTab[tab].length > 0
}

/** Toolbar + Runtime Config dirty signals → compact operator readiness lines. */
export function buildRuntimeReadinessSummary(
  ids: PersistedIds,
  unsavedByTab: Record<TabKey, string[]>,
): {
  rows: ReadinessRow[]
  previewPrerequisites: string[]
  readyForPreview: boolean
  readyForRuntimeStart: boolean
} {
  const connectorOk = Boolean(ids.connectorId.trim()) && !dirty('connector', unsavedByTab)
  const sourceOk = Boolean(ids.sourceId.trim()) && !dirty('source', unsavedByTab)
  const streamOk = Boolean(ids.streamId.trim()) && !dirty('stream', unsavedByTab)
  const mappingOk = Boolean(ids.streamId.trim()) && !dirty('mapping', unsavedByTab)
  const routeOk = Boolean(ids.routeId.trim()) && !dirty('route', unsavedByTab)
  const destinationOk = Boolean(ids.destinationId.trim()) && !dirty('destination', unsavedByTab)

  const previewPrerequisites: string[] = []
  if (!ids.streamId.trim()) {
    previewPrerequisites.push(RUNTIME_MESSAGES.runtimeReadinessNeedStreamForPipeline)
  }
  if (!ids.routeId.trim()) {
    previewPrerequisites.push(RUNTIME_MESSAGES.runtimeReadinessNeedRouteForRoutePreview)
  }
  if (dirty('mapping', unsavedByTab)) {
    previewPrerequisites.push(RUNTIME_MESSAGES.runtimeReadinessMappingDirty)
  }

  const entityPipelineOk = connectorOk && sourceOk && streamOk && mappingOk && routeOk && destinationOk
  const readyForPreview = entityPipelineOk
  const readyForRuntimeStart = entityPipelineOk && Boolean(ids.streamId.trim())

  const rows: ReadinessRow[] = [
    { key: 'connector', label: RUNTIME_MESSAGES.readinessConnectorSelected, ok: connectorOk },
    { key: 'source', label: RUNTIME_MESSAGES.readinessSourceConfigured, ok: sourceOk },
    { key: 'stream', label: RUNTIME_MESSAGES.readinessStreamConfigured, ok: streamOk },
    { key: 'mapping', label: RUNTIME_MESSAGES.readinessMappingReady, ok: mappingOk },
    { key: 'route', label: RUNTIME_MESSAGES.readinessRouteReady, ok: routeOk },
    { key: 'destination', label: RUNTIME_MESSAGES.readinessDestinationReady, ok: destinationOk },
    { key: 'previewGate', label: RUNTIME_MESSAGES.readinessReadyForPreview, ok: readyForPreview },
    { key: 'runtimeGate', label: RUNTIME_MESSAGES.readinessReadyForRuntimeStart, ok: readyForRuntimeStart },
  ]

  return { rows, previewPrerequisites, readyForPreview, readyForRuntimeStart }
}
