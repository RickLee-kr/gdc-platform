import type { TabKey } from '../runtimeTypes'
import { TAB_LABELS } from '../runtimeTypes'
import type { PersistedIds } from './runtimeState'

export type ConnectorWizardStepKey =
  | 'connector'
  | 'source'
  | 'stream'
  | 'mapping'
  | 'route'
  | 'destination'
  | 'review'

export type WizardStepDefinition = {
  key: ConnectorWizardStepKey
  /** Runtime Config tab to deep-link; Review has no tab. */
  tabKey: TabKey | null
  label: string
}

export const CONNECTOR_WIZARD_STEP_ORDER: WizardStepDefinition[] = [
  { key: 'connector', tabKey: 'connector', label: TAB_LABELS.connector },
  { key: 'source', tabKey: 'source', label: TAB_LABELS.source },
  { key: 'stream', tabKey: 'stream', label: TAB_LABELS.stream },
  { key: 'mapping', tabKey: 'mapping', label: TAB_LABELS.mapping },
  { key: 'route', tabKey: 'route', label: TAB_LABELS.route },
  { key: 'destination', tabKey: 'destination', label: TAB_LABELS.destination },
  { key: 'review', tabKey: null, label: 'Review' },
]

export type WizardStepStatus = {
  key: ConnectorWizardStepKey
  tabKey: TabKey | null
  label: string
  state: 'missing' | 'unsaved' | 'ready' | 'preview-only'
  complete: boolean
  missingReasons: string[]
}

function idOk(ids: PersistedIds, field: keyof PersistedIds): boolean {
  return Boolean(ids[field].trim())
}

export function computeConnectorWizardStepStatuses(
  ids: PersistedIds,
  unsavedByTab: Record<TabKey, string[]>,
  mappingRawResponseJson: string,
): WizardStepStatus[] {
  const statuses: WizardStepStatus[] = []

  const pushEntity = (
    key: ConnectorWizardStepKey,
    tabKey: TabKey,
    label: string,
    idField: keyof PersistedIds,
    idLabel: string,
  ) => {
    const hasId = idOk(ids, idField)
    const dirty = unsavedByTab[tabKey].length > 0
    const missingReasons: string[] = []
    if (!hasId) {
      missingReasons.push(`${idLabel} missing`)
    }
    if (dirty) {
      missingReasons.push(`${label}: unsaved local edits (${unsavedByTab[tabKey].join(', ')})`)
    }
    const state: WizardStepStatus['state'] = !hasId ? 'missing' : dirty ? 'unsaved' : 'ready'
    statuses.push({
      key,
      tabKey,
      label,
      state,
      complete: hasId && !dirty,
      missingReasons,
    })
  }

  pushEntity('connector', 'connector', TAB_LABELS.connector, 'connectorId', 'connector_id')
  pushEntity('source', 'source', TAB_LABELS.source, 'sourceId', 'source_id')
  pushEntity('stream', 'stream', TAB_LABELS.stream, 'streamId', 'stream_id')

  const mappingHasStream = idOk(ids, 'streamId')
  const mappingRawConfigured = mappingRawResponseJson.trim().length > 2 && mappingRawResponseJson.trim() !== '{}'
  const mappingDirty = unsavedByTab.mapping.length > 0
  const mappingMissing: string[] = []
  if (!mappingHasStream) {
    mappingMissing.push('stream_id required for mapping load/preview')
  }
  if (!mappingRawConfigured) {
    mappingMissing.push('mapping raw/config missing')
  }
  if (mappingDirty) {
    mappingMissing.push(`Mapping: unsaved (${unsavedByTab.mapping.join(', ')})`)
  }
  const mappingState: WizardStepStatus['state'] = !mappingHasStream || !mappingRawConfigured ? 'missing' : mappingDirty ? 'unsaved' : 'preview-only'
  statuses.push({
    key: 'mapping',
    tabKey: 'mapping',
    label: TAB_LABELS.mapping,
    state: mappingState,
    complete: mappingHasStream && mappingRawConfigured && !mappingDirty,
    missingReasons: mappingMissing,
  })

  pushEntity('route', 'route', TAB_LABELS.route, 'routeId', 'route_id')
  pushEntity('destination', 'destination', TAB_LABELS.destination, 'destinationId', 'destination_id')

  const pipeline = statuses.filter((s) => s.key !== 'review')
  const pipelineComplete = pipeline.every((s) => s.complete)

  statuses.push({
    key: 'review',
    tabKey: null,
    label: 'Review',
    state: pipelineComplete ? 'ready' : 'missing',
    complete: pipelineComplete,
    missingReasons: pipelineComplete ? [] : ['Finish incomplete steps above before treating setup as complete'],
  })

  return statuses
}

export function countCompletedWizardSteps(statuses: WizardStepStatus[]): number {
  return statuses.filter((s) => s.key !== 'review' && s.complete).length
}

export function countMissingWizardSteps(statuses: WizardStepStatus[]): number {
  return statuses.filter((s) => s.tabKey !== null && s.state === 'missing').length
}

export function countUnsavedWizardSteps(statuses: WizardStepStatus[]): number {
  return statuses.filter((s) => s.tabKey !== null && s.state === 'unsaved').length
}

export function wizardEntityStepTotal(): number {
  return CONNECTOR_WIZARD_STEP_ORDER.filter((s) => s.tabKey !== null).length
}

export function firstIncompleteWizardStep(statuses: WizardStepStatus[]): WizardStepStatus | null {
  const pipeline = statuses.filter((s) => s.tabKey !== null)
  const inc = pipeline.find((s) => s.state === 'missing')
  return inc ?? null
}

export function firstUnsavedWizardStep(statuses: WizardStepStatus[]): WizardStepStatus | null {
  return statuses.find((s) => s.tabKey !== null && s.state === 'unsaved') ?? null
}

export function formatMappingConfiguredSummary(unsavedByTabMapping: string[]): string {
  if (unsavedByTabMapping.length === 0) {
    return 'Mapping raw/enrichment/table: synced (no unsaved local edits)'
  }
  return `Mapping pending: ${unsavedByTabMapping.join(', ')}`
}

export function wizardOpenRuntimeConfigButtonLabel(tabLabel: string): string {
  return `Open in Runtime Config (${tabLabel})`
}

export function formatWizardMissingSummary(statuses: WizardStepStatus[]): string {
  const reasons = statuses
    .filter((s) => s.tabKey !== null && !s.complete)
    .flatMap((s) => s.missingReasons)
  return reasons.length > 0 ? reasons.join(' · ') : 'none'
}
