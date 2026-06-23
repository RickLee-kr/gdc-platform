import { ChevronLeft, ChevronRight, Loader2, Play, Square } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { NAV_PATH, streamRuntimePath } from '../../config/nav-paths'
import { fetchStreamById } from '../../api/gdcStreams'
import {
  fetchStreamRuntimeHealth,
  fetchStreamRuntimeStats,
  runStreamOnce,
  startRuntimeStream,
  stopRuntimeStream,
} from '../../api/gdcRuntime'
import { mapBackendStreamStatus } from '../../api/streamRows'
import type { StreamRuntimeStatus } from '../../api/streamRows'
import { StatusBadge } from '../shell/status-badge'
import { StreamOperationalBadges } from './stream-operational-badges'
import {
  buildOperationalStreamBadges,
  operationalRunControlTooltipSupplement,
} from '../../utils/streamOperationalBadges'
import { formatRunOnceErrorLines, formatRunOnceSummaryLines } from '../../utils/formatRunOnceSummary'
import { wizardStepsWithSourcePresentation } from '../../utils/sourceTypePresentation'
import { StepConnect } from './wizard/step-connect'
import { StepSample } from './wizard/step-sample'
import { StepDelivery } from './wizard/step-delivery'
import { StepRouteProcessing } from './wizard/step-route-processing'
import { StepDeploy } from './wizard/step-deploy'
import { WizardStepper } from './wizard/wizard-stepper'
import { hydrateWizardStateFromStream } from './wizard/wizard-stream-hydrate'
import { persistWizardStreamEdits } from './wizard/wizard-stream-persist'
import {
  WIZARD_STEPS,
  computeStepCompletion,
  legacySubstepToWizardStep,
  type WizardLegacySubstepKey,
  type WizardConfigState,
  type WizardState,
  type WizardStepKey,
} from './wizard/wizard-state'
import {
  applySampleConfirmationToWizardState,
  mergeStreamSampleConfirmations,
} from './wizard/wizard-step-gates'
import { wizardExtractEvents } from './wizard/wizard-json-extract'
import { buildApiTestExtractedEventsPatch, buildApiTestSuccessPatch } from '../../utils/wizardUnionSchema'
import {
  buildAnalysisForSample,
  getOperationalSample,
  type OperationalSampleId,
} from './wizard/wizard-operational-samples'
import { checkpointPathFromClick, normalizeEventArrayPath, normalizeEventRootPath } from '../../utils/eventExtractionPaths'
import { normalizeCheckpointRelativePath } from '../../utils/recordSelectionPaths'

const EDIT_NEXT_STEP_LABEL: Partial<Record<WizardStepKey, string>> = {
  connect: 'Sample & Record Selection',
  sample: 'Destinations',
  destinations: 'Route Processing',
  route_processing: 'Review',
}

function wizardStepIndexForKey(steps: ReadonlyArray<{ key: WizardStepKey }>, key: WizardStepKey): number {
  const idx = steps.findIndex((step) => step.key === key)
  return idx >= 0 ? idx : 0
}

export function StreamEditWizardPage() {
  const { streamId = '' } = useParams<{ streamId: string }>()
  const navigate = useNavigate()
  const backendStreamId = /^\d+$/.test(streamId) ? Number(streamId) : null

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [state, setState] = useState<WizardState | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  const [runtimeStatus, setRuntimeStatus] = useState<StreamRuntimeStatus>('UNKNOWN')
  const [controlBusy, setControlBusy] = useState(false)
  const [runOnceBusy, setRunOnceBusy] = useState(false)
  const [controlMessage, setControlMessage] = useState<string | null>(null)
  const [runOnceNotice, setRunOnceNotice] = useState<{ variant: 'success' | 'error'; lines: string[] } | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [operationalSampleId, setOperationalSampleId] = useState<OperationalSampleId | null>(null)
  const [dataProtectionDrawerOpen, setDataProtectionDrawerOpen] = useState(false)
  const saveSnapshotRef = useRef<string>('')

  useEffect(() => {
    if (backendStreamId == null) {
      setLoadError('A numeric stream id is required for API-backed editing.')
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    void (async () => {
      const hydrated = await hydrateWizardStateFromStream(backendStreamId)
      if (cancelled) return
      if (!hydrated) {
        setLoadError('Could not load stream configuration.')
        setState(null)
        setLoading(false)
        return
      }
      const next = applySampleConfirmationToWizardState(hydrated)
      setState(next)
      saveSnapshotRef.current = JSON.stringify(next)
      setLoading(false)
      const found = await fetchStreamById(backendStreamId)
      if (!cancelled && found?.status) {
        setRuntimeStatus(mapBackendStreamStatus(found.status))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [backendStreamId])

  const wizardSteps = useMemo(() => {
    if (!state) return WIZARD_STEPS
    const steps = wizardStepsWithSourcePresentation(WIZARD_STEPS, state.connector.sourceType)
    return steps.map((step) =>
      step.key === 'deploy'
        ? { ...step, title: 'Review', subtitle: 'Save · runtime · monitoring' }
        : step,
    )
  }, [state])

  const currentStepKey = wizardSteps[stepIndex]?.key ?? 'connect'
  const completion = useMemo(() => (state ? computeStepCompletion(state) : null), [state])

  const refreshRuntimeSnapshot = useCallback(async () => {
    if (backendStreamId == null) return
    const [stats, health] = await Promise.all([
      fetchStreamRuntimeStats(backendStreamId, 80),
      fetchStreamRuntimeHealth(backendStreamId, 80),
    ])
    if (stats?.stream_status) setRuntimeStatus(mapBackendStreamStatus(stats.stream_status))
    if (health?.stream_status) setRuntimeStatus(mapBackendStreamStatus(health.stream_status))
  }, [backendStreamId])

  useEffect(() => {
    void refreshRuntimeSnapshot()
  }, [refreshRuntimeSnapshot])

  const updateConnector = useCallback((patch: Partial<WizardState['connector']>) => {
    setState((prev) => (prev ? { ...prev, connector: { ...prev.connector, ...patch } } : prev))
  }, [])
  const updateStreamConfig = useCallback((patch: Partial<WizardState['stream']>) => {
    setState((prev) => (prev ? { ...prev, stream: { ...prev.stream, ...patch } } : prev))
  }, [])
  const updateApiTest = useCallback((next: WizardState['apiTest']) => {
    setState((prev) =>
      prev
        ? {
            ...prev,
            apiTest: next,
            stream: mergeStreamSampleConfirmations(prev.stream, next),
          }
        : prev,
    )
  }, [])
  const patchStream = useCallback((patch: Partial<WizardState['stream']>) => {
    setState((prev) => (prev ? { ...prev, stream: { ...prev.stream, ...patch } } : prev))
  }, [])

  const setEventArrayPath = useCallback((path: string) => {
    setState((prev) => {
      if (!prev) return prev
      const raw = prev.apiTest.parsedJson ?? prev.apiTest.rawResponse
      const rawObj = raw !== null && typeof raw === 'object' ? raw : null
      const normalized = normalizeEventArrayPath(path) || (Array.isArray(rawObj) ? '$' : '')
      const useWhole = normalized.length === 0
      const nextStream = {
        ...prev.stream,
        eventArrayPath: normalized,
        useWholeResponseAsEvent: useWhole,
        eventRootPath: '',
        eventRootConfirmedForApiTestAt: null,
      }
      const extracted = wizardExtractEvents(rawObj, normalized, '')
      const mergedStream = mergeStreamSampleConfirmations(nextStream, prev.apiTest)
      return {
        ...prev,
        stream: mergedStream,
        apiTest: {
          ...prev.apiTest,
          ...buildApiTestExtractedEventsPatch(extracted, prev.apiTest.analysis, {
            stream: mergedStream,
            apiTest: prev.apiTest,
          }),
        },
      }
    })
  }, [])

  const setEventRootPath = useCallback((path: string) => {
    setState((prev) => {
      if (!prev) return prev
      const normalized = normalizeEventRootPath(path)
      const nextStream = mergeStreamSampleConfirmations(
        { ...prev.stream, eventRootPath: normalized },
        prev.apiTest,
      )
      return { ...prev, stream: nextStream }
    })
  }, [])

  const setCheckpoint = useCallback(
    (patch: Partial<Pick<WizardConfigState, 'checkpointFieldType' | 'checkpointSourcePath'>>) => {
      setState((prev) => {
        if (!prev) return prev
        let checkpointSourcePath = patch.checkpointSourcePath ?? prev.stream.checkpointSourcePath
        if (patch.checkpointSourcePath !== undefined && checkpointSourcePath.trim()) {
          const rawPath = checkpointSourcePath.trim()
          const arrayPath = prev.stream.eventArrayPath.trim() || '$'
          if (rawPath.startsWith('$') && /\[\d+\]/.test(rawPath)) {
            checkpointSourcePath = checkpointPathFromClick(rawPath, arrayPath, 0)
          } else {
            checkpointSourcePath = normalizeCheckpointRelativePath(rawPath)
          }
        }
        return {
          ...prev,
          stream: mergeStreamSampleConfirmations(prev.stream, prev.apiTest, {
            ...patch,
            ...(patch.checkpointSourcePath !== undefined ? { checkpointSourcePath } : {}),
          }),
        }
      })
    },
    [],
  )

  const loadOperationalSample = useCallback((id: OperationalSampleId) => {
    const sample = getOperationalSample(id)
    const startedAt = Date.now()
    const analysis = buildAnalysisForSample(sample, '', '')
    const samplePatch = buildApiTestSuccessPatch(sample.payload, analysis)
    setOperationalSampleId(id)
    setState((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        stream: {
          ...prev.stream,
          eventArrayPath: '',
          eventRootPath: '',
          useWholeResponseAsEvent: false,
          checkpointSourcePath: '',
          checkpointFieldType: '',
          recordPathConfirmedForApiTestAt: null,
          eventRootConfirmedForApiTestAt: null,
          checkpointConfirmedForApiTestAt: null,
        },
        apiTest: {
          ...prev.apiTest,
          status: 'success',
          ok: true,
          requestUrl: `local://operational-sample/${id}`,
          method: prev.stream.httpMethod,
          statusCode: 200,
          responseHeaders: { 'x-operational-sample': id },
          rawBody: JSON.stringify(sample.payload),
          parsedJson: sample.payload,
          rawResponse: sample.payload,
          ...samplePatch,
          analysis,
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
          s3ConnectivityPassed: false,
          remoteProbe: null,
        },
      }
    })
  }, [])

  const setMapping = useCallback((mapping: WizardState['mapping']) => {
    setState((prev) => (prev ? { ...prev, mapping } : prev))
  }, [])
  const setMappingMode = useCallback((mappingMode: WizardState['mappingMode']) => {
    setState((prev) => (prev ? { ...prev, mappingMode } : prev))
  }, [])
  const setFullEventJsonata = useCallback((fullEventJsonataExpression: string) => {
    setState((prev) => (prev ? { ...prev, fullEventJsonataExpression } : prev))
  }, [])
  const setFullEventRegexConfigJson = useCallback((fullEventRegexConfigJson: string) => {
    setState((prev) => (prev ? { ...prev, fullEventRegexConfigJson } : prev))
  }, [])
  const setEnrichment = useCallback((enrichment: WizardState['enrichment']) => {
    setState((prev) => (prev ? { ...prev, enrichment } : prev))
  }, [])
  const setUnmappedFieldsPolicy = useCallback((unmappedFieldsPolicy: WizardState['unmappedFieldsPolicy']) => {
    setState((prev) => (prev ? { ...prev, unmappedFieldsPolicy } : prev))
  }, [])
  const setDataProtection = useCallback((dataProtection: WizardState['dataProtection']) => {
    setState((prev) => (prev ? { ...prev, dataProtection } : prev))
  }, [])
  const setDestinations = useCallback((destinations: WizardState['destinations']) => {
    setState((prev) => (prev ? { ...prev, destinations } : prev))
  }, [])

  const navigateToWizardStep = useCallback(
    (key: WizardStepKey) => {
      const idx = wizardStepIndexForKey(wizardSteps, key)
      if (idx >= 0) setStepIndex(idx)
    },
    [wizardSteps],
  )

  const navigateToLegacySubstep = useCallback(
    (legacyKey: WizardLegacySubstepKey) => {
      if (legacyKey === 'data_protection') setDataProtectionDrawerOpen(true)
      navigateToWizardStep(legacySubstepToWizardStep(legacyKey))
    },
    [navigateToWizardStep],
  )

  const handleSave = useCallback(async () => {
    if (!state || backendStreamId == null || isSaving) return
    setIsSaving(true)
    setSaveError(null)
    setSaveSuccess(null)
    const result = await persistWizardStreamEdits(backendStreamId, state)
    if (result.ok) {
      saveSnapshotRef.current = JSON.stringify(state)
      setSaveSuccess('Changes saved.')
      window.setTimeout(() => setSaveSuccess(null), 3000)
    } else {
      setSaveError(result.errors.join(' · ') || 'Save failed.')
    }
    setIsSaving(false)
  }, [backendStreamId, isSaving, state])

  useEffect(() => {
    if (!state || backendStreamId == null || isSaving) return
    const snapshot = JSON.stringify(state)
    if (snapshot === saveSnapshotRef.current) return
    const timer = window.setTimeout(() => {
      void handleSave()
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [backendStreamId, handleSave, isSaving, state])

  const runStreamControl = useCallback(
    async (action: 'start' | 'stop') => {
      if (backendStreamId == null || controlBusy || runOnceBusy) return
      setControlBusy(true)
      setControlMessage(null)
      const res =
        action === 'start' ? await startRuntimeStream(backendStreamId) : await stopRuntimeStream(backendStreamId)
      if (res) {
        setControlMessage(res.message)
        await refreshRuntimeSnapshot()
        const found = await fetchStreamById(backendStreamId)
        if (found?.status) setRuntimeStatus(mapBackendStreamStatus(found.status))
      } else {
        setControlMessage('Runtime API unavailable · control action not applied.')
      }
      setControlBusy(false)
    },
    [backendStreamId, controlBusy, runOnceBusy, refreshRuntimeSnapshot],
  )

  const executeRunOnce = useCallback(async () => {
    if (backendStreamId == null || runOnceBusy || controlBusy) return
    setRunOnceBusy(true)
    setRunOnceNotice(null)
    try {
      const response = await runStreamOnce(backendStreamId)
      setRunOnceNotice({ variant: 'success', lines: formatRunOnceSummaryLines(response) })
      await refreshRuntimeSnapshot()
    } catch (error) {
      setRunOnceNotice({ variant: 'error', lines: formatRunOnceErrorLines(error) })
    } finally {
      setRunOnceBusy(false)
    }
  }, [backendStreamId, controlBusy, refreshRuntimeSnapshot, runOnceBusy])

  const handleStart = useCallback(async () => {
    if (backendStreamId == null || isStarting) return
    setIsStarting(true)
    await startRuntimeStream(backendStreamId)
    await refreshRuntimeSnapshot()
    setIsStarting(false)
  }, [backendStreamId, isStarting, refreshRuntimeSnapshot])

  const headerStatus = runtimeStatus
  const headerStatusTone =
    headerStatus === 'ERROR'
      ? 'error'
      : headerStatus === 'DEGRADED'
        ? 'warning'
        : headerStatus === 'RUNNING'
          ? 'success'
          : 'neutral'

  const operationalBadges = useMemo(
    () => buildOperationalStreamBadges(state?.stream.name ?? streamId, state?.connector.sourceType),
    [state?.connector.sourceType, state?.stream.name, streamId],
  )
  const runControlTooltipExtra = operationalRunControlTooltipSupplement(state?.stream.name ?? streamId)

  const saveStateLabel = isSaving
    ? 'Auto-saving…'
    : saveError
      ? 'Auto-save failed'
      : saveSuccess
        ? 'Changes saved'
        : 'Auto-save enabled'

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-violet-600" aria-hidden />
      </div>
    )
  }

  if (loadError || !state || !completion) {
    return (
      <div className="rounded-lg border border-red-200/80 bg-red-500/[0.06] p-4 text-[13px] text-red-800 dark:border-red-500/35 dark:bg-red-500/10 dark:text-red-200">
        {loadError ?? 'Unable to open stream editor.'}
      </div>
    )
  }

  const nextLabel = EDIT_NEXT_STEP_LABEL[currentStepKey]

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 pb-8">
      <nav className="flex flex-wrap items-center gap-1 text-[12px]" aria-label="Page breadcrumb">
        <Link to={NAV_PATH.streams} className="font-medium text-violet-700 hover:underline dark:text-violet-300">
          Streams
        </Link>
        <span className="text-slate-400 dark:text-gdc-muted" aria-hidden>
          /
        </span>
        <Link to={streamRuntimePath(streamId)} className="font-medium text-violet-700 hover:underline dark:text-violet-300">
          {state.stream.name}
        </Link>
        <span className="text-slate-400 dark:text-gdc-muted" aria-hidden>
          /
        </span>
        <span className="font-semibold text-slate-700 dark:text-slate-200">Edit</span>
      </nav>

      <header className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">Edit Stream</h2>
            <StatusBadge tone={headerStatusTone} className="font-bold uppercase tracking-wide">
              {headerStatus}
            </StatusBadge>
            <StreamOperationalBadges badges={operationalBadges} />
          </div>
          <p className="max-w-2xl text-[13px] text-slate-600 dark:text-gdc-muted">
            {wizardSteps.map((step) => step.title).join(' → ')}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-gdc-muted">API-backed stream · changes auto-save to the platform</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span
            className="inline-flex h-8 items-center rounded-full border border-slate-200/90 bg-slate-50 px-2.5 text-[11px] font-semibold text-slate-700 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
            aria-live="polite"
          >
            {saveStateLabel}
          </span>
          <button
            type="button"
            disabled={controlBusy || runOnceBusy}
            onClick={() => void runStreamControl('start')}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-emerald-200/90 bg-emerald-500/[0.08] px-3 text-[12px] font-semibold text-emerald-800 hover:bg-emerald-500/[0.14] disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
            title={runControlTooltipExtra ? `Start Stream — ${runControlTooltipExtra}` : 'Start Stream'}
          >
            <Play className="h-3.5 w-3.5" aria-hidden />
            Start
          </button>
          <button
            type="button"
            disabled={controlBusy || runOnceBusy}
            onClick={() => void runStreamControl('stop')}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-red-200/90 bg-red-500/[0.07] px-3 text-[12px] font-semibold text-red-800 hover:bg-red-500/[0.12] disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"
          >
            <Square className="h-3.5 w-3.5" aria-hidden />
            Stop
          </button>
          <button
            type="button"
            disabled={controlBusy || runOnceBusy}
            onClick={() => void executeRunOnce()}
            className="inline-flex h-9 items-center rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {runOnceBusy ? 'Running…' : 'Run Now'}
          </button>
          <button
            type="button"
            onClick={() => navigate(streamRuntimePath(streamId))}
            className="inline-flex h-9 items-center rounded-md border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-200"
          >
            Back to monitoring
          </button>
        </div>
      </header>

      {saveError ? (
        <p className="rounded-md border border-red-200/80 bg-red-500/[0.06] p-3 text-[12px] font-medium text-red-700 dark:border-red-500/40 dark:text-red-300">
          {saveError}
        </p>
      ) : null}
      {controlMessage ? <p className="text-[11px] font-medium text-slate-600 dark:text-gdc-mutedStrong">{controlMessage}</p> : null}
      {runOnceNotice ? (
        <div
          className={cn(
            'rounded-md border px-3 py-2 text-[11px]',
            runOnceNotice.variant === 'success'
              ? 'border-emerald-300/70 bg-emerald-500/[0.06] text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100'
              : 'border-red-300/70 bg-red-500/[0.06] text-red-950 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100',
          )}
        >
          {runOnceNotice.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}

      <WizardStepper
        wizardSteps={wizardSteps}
        stepIndex={stepIndex}
        setStepIndex={setStepIndex}
        completion={completion}
        state={state}
        reachability={{ editMode: true }}
      />

      <main>
        {currentStepKey === 'connect' ? (
          <StepConnect
            state={state}
            connectorReadonly
            onConnectorChange={updateConnector}
            onStreamChange={updateStreamConfig}
          />
        ) : null}
        {currentStepKey === 'sample' ? (
          <StepSample
            state={state}
            onApiTestChange={updateApiTest}
            onStreamPatch={patchStream}
            onSetEventArrayPath={setEventArrayPath}
            onSetEventRootPath={setEventRootPath}
            onSetCheckpoint={setCheckpoint}
            onLoadOperationalSample={loadOperationalSample}
            activeOperationalSampleId={operationalSampleId}
          />
        ) : null}
        {currentStepKey === 'destinations' ? <StepDelivery state={state} onChange={setDestinations} /> : null}
        {currentStepKey === 'route_processing' ? (
          <StepRouteProcessing
            state={state}
            onChangeMapping={setMapping}
            onChangeMappingMode={setMappingMode}
            onChangeFullEventJsonata={setFullEventJsonata}
            onChangeFullEventRegexConfigJson={setFullEventRegexConfigJson}
            onChangeEnrichment={setEnrichment}
            onChangeUnmappedFieldsPolicy={setUnmappedFieldsPolicy}
            onChangeDataProtection={setDataProtection}
            onChangeDestinations={setDestinations}
            dataProtectionDrawerOpen={dataProtectionDrawerOpen}
            onDataProtectionDrawerOpenChange={setDataProtectionDrawerOpen}
          />
        ) : null}
        {currentStepKey === 'deploy' ? (
          <StepDeploy
            state={state}
            isStarting={isStarting}
            onStart={() => void handleStart()}
            onNavigateToLegacySubstep={navigateToLegacySubstep}
          />
        ) : null}
      </main>

      <nav
        className="sticky bottom-0 z-20 mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 bg-white/95 py-3 backdrop-blur-sm dark:border-gdc-border dark:bg-gdc-section"
        aria-label="Edit stream navigation"
      >
        <button
          type="button"
          onClick={() => setStepIndex((idx) => Math.max(0, idx - 1))}
          disabled={stepIndex === 0}
          className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          Back
        </button>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving}
            className="inline-flex h-9 items-center rounded-md border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
          >
            {isSaving ? 'Saving…' : 'Save now'}
          </button>
          {stepIndex < wizardSteps.length - 1 ? (
            <button
              type="button"
              onClick={() => setStepIndex((idx) => Math.min(wizardSteps.length - 1, idx + 1))}
              className="inline-flex h-9 items-center gap-1 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white shadow-sm hover:bg-violet-700"
            >
              {nextLabel ?? 'Next'}
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : (
            <Link
              to={streamRuntimePath(streamId)}
              className="inline-flex h-9 items-center gap-1 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white shadow-sm hover:bg-violet-700"
            >
              Open monitoring
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          )}
        </div>
      </nav>
    </div>
  )
}
