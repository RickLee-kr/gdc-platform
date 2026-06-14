import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Loader2,
  Play,
  Rocket,
  Zap,
} from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { fetchDestinationsList, type DestinationListItem } from '../../../api/gdcDestinations'
import { runStreamOnce } from '../../../api/gdcRuntime'
import {
  connectorDetailPath,
  logsExplorerPath,
  NAV_PATH,
  runtimeOverviewPath,
  streamEditPath,
  streamRuntimePath,
} from '../../../config/nav-paths'
import { cn } from '../../../lib/utils'
import { WIZARD_LABEL } from '../../../lib/operator-vocabulary'
import {
  computeDeployReadiness,
  type DeployChecklistCategory,
  type DeployReadinessSnapshot,
} from './wizard-deploy-readiness'
import { DataProtectionReviewSummary } from './data-protection-review-summary'
import {
  buildFullRequestUrl,
  effectiveRequestHeaders,
  wizardEffectiveMappedFieldCount,
  type AuthType,
  type WizardLegacySubstepKey,
  type WizardState,
} from './wizard-state'

export type StepDeployProps = {
  state: WizardState
  busy?: boolean
  isStarting?: boolean
  onStart: () => void
  onNavigateToLegacySubstep: (key: WizardLegacySubstepKey) => void
}

function formatScheduleHuman(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '—'
  if (sec % 3600 === 0) return `Every ${sec / 3600} hour${sec === 3600 ? '' : 's'}`
  if (sec % 60 === 0) {
    const m = sec / 60
    return `Every ${m} minute${m === 1 ? '' : 's'}`
  }
  return `Every ${sec} seconds`
}

function formatTimestamp(ms: number | null): string {
  if (ms == null) return '—'
  try {
    return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return '—'
  }
}

function formatIsoDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })
  } catch {
    return '—'
  }
}

function formatStreamDisplayId(id: number, createdIso?: string | null): string {
  let y = new Date().getFullYear()
  if (createdIso) {
    try {
      y = new Date(createdIso).getFullYear()
    } catch {
      /* keep current year */
    }
  }
  return `STR-${y}-${String(id).padStart(6, '0')}`
}

function authTypeLabel(authType: AuthType): string {
  switch (authType) {
    case 'NO_AUTH':
      return 'No auth'
    case 'API_KEY':
      return 'API Key'
    case 'OAUTH2_CLIENT_CREDENTIALS':
      return 'OAuth2'
    case 'JWT_REFRESH_TOKEN':
      return 'JWT refresh'
    case 'SESSION_LOGIN':
      return 'Session login'
    default:
      return authType.replace(/_/g, ' ')
  }
}

const EditLink = memo(function EditLink({
  stepKey,
  label,
  onNavigateToLegacySubstep,
}: {
  stepKey: WizardLegacySubstepKey
  label?: string
  onNavigateToLegacySubstep: (k: WizardLegacySubstepKey) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onNavigateToLegacySubstep(stepKey)}
      className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
    >
      {label ?? 'Edit'}
      <ChevronRight className="h-3 w-3" aria-hidden />
    </button>
  )
})

function DeployStatusBanner({ readiness }: { readiness: DeployReadinessSnapshot }) {
  const tone =
    readiness.status === 'ready'
      ? 'ok'
      : readiness.status === 'ready_with_warnings'
        ? 'warn'
        : 'err'

  const description =
    readiness.status === 'ready'
      ? 'Your stream configuration is valid. Create & Start Stream to begin collecting events.'
      : readiness.status === 'ready_with_warnings'
        ? 'Minimum requirements are met, but some checklist items need attention. You may still deploy.'
        : 'Complete required wizard steps before creating this stream.'

  return (
    <section
      className={cn(
        'rounded-xl border p-4 shadow-sm',
        tone === 'ok'
          ? 'border-emerald-200/80 bg-emerald-500/[0.07] dark:border-emerald-500/30 dark:bg-emerald-500/10'
          : tone === 'warn'
            ? 'border-amber-200/80 bg-amber-500/[0.06] dark:border-amber-500/35 dark:bg-amber-500/10'
            : 'border-red-200/80 bg-red-500/[0.06] dark:border-red-500/35 dark:bg-red-500/10',
      )}
      data-testid="deploy-status-banner"
    >
      <div className="flex flex-wrap items-start gap-3">
        <span
          className={cn(
            'inline-flex rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide',
            tone === 'ok'
              ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200'
              : tone === 'warn'
                ? 'bg-amber-500/15 text-amber-900 dark:text-amber-100'
                : 'bg-red-500/15 text-red-800 dark:text-red-200',
          )}
          data-testid="deploy-status-label"
        >
          {readiness.statusLabel}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-50">Deployment readiness</p>
          <p className="mt-1 text-[12px] leading-relaxed text-slate-700 dark:text-gdc-mutedStrong">{description}</p>
        </div>
        {tone === 'ok' ? (
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
        ) : (
          <AlertTriangle
            className={cn(
              'h-5 w-5 shrink-0',
              tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400',
            )}
            aria-hidden
          />
        )}
      </div>
    </section>
  )
}

function DeployChecklist({
  categories,
  onNavigateToLegacySubstep,
}: {
  categories: DeployChecklistCategory[]
  onNavigateToLegacySubstep: (key: WizardLegacySubstepKey) => void
}) {
  return (
    <section
      className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card"
      data-testid="deploy-checklist"
    >
      <h4 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Deployment checklist</h4>
      <ul className="mt-3 space-y-2">
        {categories.map((category) => (
          <li
            key={category.key}
            className="flex items-start justify-between gap-3 rounded-lg border border-slate-100/90 px-3 py-2.5 text-[12px] dark:border-gdc-border"
            data-testid={`deploy-checklist-${category.key}`}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                {category.tone === 'ok' ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                ) : category.tone === 'warn' ? (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
                )}
                <span>{category.label}</span>
              </div>
              <p className="mt-0.5 pl-6 text-[11px] text-slate-600 dark:text-gdc-muted">{category.summary}</p>
              {category.detail ? (
                <p className="mt-0.5 pl-6 text-[10px] text-slate-500 dark:text-gdc-muted">{category.detail}</p>
              ) : null}
            </div>
            <EditLink stepKey={category.stepKey} onNavigateToLegacySubstep={onNavigateToLegacySubstep} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function DeployConfigurationSummary({
  state,
  destinations,
  onNavigateToLegacySubstep,
}: {
  state: WizardState
  destinations: DestinationListItem[]
  onNavigateToLegacySubstep: (key: WizardLegacySubstepKey) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isRemote = state.connector.sourceType === 'REMOTE_FILE_POLLING'
  const fullUrl = buildFullRequestUrl(state.connector.hostBaseUrl, state.stream.endpoint)
  const mergedHeaders = effectiveRequestHeaders(state.connector, state.stream)
  const mappedCount = wizardEffectiveMappedFieldCount(state)
  const enrichmentCount = state.enrichment.filter((e) => e.fieldName.trim()).length
  const routeDrafts = state.destinations.routeDrafts
  const enabledRoutes = routeDrafts.filter((r) => r.enabled).length
  const destById = useMemo(() => new Map(destinations.map((d) => [d.id, d])), [destinations])
  const eventArrayDisplay = state.stream.useWholeResponseAsEvent
    ? '(whole document)'
    : state.stream.eventArrayPath.trim()
      ? state.stream.eventArrayPath.trim().startsWith('$')
        ? state.stream.eventArrayPath.trim()
        : `$.${state.stream.eventArrayPath.trim()}`
      : '—'

  const templateMaterializationActive =
    state.connector.registryModuleId != null && state.connector.selectedTemplateIds.length > 0

  return (
    <section
      className="rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card"
      data-testid="deploy-configuration-summary"
    >
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        aria-expanded={expanded}
      >
        <span className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Configuration Summary</span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-slate-500 transition-transform', expanded && 'rotate-180')}
          aria-hidden
        />
      </button>
      {expanded ? (
        <div className="space-y-4 border-t border-slate-100 px-4 py-4 dark:border-gdc-border">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryChip label="Stream" value={state.stream.name.trim() || '—'} />
            <SummaryChip label="Schedule" value={formatScheduleHuman(state.stream.pollingIntervalSec)} />
            <SummaryChip label="Mapped outputs" value={String(mappedCount)} />
            <SummaryChip label="Transform rules" value={String(enrichmentCount)} />
          </div>

          {templateMaterializationActive ? (
            <div
              className="rounded-lg border border-violet-200/80 bg-violet-50/50 p-3 dark:border-violet-500/30 dark:bg-violet-500/5"
              data-testid="deploy-template-materialization"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Template materialization</p>
                <EditLink stepKey="connector" label="Edit templates" onNavigateToLegacySubstep={onNavigateToLegacySubstep} />
              </div>
              <p className="mt-1 text-[11px] text-slate-600 dark:text-gdc-muted">
                Module{' '}
                <span className="font-mono text-violet-700 dark:text-violet-300">{state.connector.registryModuleId}</span>
              </p>
              <ul className="mt-2 space-y-1">
                {state.connector.selectedTemplateIds.map((templateId) => (
                  <li
                    key={templateId}
                    className="rounded-md border border-slate-200/80 bg-white px-2.5 py-1.5 text-[11px] dark:border-gdc-border dark:bg-gdc-card"
                    data-testid={`deploy-template-row-${templateId}`}
                  >
                    {templateId}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <ConfigBlock title="Connection" edit={<EditLink stepKey="connector" onNavigateToLegacySubstep={onNavigateToLegacySubstep} />}>
              <ConfigRow label={WIZARD_LABEL.sourceConnection} value={state.connector.connectorName.trim() || '—'} />
              <ConfigRow label="Auth" value={authTypeLabel(state.connector.authType)} />
              <ConfigRow
                label="Last tested"
                value={state.apiTest.status === 'success' ? formatTimestamp(state.apiTest.finishedAt) : '—'}
              />
            </ConfigBlock>

            <ConfigBlock title={isRemote ? 'Remote files' : 'Request'} edit={<EditLink stepKey="stream" onNavigateToLegacySubstep={onNavigateToLegacySubstep} />}>
              {isRemote ? (
                <>
                  <ConfigRow label="Directory" value={state.stream.remoteDirectory.trim() || '—'} mono />
                  <ConfigRow label="File pattern" value={state.stream.filePattern.trim() || '*'} mono />
                </>
              ) : (
                <>
                  <ConfigRow label="Method" value={state.stream.httpMethod} />
                  <ConfigRow label="URL" value={fullUrl || '—'} mono />
                  <ConfigRow label="Headers" value={Object.keys(mergedHeaders).length ? Object.keys(mergedHeaders).join(', ') : 'None'} />
                </>
              )}
              <ConfigRow label="Record path" value={eventArrayDisplay} mono />
            </ConfigBlock>

            <ConfigBlock title={WIZARD_LABEL.syncPosition} edit={<EditLink stepKey="preview" onNavigateToLegacySubstep={onNavigateToLegacySubstep} />}>
              <ConfigRow
                label={WIZARD_LABEL.checkpointField}
                value={state.stream.checkpointSourcePath.trim() || 'Not set'}
                mono
              />
              <ConfigRow label={WIZARD_LABEL.checkpointType} value={state.stream.checkpointFieldType || '—'} />
            </ConfigBlock>

            <ConfigBlock title="Delivery" edit={<EditLink stepKey="destinations" onNavigateToLegacySubstep={onNavigateToLegacySubstep} />}>
              <ConfigRow label={WIZARD_LABEL.deliveryPaths} value={`${routeDrafts.length} total · ${enabledRoutes} enabled`} />
              {routeDrafts.slice(0, 3).map((route) => {
                const dest = destById.get(route.destinationId)
                return (
                  <ConfigRow
                    key={route.key}
                    label={dest?.name?.trim() || `Destination #${route.destinationId}`}
                    value={route.enabled ? 'Enabled' : 'Disabled'}
                  />
                )
              })}
            </ConfigBlock>

            <div
              className="rounded-lg border border-slate-200/80 p-3 dark:border-gdc-border lg:col-span-2"
              data-testid="deploy-data-protection"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <DataProtectionReviewSummary dataProtection={state.dataProtection} />
                <EditLink stepKey="mapping" label="Edit" onNavigateToLegacySubstep={onNavigateToLegacySubstep} />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function DeployCreatedPanel({
  state,
  isStarting,
  onStart,
  onNavigateToLegacySubstep,
}: {
  state: WizardState
  isStarting: boolean
  onStart: () => void
  onNavigateToLegacySubstep: (key: WizardLegacySubstepKey) => void
}) {
  const outcome = state.outcome
  const streamNumericId = outcome?.streamId ?? null
  const streamSlug = streamNumericId != null ? String(streamNumericId) : 'new'
  const displayId =
    streamNumericId != null ? formatStreamDisplayId(streamNumericId, outcome?.createdAt ?? null) : '—'
  const [copyFlash, setCopyFlash] = useState(false)
  const [runBusy, setRunBusy] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  const handleCopyId = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(displayId)
        setCopyFlash(true)
        window.setTimeout(() => setCopyFlash(false), 1600)
      }
    } catch {
      /* ignore */
    }
  }, [displayId])

  const handleRunOnce = useCallback(async () => {
    if (streamNumericId == null || runBusy) return
    setRunBusy(true)
    setRunError(null)
    try {
      await runStreamOnce(streamNumericId)
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunBusy(false)
    }
  }, [runBusy, streamNumericId])

  const createdTone =
    (outcome?.errors?.length ?? 0) > 0 || (outcome?.dataProtectionWarnings?.length ?? 0) > 0
      ? 'warning'
      : 'success'

  return (
    <section
      className={cn(
        'rounded-xl border p-4 shadow-sm',
        createdTone === 'success'
          ? 'border-emerald-200/90 bg-white dark:border-emerald-500/25 dark:bg-gdc-card'
          : 'border-amber-200/90 bg-white dark:border-amber-500/25 dark:bg-gdc-card',
      )}
      data-testid="deploy-created-panel"
    >
      <div className="flex items-start gap-3">
        {createdTone === 'success' ? (
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
        ) : (
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        )}
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              {createdTone === 'success' ? 'Stream created successfully' : 'Stream created with warnings'}
            </h4>
            <p className="mt-0.5 text-[12px] text-slate-600 dark:text-gdc-muted">
              {state.startMessage?.trim() || 'Your stream is ready. Use the actions below to verify delivery or open runtime.'}
            </p>
          </div>

          {streamNumericId != null ? (
            <div className="flex flex-wrap items-center gap-3 text-[12px]">
              <div>
                <span className="font-medium text-slate-500 dark:text-gdc-muted">Stream ID </span>
                <span className="font-mono font-semibold text-slate-800 dark:text-slate-100">{displayId}</span>
                <button
                  type="button"
                  onClick={() => void handleCopyId()}
                  className="ml-2 inline-flex items-center gap-1 rounded-md border border-slate-200/90 bg-white px-2 py-0.5 text-[11px] font-semibold text-violet-700 hover:bg-slate-50 dark:border-gdc-borderStrong dark:bg-gdc-elevated dark:text-violet-300"
                >
                  <ClipboardCopy className="h-3 w-3" aria-hidden />
                  {copyFlash ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div>
                <span className="font-medium text-slate-500 dark:text-gdc-muted">Created </span>
                <span className="text-slate-800 dark:text-slate-100">{formatIsoDate(outcome?.createdAt ?? null)}</span>
              </div>
            </div>
          ) : null}

          {outcome?.errors?.length ? (
            <ul className="list-disc space-y-1 pl-5 text-[11px] text-amber-900 dark:text-amber-100">
              {outcome.errors.map((error, idx) => (
                <li key={idx} className="break-words">
                  {error}
                </li>
              ))}
            </ul>
          ) : null}

          {outcome?.dataProtectionWarnings?.length ? (
            <ul
              className="list-disc space-y-1 pl-5 text-[11px] text-amber-900 dark:text-amber-100"
              data-testid="deploy-data-protection-warnings"
            >
              {outcome.dataProtectionWarnings.map((warning, idx) => (
                <li key={idx} className="break-words">
                  {warning}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onStart()}
              disabled={streamNumericId == null || isStarting}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isStarting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Zap className="h-3.5 w-3.5" aria-hidden />}
              {isStarting ? 'Starting…' : 'Start Stream'}
            </button>
            <button
              type="button"
              onClick={() => void handleRunOnce()}
              disabled={streamNumericId == null || runBusy}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-slate-800 shadow-sm hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
            >
              {runBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
              {runBusy ? 'Running…' : 'Run Once'}
            </button>
            {streamNumericId != null ? (
              <>
                <Link
                  to={streamRuntimePath(streamSlug)}
                  className="inline-flex h-9 items-center rounded-md border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-violet-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-violet-300"
                >
                  Open runtime
                </Link>
                <Link
                  to={streamEditPath(streamSlug)}
                  className="inline-flex h-9 items-center rounded-md border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
                >
                  Edit stream
                </Link>
                <Link
                  to={logsExplorerPath({ stream_id: streamNumericId })}
                  className="inline-flex h-9 items-center rounded-md border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
                >
                  View logs
                </Link>
                {state.connector.connectorId != null ? (
                  <Link
                    to={connectorDetailPath(String(state.connector.connectorId))}
                    className="inline-flex h-9 items-center rounded-md border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
                  >
                    Source connection
                  </Link>
                ) : null}
                <Link
                  to={runtimeOverviewPath({ stream_id: streamNumericId })}
                  className="inline-flex h-9 items-center rounded-md border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
                >
                  Delivery paths
                </Link>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => onNavigateToLegacySubstep('mapping')}
              className="inline-flex h-9 items-center rounded-md border border-transparent px-1 text-[12px] font-semibold text-slate-600 hover:text-slate-900 dark:text-gdc-muted dark:hover:text-slate-100"
            >
              Back to Transform
            </button>
          </div>
          {runError ? (
            <p className="text-[11px] font-medium text-red-700 dark:text-red-300">{runError}</p>
          ) : null}
        </div>
      </div>
    </section>
  )
}

export function StepDeploy({
  state,
  busy = false,
  isStarting = false,
  onStart,
  onNavigateToLegacySubstep,
}: StepDeployProps) {
  const created = state.outcome?.streamId != null
  const [destinations, setDestinations] = useState<DestinationListItem[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const rows = await fetchDestinationsList()
      if (!cancelled) setDestinations(rows)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const connectivityForRoutes = useMemo(() => {
    const routeDrafts = state.destinations.routeDrafts
    if (routeDrafts.length === 0) return { ok: true, failed: false, unknown: false }
    const destById = new Map(destinations.map((d) => [d.id, d]))
    let failed = false
    let unknown = false
    for (const route of routeDrafts) {
      const meta = destById.get(route.destinationId)
      if (!meta) {
        unknown = true
        continue
      }
      if (meta.last_connectivity_test_success === false) failed = true
      else if (meta.last_connectivity_test_success !== true) unknown = true
    }
    return { ok: !failed && !unknown, failed, unknown }
  }, [destinations, state.destinations.routeDrafts])

  const readiness = useMemo(
    () => computeDeployReadiness(state, connectivityForRoutes),
    [connectivityForRoutes, state],
  )

  return (
    <div className="space-y-4" data-testid="wizard-step-deploy">
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-700 dark:text-violet-300">
          <Rocket className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 space-y-1">
          <h3 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">Deploy</h3>
          <p className="max-w-3xl text-[13px] leading-relaxed text-slate-600 dark:text-gdc-muted">
            Deployment Decision Center — review readiness, create the stream, and start delivery from one place.
          </p>
        </div>
      </header>

      {busy ? (
        <p className="flex items-center gap-2 rounded-md border border-violet-200/80 bg-violet-500/[0.06] px-3 py-2 text-[12px] text-violet-900 dark:border-violet-500/35 dark:text-violet-100">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Creating stream{isStarting ? ' and starting delivery' : ''}…
        </p>
      ) : null}

      {!created ? <DeployStatusBanner readiness={readiness} /> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {!created ? (
            <DeployChecklist categories={readiness.categories} onNavigateToLegacySubstep={onNavigateToLegacySubstep} />
          ) : (
            <DeployCreatedPanel
              state={state}
              isStarting={isStarting}
              onStart={onStart}
              onNavigateToLegacySubstep={onNavigateToLegacySubstep}
            />
          )}
          <DeployConfigurationSummary
            state={state}
            destinations={destinations}
            onNavigateToLegacySubstep={onNavigateToLegacySubstep}
          />
        </div>

        <aside className="space-y-4">
          <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
            <h4 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Quick summary</h4>
            <ul className="mt-3 space-y-2 text-[11px] text-slate-700 dark:text-gdc-mutedStrong">
              <SummaryLine label="Stream name" value={state.stream.name.trim() || '—'} />
              <SummaryLine label={WIZARD_LABEL.deliveryPaths} value={String(state.destinations.routeDrafts.length)} />
              <SummaryLine
                label={`Enabled ${WIZARD_LABEL.deliveryPaths.toLowerCase()}`}
                value={String(state.destinations.routeDrafts.filter((r) => r.enabled).length)}
              />
              <SummaryLine label="Output fields" value={String(wizardEffectiveMappedFieldCount(state))} />
            </ul>
          </section>

          {!created ? (
            <section className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-4 dark:border-gdc-border dark:bg-gdc-section">
              <p className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Primary action</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-600 dark:text-gdc-muted">
                Use <span className="font-semibold text-slate-800 dark:text-slate-200">Create &amp; Start Stream</span>{' '}
                below to persist configuration and begin scheduled collection.
              </p>
              {!readiness.canCreate ? (
                <p className="mt-2 text-[11px] font-medium text-red-700 dark:text-red-300">
                  Resolve checklist items marked in red before deploying.
                </p>
              ) : null}
            </section>
          ) : null}

          <p className="text-[10px] text-slate-500 dark:text-gdc-muted">
            Manage destinations under{' '}
            <Link to={NAV_PATH.destinations} className="font-semibold text-violet-700 hover:underline dark:text-violet-300">
              Destinations
            </Link>
            .
          </p>
        </aside>
      </div>
    </div>
  )
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex justify-between gap-3">
      <span className="text-slate-600 dark:text-gdc-muted">{label}</span>
      <span className="font-semibold text-slate-900 dark:text-slate-100">{value}</span>
    </li>
  )
}

function SummaryChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200/80 bg-slate-50/80 px-3 py-2 dark:border-gdc-border dark:bg-gdc-elevated">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-[12px] font-semibold text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  )
}

function ConfigBlock({
  title,
  edit,
  children,
}: {
  title: string
  edit: ReactNode
  children: ReactNode
}) {
  return (
    <div className="rounded-lg border border-slate-200/80 p-3 dark:border-gdc-border">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
        {edit}
      </div>
      <dl className="mt-2 space-y-1.5">{children}</dl>
    </div>
  )
}

function ConfigRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-[10px] font-medium text-slate-500">{label}</dt>
      <dd className={cn('text-[11px] text-slate-800 dark:text-slate-200', mono && 'break-all font-mono')}>{value}</dd>
    </div>
  )
}
