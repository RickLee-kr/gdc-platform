import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { resolveApiBaseUrl } from '../api'
import {
  clearApiBaseUrlOverride,
  clearPersistedEntityIds,
  clearUiPreferenceKeys,
  loadApiBaseUrlOverride,
  persistApiBaseUrlOverride,
  persistDisplayDensity,
  type DisplayDensity,
} from '../localPreferences'
import type { AppSection, TabKey } from '../runtimeTypes'
import {
  preferenceFeedbackApplyApiUrl,
  preferenceFeedbackResetApiUrl,
  preferenceFeedbackResetIds,
  preferenceFeedbackResetUiPreferences,
} from '../utils/runtimeMessages'
import {
  buildIdChecklist,
  computeRecommendedNextAction,
  computeUnsavedByTab,
  mappingRowsSignature,
  type PersistedIds,
} from '../utils/runtimeState'
import { useDirtyPair } from './useDirtyState'

export type RuntimeUiIds = PersistedIds

export type MappingRowForDirty = { outputField: string; sourcePath: string; sampleValue?: unknown }

export type UseRuntimeUiStateOptions = {
  ids: RuntimeUiIds
  setIds: Dispatch<SetStateAction<RuntimeUiIds>>
  setDensity: Dispatch<SetStateAction<DisplayDensity>>
  activeSection: AppSection
  activeTab: TabKey
  mappingRows: MappingRowForDirty[]
}

export function useRuntimeUiState(options: UseRuntimeUiStateOptions) {
  const { ids, setIds, setDensity, activeSection, activeTab, mappingRows } = options

  const connector = useDirtyPair()
  const source = useDirtyPair()
  const stream = useDirtyPair()
  const mappingRaw = useDirtyPair('{}')
  const mappingEnrichment = useDirtyPair('{}')
  const route = useDirtyPair()
  const destination = useDirtyPair()
  const [mappingRowsBaseline, setMappingRowsBaseline] = useState('[]')

  const [apiUrlRevision, setApiUrlRevision] = useState(0)
  const [apiUrlOverrideDraft, setApiUrlOverrideDraft] = useState(() => loadApiBaseUrlOverride() ?? '')
  const [localPreferenceFeedback, setLocalPreferenceFeedback] = useState('')

  const effectiveApiBase = useMemo(() => {
    void apiUrlRevision
    return resolveApiBaseUrl()
  }, [apiUrlRevision])

  const handleResetIds = useCallback(() => {
    setIds({
      connectorId: '',
      sourceId: '',
      streamId: '',
      routeId: '',
      destinationId: '',
    })
    clearPersistedEntityIds()
    setLocalPreferenceFeedback(preferenceFeedbackResetIds())
  }, [setIds])

  const handleResetUiPreferences = useCallback(() => {
    setDensity('comfortable')
    clearUiPreferenceKeys()
    persistDisplayDensity('comfortable')
    setLocalPreferenceFeedback(preferenceFeedbackResetUiPreferences())
  }, [setDensity])

  const handleApplyApiUrlOverride = useCallback(() => {
    persistApiBaseUrlOverride(apiUrlOverrideDraft)
    setApiUrlRevision((n) => n + 1)
    setLocalPreferenceFeedback(preferenceFeedbackApplyApiUrl(apiUrlOverrideDraft.trim()))
  }, [apiUrlOverrideDraft])

  const handleResetApiUrl = useCallback(() => {
    clearApiBaseUrlOverride()
    setApiUrlOverrideDraft('')
    setApiUrlRevision((n) => n + 1)
    setLocalPreferenceFeedback(preferenceFeedbackResetApiUrl())
  }, [])

  const rowsSig = mappingRowsSignature(mappingRows)

  const unsavedByTab = useMemo(
    () =>
      computeUnsavedByTab({
        connectorSave: connector.current,
        connectorSaveBaseline: connector.baseline,
        sourceSave: source.current,
        sourceSaveBaseline: source.baseline,
        streamSave: stream.current,
        streamSaveBaseline: stream.baseline,
        mappingRawResponseJson: mappingRaw.current,
        mappingRawBaseline: mappingRaw.baseline,
        mappingEnrichmentJson: mappingEnrichment.current,
        mappingEnrichmentBaseline: mappingEnrichment.baseline,
        mappingRowsSignature: rowsSig,
        mappingRowsBaseline,
        routeSave: route.current,
        routeSaveBaseline: route.baseline,
        destinationSave: destination.current,
        destinationSaveBaseline: destination.baseline,
      }),
    [
      connector.current,
      connector.baseline,
      source.current,
      source.baseline,
      stream.current,
      stream.baseline,
      mappingRaw.current,
      mappingRaw.baseline,
      mappingEnrichment.current,
      mappingEnrichment.baseline,
      rowsSig,
      mappingRowsBaseline,
      route.current,
      route.baseline,
      destination.current,
      destination.baseline,
    ],
  )

  const idChecklist = useMemo(() => buildIdChecklist(ids), [ids])

  const missingIds = useMemo(
    () => idChecklist.filter((item) => !item.value).map((item) => item.key),
    [idChecklist],
  )

  const hasStreamId = Boolean(ids.streamId.trim())
  const hasRouteId = Boolean(ids.routeId.trim())

  const recommendedNextAction = useMemo(
    () =>
      computeRecommendedNextAction({
        activeSection,
        activeTab,
        missingIds,
        hasStreamId,
        hasRouteId,
      }),
    [activeSection, activeTab, missingIds, hasStreamId, hasRouteId],
  )

  return {
    connectorSave: connector.current,
    setConnectorSave: connector.setCurrent,
    syncConnectorSave: connector.syncBoth,

    sourceSave: source.current,
    setSourceSave: source.setCurrent,
    syncSourceSave: source.syncBoth,

    streamSave: stream.current,
    setStreamSave: stream.setCurrent,
    syncStreamSave: stream.syncBoth,

    mappingRawResponseJson: mappingRaw.current,
    setMappingRawResponseJson: mappingRaw.setCurrent,
    syncMappingRawBoth: mappingRaw.syncBoth,

    mappingEnrichmentJson: mappingEnrichment.current,
    setMappingEnrichmentJson: mappingEnrichment.setCurrent,
    syncMappingEnrichmentBoth: mappingEnrichment.syncBoth,

    mappingRowsBaseline,
    setMappingRowsBaseline,

    routeSave: route.current,
    setRouteSave: route.setCurrent,
    syncRouteSave: route.syncBoth,

    destinationSave: destination.current,
    setDestinationSave: destination.setCurrent,
    syncDestinationSave: destination.syncBoth,

    apiUrlOverrideDraft,
    setApiUrlOverrideDraft,
    localPreferenceFeedback,
    effectiveApiBase,

    handleResetIds,
    handleResetUiPreferences,
    handleApplyApiUrlOverride,
    handleResetApiUrl,

    unsavedByTab,
    idChecklist,
    missingIds,
    hasStreamId,
    hasRouteId,
    recommendedNextAction,
  }
}
