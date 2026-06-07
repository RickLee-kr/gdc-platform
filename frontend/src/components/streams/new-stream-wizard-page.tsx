import { ChevronLeft, ChevronRight, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { NAV_PATH, runtimeOverviewPath } from '../../config/nav-paths'
import { createStream } from '../../api/gdcStreams'
import { materializeConnectorTemplates } from '../../api/gdcConnectorTemplates'
import { saveStreamMappingUiConfigStrict } from '../../api/gdcRuntimeUi'
import { createRoute } from '../../api/gdcRoutes'
import { startRuntimeStream } from '../../api/gdcRuntime'
import { isGovernanceModeEnabled } from '../../utils/governance-mode'
import { StepConnect } from './wizard/step-connect'
import { StepMappingCombined } from './wizard/step-mapping-combined'
import { StepDelivery } from './wizard/step-delivery'
import { StepDataPolicy } from './wizard/step-data-policy'
import { StepReview } from './wizard/step-review'
import { StepDone } from './wizard/step-done'
import { WizardGovernanceStartModal } from './wizard/wizard-governance-start-modal'
import {
  buildSourceAuthPayload,
  buildInitialState,
  buildSourceConfig,
  buildStreamCreatePayload,
  buildRouteCreatePayloads,
  computeStepCompletion,
  computeVisibleStepCompletion,
  enrichmentDictFromRows,
  fieldMappingsFromRows,
  resolveWizardNavigateTarget,
  resolveWizardVisibleSteps,
  type ConnectTabKey,
  type MappingSectionKey,
  type WizardConfigState,
  type WizardCreateOutcome,
  type WizardLegacySubstepKey,
  type WizardState,
  type WizardStepDef,
  type WizardStepKey,
} from './wizard/wizard-state'
import { flattenSampleFields, wizardExtractEvents } from './wizard/wizard-json-extract'
import {
  buildAnalysisForSample,
  getOperationalSample,
  type OperationalSampleId,
} from './wizard/wizard-operational-samples'
import { applyHttpImportToWizardState, type HttpImportWizardLocationState } from '../../utils/httpImportDraft'
import { checkpointPathFromClick, normalizeEventArrayPath, normalizeEventRootPath } from '../../utils/eventExtractionPaths'
import { normalizeCheckpointRelativePath } from '../../utils/recordSelectionPaths'

const GOVERNANCE_MODAL_SEEN_KEY = 'gdc-wizard-governance-modal-seen-v1'

export function NewStreamWizardPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const importHydratedRef = useRef(false)
  const tenantGovernanceEnabled = isGovernanceModeEnabled()

  const [governanceModalOpen, setGovernanceModalOpen] = useState(() => {
    if (!tenantGovernanceEnabled) return false
    try {
      return localStorage.getItem(GOVERNANCE_MODAL_SEEN_KEY) !== '1'
    } catch {
      return true
    }
  })
  const [governanceForStream, setGovernanceForStream] = useState(false)
  const [wizardStarted, setWizardStarted] = useState(() => !tenantGovernanceEnabled)

  const [stepIndex, setStepIndex] = useState(0)
  const [connectTab, setConnectTab] = useState<ConnectTabKey>('connection')
  const [mappingSection, setMappingSection] = useState<MappingSectionKey>('field_mapping')
  const [state, setState] = useState<WizardState>(() => buildInitialState())
  const [busy, setBusy] = useState(false)
  const [creationError, setCreationError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [draftNotice, setDraftNotice] = useState<string | null>(null)
  const [operationalSampleId, setOperationalSampleId] = useState<OperationalSampleId | null>(null)

  const governanceEnabled = tenantGovernanceEnabled && governanceForStream

  const wizardSteps = useMemo(
    () => resolveWizardVisibleSteps(governanceEnabled),
    [governanceEnabled],
  )

  const currentStepKey = wizardSteps[stepIndex]?.key ?? 'connect'
  const legacyCompletion = useMemo(() => computeStepCompletion(state), [state])
  const completion = useMemo(
    () => computeVisibleStepCompletion(state, { governanceEnabled }),
    [state, governanceEnabled],
  )

  const navigateWizard = useCallback(
    (legacyKey: WizardLegacySubstepKey) => {
      const target = resolveWizardNavigateTarget(legacyKey)
      const idx = wizardSteps.findIndex((s) => s.key === target.step)
      if (idx >= 0) setStepIndex(idx)
      if (target.connectTab) setConnectTab(target.connectTab)
      if (target.mappingSection) setMappingSection(target.mappingSection)
    },
    [wizardSteps],
  )

  useEffect(() => {
    if (importHydratedRef.current) return
    const routeState = (location.state ?? {}) as HttpImportWizardLocationState
    const connectorId = routeState.connectorId
    if (connectorId == null) return
    importHydratedRef.current = true
    setWizardStarted(true)
    setGovernanceModalOpen(false)
    setState((prev) => applyHttpImportToWizardState(prev, { connectorId, streamDraft: routeState.streamDraft }))
    setDraftNotice('Stream fields prefilled from import. Review polling and mapping before creating.')
    setConnectTab('connection')
    const connectIdx = wizardSteps.findIndex((s) => s.key === 'connect')
    if (connectIdx >= 0) setStepIndex(connectIdx)
  }, [location.state, wizardSteps])

  const updateConnector = useCallback((patch: Partial<WizardState['connector']>) => {
    setState((s) => ({ ...s, connector: { ...s.connector, ...patch } }))
  }, [])
  const updateStream = useCallback((patch: Partial<WizardState['stream']>) => {
    setState((s) => ({ ...s, stream: { ...s.stream, ...patch } }))
  }, [])

  const updateApiTest = useCallback((next: WizardState['apiTest']) => {
    setState((s) => ({ ...s, apiTest: next }))
    if (next.status === 'success' && next.ok) {
      window.requestAnimationFrame(() => {
        document.getElementById('wizard-stepper')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        if (!next.analysis?.previewError) {
          setConnectTab('record_selection')
          document.getElementById('wizard-json-preview-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      })
    }
  }, [])

  const patchStream = useCallback((patch: Partial<WizardConfigState>) => {
    setState((s) => ({ ...s, stream: { ...s.stream, ...patch } }))
  }, [])

  const setEventArrayPath = useCallback((path: string) => {
    setState((s) => {
      const raw = s.apiTest.parsedJson ?? s.apiTest.rawResponse
      const rawObj = raw !== null && typeof raw === 'object' ? raw : null
      const normalized = normalizeEventArrayPath(path) || (Array.isArray(rawObj) ? '$' : '')
      const useWhole = normalized.length === 0
      const extracted = wizardExtractEvents(rawObj, normalized, s.stream.eventRootPath)
      const flat = flattenSampleFields(extracted[0] ?? null)
      const nextAnalysis =
        s.apiTest.analysis != null
          ? {
              ...s.apiTest.analysis,
              sampleEvent: (extracted[0] ?? null) as Record<string, unknown> | null,
              flatPreviewFields: flat.length ? flat : s.apiTest.analysis.flatPreviewFields,
            }
          : s.apiTest.analysis
      return {
        ...s,
        stream: {
          ...s.stream,
          eventArrayPath: normalized,
          useWholeResponseAsEvent: useWhole,
        },
        apiTest: {
          ...s.apiTest,
          extractedEvents: extracted,
          eventCount: extracted.length,
          analysis: nextAnalysis,
        },
      }
    })
  }, [])

  const setEventRootPath = useCallback((path: string) => {
    setState((s) => {
      const raw = s.apiTest.parsedJson ?? s.apiTest.rawResponse
      const rawObj = raw !== null && typeof raw === 'object' ? raw : null
      const normalizedRoot = normalizeEventRootPath(path)
      const arrayPath =
        s.stream.eventArrayPath.trim() ||
        (Array.isArray(rawObj) && !s.stream.useWholeResponseAsEvent ? '$' : '')
      const extracted = wizardExtractEvents(rawObj, s.stream.useWholeResponseAsEvent ? '' : arrayPath, normalizedRoot)
      const flat = flattenSampleFields(extracted[0] ?? null)
      const nextAnalysis =
        s.apiTest.analysis != null
          ? {
              ...s.apiTest.analysis,
              sampleEvent: (extracted[0] ?? null) as Record<string, unknown> | null,
              flatPreviewFields: flat.length ? flat : s.apiTest.analysis.flatPreviewFields,
            }
          : s.apiTest.analysis
      return {
        ...s,
        stream: { ...s.stream, eventRootPath: normalizedRoot },
        apiTest: {
          ...s.apiTest,
          extractedEvents: extracted,
          eventCount: extracted.length,
          analysis: nextAnalysis,
        },
      }
    })
  }, [])

  const setCheckpoint = useCallback((patch: Partial<Pick<WizardConfigState, 'checkpointFieldType' | 'checkpointSourcePath'>>) => {
    setState((s) => {
      let checkpointSourcePath = patch.checkpointSourcePath ?? s.stream.checkpointSourcePath
      if (patch.checkpointSourcePath !== undefined && checkpointSourcePath.trim()) {
        const rawPath = checkpointSourcePath.trim()
        const arrayPath = s.stream.eventArrayPath.trim() || '$'
        if (rawPath.startsWith('$') && /\[\d+\]/.test(rawPath)) {
          checkpointSourcePath = checkpointPathFromClick(rawPath, arrayPath, 0)
        } else {
          checkpointSourcePath = normalizeCheckpointRelativePath(rawPath)
        }
      }
      return {
        ...s,
        stream: {
          ...s.stream,
          ...patch,
          ...(patch.checkpointSourcePath !== undefined ? { checkpointSourcePath } : {}),
        },
      }
    })
  }, [])

  const loadOperationalSample = useCallback((id: OperationalSampleId) => {
    const sample = getOperationalSample(id)
    const eap = sample.defaultEventArrayPath
    const erp = sample.defaultEventRootPath
    const events = wizardExtractEvents(sample.payload, eap, erp)
    const startedAt = Date.now()
    const analysis = buildAnalysisForSample(sample, eap, erp)
    setOperationalSampleId(id)
    setState((s) => ({
      ...s,
      stream: {
        ...s.stream,
        eventArrayPath: eap,
        eventRootPath: erp,
        useWholeResponseAsEvent: false,
        checkpointSourcePath: '',
        checkpointFieldType: '',
      },
      apiTest: {
        ...s.apiTest,
        status: 'success',
        ok: true,
        requestUrl: `local://operational-sample/${id}`,
        method: s.stream.httpMethod,
        statusCode: 200,
        responseHeaders: { 'x-operational-sample': id },
        rawBody: JSON.stringify(sample.payload),
        parsedJson: sample.payload,
        rawResponse: sample.payload,
        extractedEvents: events,
        eventCount: events.length,
        startedAt,
        finishedAt: startedAt + 1,
        errorCode: null,
        errorType: null,
        errorMessage: null,
        targetStatusCode: null,
        targetResponseBody: null,
        hint: null,
        apiBacked: false,
        steps: [],
        responseSample: null,
        effectiveHeadersMasked: null,
        actualRequestSent: null,
        analysis,
        s3ConnectivityPassed: false,
        remoteProbe: null,
      },
    }))
  }, [])

  const setMapping = useCallback((rows: WizardState['mapping']) => {
    setState((s) => ({ ...s, mapping: rows }))
  }, [])
  const setEnrichment = useCallback((rows: WizardState['enrichment']) => {
    setState((s) => ({ ...s, enrichment: rows }))
  }, [])
  const setDestinations = useCallback((patch: Partial<WizardState['destinations']>) => {
    setState((s) => ({ ...s, destinations: { ...s.destinations, ...patch } }))
  }, [])
  const setDataPolicy = useCallback((patch: Partial<WizardState['dataPolicy']>) => {
    setState((s) => ({ ...s, dataPolicy: { ...s.dataPolicy, ...patch } }))
  }, [])

  const handleCreate = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setCreationError(null)

    const workingState: WizardState = {
      ...state,
      connector: { ...state.connector },
      stream: { ...state.stream },
    }
    const outcome: WizardCreateOutcome = {
      streamId: null,
      routeId: null,
      routeIds: [],
      mappingSaved: false,
      enrichmentSaved: false,
      errors: [],
      apiBacked: true,
      createdAt: null,
      materializedStreamIds: [],
    }

    const useTemplateMaterialization =
      workingState.connector.registryModuleId != null &&
      workingState.connector.selectedTemplateIds.length > 0

    try {
      if (useTemplateMaterialization) {
        if (workingState.connector.connectorId == null) {
          throw new Error('Select a saved connector before materializing stream templates.')
        }
        const materialized = await materializeConnectorTemplates({
          connector_id: workingState.connector.connectorId,
          module_id: workingState.connector.registryModuleId!,
          templates: workingState.connector.selectedTemplateIds,
        })
        const createdStreams = materialized.created_streams
        if (createdStreams.length === 0) {
          throw new Error('Materialization returned no streams.')
        }
        outcome.materializedStreamIds = createdStreams.map((row) => row.stream_id)
        outcome.streamId = createdStreams[0]?.stream_id ?? null
        outcome.mappingSaved = true
        outcome.enrichmentSaved = true
        outcome.apiBacked = true
      } else {
        if (workingState.connector.connectorId == null || workingState.connector.sourceId == null) {
          throw new Error('Select a saved connector and its linked source before creating a stream.')
        }
        void buildSourceConfig(workingState)
        void buildSourceAuthPayload(workingState)
        const payload = buildStreamCreatePayload(workingState)
        if (payload == null) {
          throw new Error('connector/source rows are required before stream creation')
        }
        const created = await createStream(payload)
        outcome.streamId = created.id
        outcome.apiBacked = true
        outcome.createdAt = created.created_at ?? null

        const fieldMappings = fieldMappingsFromRows(workingState.mapping)
        const enrichmentDict = enrichmentDictFromRows(workingState.enrichment)
        const hasMapping = Object.keys(fieldMappings).length > 0
        const hasEnrichment = Object.keys(enrichmentDict).length > 0

        if (hasMapping || hasEnrichment) {
          try {
            await saveStreamMappingUiConfigStrict(created.id, {
              mapping: hasMapping
                ? {
                    field_mappings: fieldMappings,
                    event_array_path:
                      workingState.stream.useWholeResponseAsEvent || !workingState.stream.eventArrayPath.trim()
                        ? null
                        : workingState.stream.eventArrayPath.trim().startsWith('$')
                          ? workingState.stream.eventArrayPath.trim()
                          : `$.${workingState.stream.eventArrayPath.trim()}`,
                    event_root_path: workingState.stream.eventRootPath.trim()
                      ? workingState.stream.eventRootPath.trim().startsWith('$')
                        ? workingState.stream.eventRootPath.trim()
                        : `$.${workingState.stream.eventRootPath.trim()}`
                      : null,
                  }
                : null,
              enrichment: hasEnrichment
                ? {
                    enabled: true,
                    enrichment: enrichmentDict,
                    override_policy: 'KEEP_EXISTING',
                  }
                : null,
            })
            outcome.mappingSaved = hasMapping
            outcome.enrichmentSaved = hasEnrichment
          } catch (err) {
            outcome.errors.push(
              `mapping-ui/save failed: ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        }
      }

      if (
        outcome.streamId != null &&
        workingState.destinations.destinationApiBacked &&
        workingState.destinations.routeDrafts.length > 0
      ) {
        for (const routePayload of buildRouteCreatePayloads(outcome.streamId, workingState.destinations)) {
          try {
            const route = await createRoute(routePayload)
            outcome.routeId = route.id
            outcome.routeIds.push(route.id)
          } catch (err) {
            outcome.errors.push(
              `POST /routes/ failed (destination_id=${routePayload.destination_id}): ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      outcome.errors.push(
        useTemplateMaterialization ? `Template materialization failed: ${message}` : `POST /streams/ failed: ${message}`,
      )
      setCreationError(message)
    } finally {
      setState((s) => ({ ...s, outcome }))
      const reviewIdx = wizardSteps.findIndex((step) => step.key === 'review')
      if (reviewIdx >= 0) setStepIndex(reviewIdx)
      setBusy(false)
    }
  }, [busy, state, wizardSteps])

  const handleStart = useCallback(async () => {
    const id = state.outcome?.streamId
    if (id == null || isStarting) return
    setIsStarting(true)
    const res = await startRuntimeStream(id)
    setState((s) => ({ ...s, startMessage: res?.message ?? 'Runtime API unavailable.' }))
    setIsStarting(false)
  }, [isStarting, state.outcome?.streamId])

  const saveDraft = useCallback(() => {
    try {
      localStorage.setItem('gdc-stream-wizard-draft-v1', JSON.stringify({ savedAt: Date.now(), state }))
      setDraftNotice('Draft saved locally.')
      window.setTimeout(() => setDraftNotice(null), 4000)
    } catch {
      setDraftNotice('Unable to save draft.')
      window.setTimeout(() => setDraftNotice(null), 4000)
    }
  }, [state])

  const handleCreateAnother = useCallback(() => {
    setState(buildInitialState())
    setStepIndex(0)
    setConnectTab('connection')
    setMappingSection('field_mapping')
    setCreationError(null)
  }, [])

  const handleStartWizard = useCallback(() => {
    try {
      localStorage.setItem(GOVERNANCE_MODAL_SEEN_KEY, '1')
    } catch {
      /* ignore */
    }
    setGovernanceModalOpen(false)
    setWizardStarted(true)
  }, [])

  const isReviewStep = currentStepKey === 'review'
  const isCreated = state.outcome?.streamId != null
  const showReviewForm = isReviewStep && !isCreated

  const persistenceLabel = state.connector.apiBacked
    ? 'API-backed catalog · creation will hit /api/v1/streams/'
    : 'Offline catalog · stream creation uses a local draft until the API is available'

  if (!wizardStarted) {
    return (
      <>
        <WizardGovernanceStartModal
          open={governanceModalOpen}
          governanceForStream={governanceForStream}
          onGovernanceForStreamChange={setGovernanceForStream}
          onStart={handleStartWizard}
          onCancel={() => navigate(NAV_PATH.streams)}
        />
        <div className="flex h-48 items-center justify-center text-[13px] text-slate-500 dark:text-gdc-muted">
          Preparing stream wizard…
        </div>
      </>
    )
  }

  return (
    <div className="flex h-fit w-full min-w-0 grow-0 flex-col gap-4 pb-8">
      <WizardGovernanceStartModal
        open={governanceModalOpen}
        governanceForStream={governanceForStream}
        onGovernanceForStreamChange={setGovernanceForStream}
        onStart={handleStartWizard}
        onCancel={() => navigate(NAV_PATH.streams)}
      />

      <nav className="flex flex-wrap items-center gap-1 text-[12px]" aria-label="Page breadcrumb">
        <Link to={NAV_PATH.streams} className="font-medium text-violet-700 hover:underline dark:text-violet-300">
          Streams
        </Link>
        <span className="text-slate-400 dark:text-gdc-muted" aria-hidden>
          /
        </span>
        <span className="font-semibold text-slate-700 dark:text-slate-200">New Stream</span>
      </nav>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Stream Onboarding Wizard
          </h2>
          <p className="max-w-2xl text-[13px] text-slate-600 dark:text-gdc-muted">
            {wizardSteps.map((s) => s.title).join(' → ')}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-gdc-muted">{persistenceLabel}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(NAV_PATH.streams)}
            className="inline-flex h-9 items-center rounded-md border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-200 dark:hover:bg-gdc-rowHover"
          >
            Cancel
          </button>
        </div>
      </header>

      {creationError ? (
        <p className="rounded-md border border-red-200/80 bg-red-500/[0.06] p-3 text-[12px] font-medium text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
          API save failed: {creationError}
        </p>
      ) : null}

      <Stepper
        wizardSteps={wizardSteps}
        stepIndex={stepIndex}
        setStepIndex={setStepIndex}
        completion={completion}
      />

      {draftNotice ? (
        <p className="rounded-md border border-emerald-200/80 bg-emerald-500/[0.06] px-3 py-2 text-[11px] font-medium text-emerald-800 dark:border-emerald-500/35 dark:bg-emerald-500/10 dark:text-emerald-200">
          {draftNotice}
        </p>
      ) : null}

      <main>
        {currentStepKey === 'connect' ? (
          <StepConnect
            state={state}
            activeTab={connectTab}
            onTabChange={setConnectTab}
            onConnectorChange={updateConnector}
            onStreamChange={updateStream}
            onApiTestChange={updateApiTest}
            onStreamPatch={patchStream}
            onSetEventArrayPath={setEventArrayPath}
            onSetEventRootPath={setEventRootPath}
            onSetCheckpoint={setCheckpoint}
            onLoadOperationalSample={loadOperationalSample}
            activeOperationalSampleId={operationalSampleId}
          />
        ) : null}
        {currentStepKey === 'mapping' ? (
          <StepMappingCombined
            state={state}
            activeSection={mappingSection}
            onSectionChange={setMappingSection}
            onChangeMapping={setMapping}
            onChangeEnrichment={setEnrichment}
          />
        ) : null}
        {currentStepKey === 'destinations' ? <StepDelivery state={state} onChange={setDestinations} /> : null}
        {currentStepKey === 'data_policy' ? (
          <StepDataPolicy state={state.dataPolicy} onChange={setDataPolicy} />
        ) : null}
        {showReviewForm ? (
          <StepReview
            state={state}
            busy={busy}
            governanceEnabled={governanceEnabled}
            onNavigateToStep={navigateWizard}
            onEditDataPolicy={() => {
              const idx = wizardSteps.findIndex((s) => s.key === 'data_policy')
              if (idx >= 0) setStepIndex(idx)
            }}
          />
        ) : null}
        {isReviewStep && isCreated ? (
          <StepDone
            state={state}
            isStarting={isStarting}
            onStart={() => void handleStart()}
            onNavigateToStep={navigateWizard}
          />
        ) : null}
      </main>

      <nav
        className="sticky bottom-0 z-20 mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 bg-white/95 py-3 backdrop-blur-sm dark:border-gdc-border dark:bg-gdc-section"
        aria-label="Wizard navigation"
      >
        {isReviewStep && isCreated ? (
          <button
            type="button"
            onClick={() => navigate(NAV_PATH.streams)}
            className="inline-flex h-9 items-center rounded-md border border-transparent px-1 text-[12px] font-semibold text-slate-600 hover:text-slate-900 dark:text-gdc-muted dark:hover:text-slate-100"
          >
            Exit Wizard
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setStepIndex((idx) => Math.max(0, idx - 1))}
            disabled={stepIndex === 0}
            className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200 dark:hover:bg-gdc-rowHover"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            Back
          </button>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isReviewStep && isCreated ? (
            <>
              <button
                type="button"
                onClick={() => handleCreateAnother()}
                className="inline-flex h-9 items-center rounded-md border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-slate-800 shadow-sm hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:hover:bg-gdc-rowHover"
              >
                Create Another Stream
              </button>
              <Link
                to={
                  state.outcome?.streamId != null
                    ? runtimeOverviewPath({ stream_id: state.outcome.streamId })
                    : NAV_PATH.runtime
                }
                className="inline-flex h-9 items-center gap-1 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white shadow-sm hover:bg-violet-700"
              >
                Go to Monitoring
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </>
          ) : (
            <>
              {currentStepKey === 'mapping' || currentStepKey === 'review' ? (
                <button
                  type="button"
                  onClick={() => saveDraft()}
                  className="inline-flex h-9 items-center rounded-md border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200 dark:hover:bg-gdc-rowHover"
                >
                  Save as Draft
                </button>
              ) : null}
              {showReviewForm ? (
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={busy || legacyCompletion.review !== 'in_progress'}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
                  {busy ? 'Creating…' : 'Create Stream'}
                </button>
              ) : null}
              {!isReviewStep ? (
                <button
                  type="button"
                  onClick={() => setStepIndex((idx) => Math.min(wizardSteps.length - 1, idx + 1))}
                  className="inline-flex h-9 items-center gap-1 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white shadow-sm hover:bg-violet-700"
                >
                  {currentStepKey === 'connect' ? (
                    <>
                      Next: Mapping
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                    </>
                  ) : currentStepKey === 'mapping' ? (
                    <>
                      Next: Destination
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                    </>
                  ) : currentStepKey === 'destinations' ? (
                    <>
                      Next: {governanceEnabled ? 'Data Policy' : 'Review'}
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                    </>
                  ) : currentStepKey === 'data_policy' ? (
                    <>
                      Next: Review
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                    </>
                  ) : (
                    <>
                      Next
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                    </>
                  )}
                </button>
              ) : null}
              {!isReviewStep ? (
                <a
                  href="https://example.com/docs/streams/onboarding"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center gap-1 text-[12px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
                >
                  View onboarding docs
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              ) : null}
            </>
          )}
        </div>
      </nav>
    </div>
  )
}

function Stepper({
  wizardSteps,
  stepIndex,
  setStepIndex,
  completion,
}: {
  wizardSteps: readonly WizardStepDef[]
  stepIndex: number
  setStepIndex: (idx: number) => void
  completion: Record<WizardStepKey, 'incomplete' | 'in_progress' | 'complete'>
}) {
  const colClass =
    wizardSteps.length >= 5
      ? 'sm:grid-cols-3 lg:grid-cols-5'
      : wizardSteps.length === 4
        ? 'sm:grid-cols-2 lg:grid-cols-4'
        : 'sm:grid-cols-2'

  return (
    <ol
      id="wizard-stepper"
      data-testid="wizard-stepper"
      className={cn('grid grid-cols-2 gap-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2 shadow-sm dark:border-gdc-border dark:bg-gdc-card', colClass)}
    >
      {wizardSteps.map((step, index) => {
        const active = index === stepIndex
        const status = completion[step.key]
        const tone =
          status === 'complete'
            ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
            : active
              ? 'border-violet-400/50 bg-violet-500/15 text-violet-700 dark:text-violet-300'
              : status === 'in_progress'
                ? 'border-amber-300/60 bg-amber-500/10 text-amber-800 dark:text-amber-200'
                : 'border-slate-300 bg-white text-slate-500 dark:border-gdc-border dark:bg-gdc-card dark:text-gdc-muted'
        return (
          <li key={step.key} className="min-w-0">
            <button
              type="button"
              onClick={() => setStepIndex(index)}
              className={cn(
                'w-full rounded-lg border px-2 py-1.5 text-left transition-colors',
                active
                  ? 'border-violet-300 bg-violet-500/[0.08] dark:border-violet-500/40 dark:bg-violet-500/10'
                  : 'border-slate-200/80 bg-slate-50/70 hover:bg-slate-100/80 dark:border-gdc-border dark:bg-gdc-card dark:hover:bg-gdc-rowHover',
              )}
              aria-current={active ? 'step' : undefined}
            >
              <p className="flex items-center gap-1.5 text-[10px] font-semibold">
                <span
                  className={cn(
                    'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px]',
                    tone,
                  )}
                >
                  {status === 'complete' ? '✓' : index + 1}
                </span>
                <span
                  className={cn(
                    'min-w-0 truncate text-[11px]',
                    active ? 'text-violet-700 dark:text-violet-300' : 'text-slate-700 dark:text-gdc-mutedStrong',
                  )}
                >
                  {step.title}
                </span>
              </p>
              <p className="ml-5 mt-0.5 truncate text-[10px] font-medium text-slate-500 dark:text-gdc-muted">
                {step.subtitle}
              </p>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
