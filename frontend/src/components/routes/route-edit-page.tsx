import { ArrowRight, HelpCircle, Play, Save, ShieldCheck, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { StatusBadge } from '../shell/status-badge'
import { PanelChrome } from '../streams/mapping-json-tree'
import { createRoute, fetchRouteById, updateRoute } from '../../api/gdcRoutes'
import { fetchStreamById } from '../../api/gdcStreams'
import { fetchConnectorById } from '../../api/gdcConnectors'
import { ROUTE_EDIT_DEFAULTS, type RouteDeliveryMode, type RouteFailurePolicy, type RouteRetryBackoff } from './route-edit-defaults'
import { streamRuntimePath } from '../../config/nav-paths'
import { RouteDetailHealthPanel } from './route-detail-health-panel'
import { fetchDestinationsList } from '../../api/gdcDestinations'

function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[11px] text-slate-600 dark:text-gdc-muted">
      <span className="font-semibold text-slate-700 dark:text-gdc-mutedStrong">{label}</span>
      {children}
      {hint ? <span className="text-[10px] text-slate-500">{hint}</span> : null}
    </label>
  )
}

const inputCls =
  'h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-900 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100'

export function RouteEditPage() {
  const { routeId = '' } = useParams<{ routeId: string }>()
  const backendRouteId = /^\d+$/.test(routeId) ? Number(routeId) : null
  const isCreateMode = backendRouteId == null
  const navigate = useNavigate()
  const d = ROUTE_EDIT_DEFAULTS

  const [routeName, setRouteName] = useState(d.routeName)
  const [description, setDescription] = useState(d.description)
  const [enabled, setEnabled] = useState(d.status === 'ENABLED')
  const [deliveryMode, setDeliveryMode] = useState<RouteDeliveryMode>(d.deliveryMode)
  const [failurePolicy, setFailurePolicy] = useState<RouteFailurePolicy>(d.failurePolicy)
  const [maxRetry, setMaxRetry] = useState(d.maxRetry)
  const [retryBackoff, setRetryBackoff] = useState<RouteRetryBackoff>(d.retryBackoff)
  const [initialBackoffSec, setInitialBackoffSec] = useState(d.initialBackoffSec)
  const [maxBackoffSec, setMaxBackoffSec] = useState(d.maxBackoffSec)
  const [maxDeliveryTimeSec, setMaxDeliveryTimeSec] = useState(d.maxDeliveryTimeSec)
  const [batchSize, setBatchSize] = useState(d.batchSize)
  const [rateLimitEnabled, setRateLimitEnabled] = useState(d.rateLimitEnabled)
  const [perSecond, setPerSecond] = useState(d.perSecond)
  const [burstSize, setBurstSize] = useState(d.burstSize)
  const [enrichmentProfile, setEnrichmentProfile] = useState(d.enrichmentProfile)
  const [filterJsonPath, setFilterJsonPath] = useState(d.filterJsonPath)
  const [backendStreamId, setBackendStreamId] = useState<number | null>(null)
  const [backendDestinationId, setBackendDestinationId] = useState<number | null>(null)
  const [destinationOptions, setDestinationOptions] = useState<Array<{ id: number; label: string }>>([])
  const [destinationSource, setDestinationSource] = useState<'api' | 'empty'>('empty')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  const [savedLocally, setSavedLocally] = useState(false)
  const [connectorLabel, setConnectorLabel] = useState('—')
  const [streamLabel, setStreamLabel] = useState('—')
  const destinationLabel = useMemo(() => {
    const found = destinationOptions.find((o) => o.id === backendDestinationId)
    return found?.label ?? '—'
  }, [destinationOptions, backendDestinationId])

  useEffect(() => {
    let cancelled = false
    if (backendRouteId == null) return
    ;(async () => {
      const found = await fetchRouteById(backendRouteId)
      if (!found || cancelled) return
      if (found.name) setRouteName(found.name)
      if (typeof found.description === 'string') setDescription(found.description)
      if (typeof found.enabled === 'boolean') setEnabled(found.enabled)
      if (typeof found.stream_id === 'number') setBackendStreamId(found.stream_id)
      if (typeof found.destination_id === 'number') setBackendDestinationId(found.destination_id)
      if (typeof found.failure_policy === 'string' && found.failure_policy.trim()) {
        if (found.failure_policy === 'retry') setFailurePolicy('Retry')
        else if (found.failure_policy === 'log_and_continue') setFailurePolicy('Log and Continue')
        else if (found.failure_policy === 'pause_stream') setFailurePolicy('Pause Stream')
        else if (found.failure_policy === 'disable_route') setFailurePolicy('Disable Route')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [backendRouteId])

  useEffect(() => {
    let cancelled = false
    if (backendStreamId == null) {
      setStreamLabel('—')
      setConnectorLabel('—')
      return
    }
    ;(async () => {
      const stream = await fetchStreamById(backendStreamId)
      if (cancelled || !stream) return
      setStreamLabel(stream.name?.trim() || `Stream #${stream.id}`)
      const cid = typeof stream.connector_id === 'number' ? stream.connector_id : null
      if (cid == null) {
        setConnectorLabel('—')
        return
      }
      const connector = await fetchConnectorById(cid)
      if (!cancelled) setConnectorLabel(connector?.name?.trim() || `Connector #${cid}`)
    })()
    return () => {
      cancelled = true
    }
  }, [backendStreamId])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const rows = await fetchDestinationsList()
      if (cancelled) return
      if (rows?.length) {
        const next = rows.map((d) => ({ id: d.id, label: (d.name ?? '').trim() || `Destination #${d.id}` }))
        setDestinationOptions(next)
        setDestinationSource('api')
        if (backendDestinationId == null) setBackendDestinationId(next[0]?.id ?? null)
        return
      }
      setDestinationOptions([])
      setDestinationSource('empty')
    })()
    return () => {
      cancelled = true
    }
  }, [backendDestinationId])

  async function handleSaveRoute() {
    if (isSaving) return
    setIsSaving(true)
    setSaveError(null)
    setSaveSuccess(null)
    setSavedLocally(false)
    try {
      const policy =
        failurePolicy === 'Retry'
          ? 'retry'
          : failurePolicy === 'Log and Continue'
            ? 'log_and_continue'
            : failurePolicy === 'Pause Stream'
              ? 'pause_stream'
              : 'disable_route'
      const routePayload = {
        name: routeName,
        description,
        enabled,
        stream_id: backendStreamId,
        destination_id: backendDestinationId,
        failure_policy: policy,
        status: enabled ? 'ENABLED' : 'DISABLED',
        formatter_config_json: {
          delivery_mode: deliveryMode,
          enrichment_profile: enrichmentProfile,
          filter_json_path: filterJsonPath,
        },
        rate_limit_json: rateLimitEnabled
          ? {
              enabled: true,
              per_second: perSecond,
              burst_size: burstSize,
              max_retry: maxRetry,
              retry_backoff: retryBackoff,
              initial_backoff_sec: initialBackoffSec,
              max_backoff_sec: maxBackoffSec,
              max_delivery_time_sec: maxDeliveryTimeSec,
              batch_size: batchSize,
            }
          : { enabled: false },
      }
      const saved = isCreateMode ? await createRoute(routePayload) : await updateRoute(backendRouteId, routePayload)
      const runtimeStreamId = typeof saved.stream_id === 'number' ? saved.stream_id : backendStreamId
      setSaveSuccess(isCreateMode ? 'Route created. Moving to stream runtime…' : 'Route saved. Moving to stream runtime…')
      if (typeof runtimeStreamId === 'number') navigate(streamRuntimePath(String(runtimeStreamId)))
      else navigate('/routes')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Route save failed.'
      setSaveError(`API save failed: ${message}`)
      setSaveSuccess('API unavailable. Changes kept locally only.')
      setSavedLocally(true)
    } finally {
      setIsSaving(false)
    }
  }

  const hasUnsavedChanges =
    routeName !== d.routeName ||
    description !== d.description ||
    enabled !== (d.status === 'ENABLED') ||
    deliveryMode !== d.deliveryMode ||
    failurePolicy !== d.failurePolicy

  return (
    <div className="w-full min-w-0 space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-200/70 bg-white/80 p-3 dark:border-gdc-border dark:bg-gdc-card">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">{isCreateMode ? 'New Route' : 'Edit Route'}</h2>
            <StatusBadge tone={enabled ? 'success' : 'neutral'}>{enabled ? 'ENABLED' : 'DISABLED'}</StatusBadge>
          </div>
          <p className="text-[13px] text-slate-600 dark:text-gdc-muted">
            Configure how data is delivered from the stream to the destination.
          </p>
          <p className="text-[11px] text-slate-500 dark:text-gdc-muted">
            Save state ·{' '}
            {isCreateMode ? 'API-backed (POST /api/v1/routes/)' : 'API-backed (PUT /api/v1/routes/{id})'}
          </p>
        </div>
        <div
          className="inline-flex h-7 items-center rounded-full border border-slate-200/90 bg-slate-50 px-2.5 text-[11px] font-semibold text-slate-700 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
          aria-live="polite"
        >
          {isSaving ? 'Saving…' : saveError ? 'Save failed' : saveSuccess ? 'Saved' : hasUnsavedChanges ? 'Unsaved changes' : 'Saved'}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-3 text-[12px] font-medium hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card"
          >
            <Play className="h-3.5 w-3.5" />
            Test Delivery
          </button>
          <button
            type="button"
            onClick={() => (backendStreamId != null ? navigate(streamRuntimePath(String(backendStreamId))) : navigate('/streams'))}
            className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-3 text-[12px] font-medium hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={() => void handleSaveRoute()}
            className="inline-flex h-8 items-center gap-1 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white hover:bg-violet-700"
          >
            <Save className="h-3.5 w-3.5" />
            {isSaving ? 'Saving…' : isCreateMode ? 'Create Route' : 'Save Route'}
          </button>
        </div>
      </header>
      {saveError ? <p className="text-[12px] font-medium text-red-700 dark:text-red-300">{saveError}</p> : null}
      {saveSuccess ? <p className="text-[12px] font-medium text-emerald-700 dark:text-emerald-300">{saveSuccess}</p> : null}
      {savedLocally ? <p className="text-[11px] text-slate-500 dark:text-gdc-muted">Route state is local only until the API is reachable.</p> : null}

      {!isCreateMode && backendRouteId != null ? (
        <RouteDetailHealthPanel routeId={backendRouteId} streamId={backendStreamId} />
      ) : null}

      <section className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200/70 bg-white/80 p-3 text-[12px] dark:border-gdc-border dark:bg-gdc-card md:grid-cols-4 xl:grid-cols-7">
        {[
          ['Connector', connectorLabel],
          ['Stream', streamLabel],
          ['Destination', destinationLabel],
          ['Route Status', enabled ? 'Enabled' : 'Disabled'],
          ['Delivery Mode', deliveryMode],
          ['Last Updated', '—'],
          ['Updated By', '—'],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
            <p className="truncate pt-0.5 font-medium text-slate-800 dark:text-slate-100">{value}</p>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 space-y-3 xl:col-span-9">
          <PanelChrome title="Route Information">
            <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-3">
              <Field label="Route Name *">
                <input value={routeName} onChange={(e) => setRouteName(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Description" >
                <input value={description} onChange={(e) => setDescription(e.target.value)} className={cn(inputCls, 'md:col-span-2')} />
              </Field>
              <Field label="Status">
                <button
                  type="button"
                  onClick={() => setEnabled((v) => !v)}
                  className={cn(
                    'inline-flex h-8 w-fit items-center rounded-full px-3 text-[11px] font-semibold',
                    enabled ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300' : 'bg-slate-500/15 text-slate-700 dark:text-gdc-mutedStrong',
                  )}
                >
                  {enabled ? 'Enabled' : 'Disabled'}
                </button>
              </Field>
              <Field label="Destination *">
                <select
                  value={backendDestinationId ?? ''}
                  onChange={(e) => setBackendDestinationId(Number(e.target.value))}
                  className={inputCls}
                >
                  {destinationOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </PanelChrome>

          <PanelChrome title="Delivery Settings">
            <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-4">
              <Field label="Delivery Mode *" hint="Guarantee at-least-once delivery">
                <select value={deliveryMode} onChange={(e) => setDeliveryMode(e.target.value as 'Reliable' | 'Best Effort')} className={inputCls}>
                  <option value="Reliable">Reliable</option>
                  <option value="Best Effort">Best Effort</option>
                </select>
              </Field>
              <Field label="Failure Policy *" hint="Retry on failure with backoff">
                <select value={failurePolicy} onChange={(e) => setFailurePolicy(e.target.value as typeof failurePolicy)} className={inputCls}>
                  <option>Retry</option>
                  <option>Log and Continue</option>
                  <option>Pause Stream</option>
                  <option>Disable Route</option>
                </select>
              </Field>
              <Field label="Max Retry" hint="0 = unlimited">
                <input type="number" value={maxRetry} onChange={(e) => setMaxRetry(Number(e.target.value))} className={inputCls} />
              </Field>
              <Field label="Retry Backoff *" hint="Backoff strategy for retries">
                <select value={retryBackoff} onChange={(e) => setRetryBackoff(e.target.value as 'Exponential' | 'Linear')} className={inputCls}>
                  <option value="Exponential">Exponential</option>
                  <option value="Linear">Linear</option>
                </select>
              </Field>
              <Field label="Initial Backoff" hint="seconds">
                <input type="number" value={initialBackoffSec} onChange={(e) => setInitialBackoffSec(Number(e.target.value))} className={inputCls} />
              </Field>
              <Field label="Max Backoff *" hint="seconds">
                <input type="number" value={maxBackoffSec} onChange={(e) => setMaxBackoffSec(Number(e.target.value))} className={inputCls} />
              </Field>
              <Field label="Max Delivery Time" hint="0 = no limit (seconds)">
                <input type="number" value={maxDeliveryTimeSec} onChange={(e) => setMaxDeliveryTimeSec(Number(e.target.value))} className={inputCls} />
              </Field>
              <Field label="Batch Size" hint="Events per delivery batch">
                <input type="number" value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))} className={inputCls} />
              </Field>
            </div>
          </PanelChrome>

          <PanelChrome title="Rate Limiting">
            <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-3">
              <Field label="Rate Limit">
                <button
                  type="button"
                  onClick={() => setRateLimitEnabled((v) => !v)}
                  className={cn(
                    'inline-flex h-8 w-fit items-center rounded-full px-3 text-[11px] font-semibold',
                    rateLimitEnabled ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300' : 'bg-slate-500/15 text-slate-700 dark:text-gdc-mutedStrong',
                  )}
                >
                  {rateLimitEnabled ? 'Enable rate limiting' : 'Disabled'}
                </button>
              </Field>
              <Field label="Per Second" hint="events / sec">
                <input type="number" value={perSecond} onChange={(e) => setPerSecond(Number(e.target.value))} className={inputCls} />
              </Field>
              <Field label="Burst Size" hint="Maximum events in short burst">
                <input type="number" value={burstSize} onChange={(e) => setBurstSize(Number(e.target.value))} className={inputCls} />
              </Field>
            </div>
          </PanelChrome>

          <PanelChrome title="Event Transformation (Optional)">
            <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-3">
              <Field label="Enrichment Profile">
                <select value={enrichmentProfile} onChange={(e) => setEnrichmentProfile(e.target.value)} className={inputCls}>
                  <option>Cybereason Default Enrichment</option>
                  <option>Minimal Enrichment</option>
                  <option>No Enrichment</option>
                </select>
              </Field>
              <Field label="Filter (JSONPath)">
                <input value={filterJsonPath} onChange={(e) => setFilterJsonPath(e.target.value)} className={inputCls} />
              </Field>
              <Field label=" ">
                <button type="button" className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-3 text-[12px] font-medium hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card">
                  <Play className="h-3.5 w-3.5" />
                  Preview Filter
                </button>
              </Field>
            </div>
          </PanelChrome>

          <PanelChrome title="Routing Conditions (Optional)" right={<X className="h-3.5 w-3.5 text-slate-400" />}>
            <div className="p-3 text-[12px] text-slate-500 dark:text-gdc-muted">Add conditions to control when this route is used.</div>
          </PanelChrome>
          <PanelChrome title="Advanced Settings (Optional)" right={<X className="h-3.5 w-3.5 text-slate-400" />}>
            <div className="p-3 text-[12px] text-slate-500 dark:text-gdc-muted">Additional delivery and buffering options.</div>
          </PanelChrome>
        </div>

        <div className="col-span-12 space-y-3 xl:col-span-3">
          <PanelChrome title="Route Summary">
            <ul className="space-y-1.5 p-2.5 text-[12px]">
              <li className="flex items-center justify-between"><span className="text-slate-500">Status</span><span className="font-semibold text-emerald-700 dark:text-emerald-400">{enabled ? 'Enabled' : 'Disabled'}</span></li>
              <li className="flex items-center justify-between"><span className="text-slate-500">Delivery Mode</span><span className="font-semibold">{deliveryMode}</span></li>
              <li className="flex items-center justify-between"><span className="text-slate-500">Failure Policy</span><span className="font-semibold">{failurePolicy}</span></li>
              <li className="flex items-center justify-between"><span className="text-slate-500">Retry Backoff</span><span className="font-semibold">{retryBackoff}</span></li>
              <li className="flex items-center justify-between"><span className="text-slate-500">Rate Limit</span><span className="font-semibold">{rateLimitEnabled ? `${perSecond} events/sec (Burst ${burstSize})` : 'Disabled'}</span></li>
              <li className="flex items-center justify-between"><span className="text-slate-500">Batch Size</span><span className="font-semibold">{batchSize} events</span></li>
              <li className="flex items-center justify-between"><span className="text-slate-500">Destination</span><span className="font-semibold">{destinationLabel}</span></li>
            </ul>
          </PanelChrome>

          <PanelChrome title="Route Flow">
            <div className="flex items-center justify-between gap-2 p-2.5">
              <div className="rounded-md border border-slate-200/80 bg-slate-50 px-2 py-1 text-[11px] font-medium dark:border-gdc-border dark:bg-gdc-card">
                {streamLabel}
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
              <div className="rounded-md border border-violet-200 bg-violet-500/[0.08] px-2 py-1 text-[11px] font-medium text-violet-800 dark:border-violet-500/40 dark:text-violet-300">
                {destinationLabel}
              </div>
            </div>
          </PanelChrome>

          <PanelChrome title="Next Steps">
            <ol className="space-y-1.5 p-2.5 text-[11px] text-slate-600 dark:text-gdc-muted">
              <li>1. Save Route (API-backed when available)</li>
              <li>2. Start Stream</li>
              <li>3. Open Runtime and verify delivery</li>
              <li>4. Monitor route failure/retry signals</li>
            </ol>
            <p className="px-2.5 pb-2 text-[10px] text-slate-500 dark:text-gdc-muted">
              Destination source: {destinationSource === 'api' ? 'API-backed list' : 'No destinations loaded'}
            </p>
          </PanelChrome>

          <PanelChrome title="Need help?">
            <div className="space-y-2 p-2.5 text-[12px]">
              <p className="text-slate-600 dark:text-gdc-muted">Learn more about routes in our documentation.</p>
              <a
                href="https://example.com/docs/routes"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-violet-700 hover:underline dark:text-violet-300"
              >
                <HelpCircle className="h-3.5 w-3.5" />
                View Docs
              </a>
            </div>
          </PanelChrome>
        </div>
      </div>

      <p className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-gdc-muted">
        <ShieldCheck className="h-3 w-3" />
        Route is preserved as Stream ↔ Destination linkage with enabled, destination, failure policy, formatter/rate-limit oriented settings.
      </p>
    </div>
  )
}
