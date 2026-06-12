import { AlertTriangle, Bug, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  runStreamPipelineDebug,
  type PipelineDebugResponse,
} from '../../api/gdcRuntimePipelineDebug'
import { fetchMappingSourceSample, type MappingSourceSampleResult } from '../../utils/mappingSourceSample'
import { cn } from '../../lib/utils'

const STAGE_PANEL =
  'max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-md border border-slate-200/80 bg-slate-950/[0.03] p-2 font-mono text-[11px] leading-snug text-slate-800 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100'

function jsonText(data: unknown): string {
  if (data === null || data === undefined) return '—'
  if (typeof data === 'string') return data
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

type PipelineDebuggerPanelProps = {
  streamId: number
}

export function PipelineDebuggerPanel({ streamId }: PipelineDebuggerPanelProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PipelineDebugResponse | null>(null)
  const [sample, setSample] = useState<MappingSourceSampleResult | null>(null)
  const [sampleLoading, setSampleLoading] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const loadSample = useCallback(async () => {
    if (!mountedRef.current) return null
    setSampleLoading(true)
    try {
      const s = await fetchMappingSourceSample(streamId)
      if (!mountedRef.current) return null
      setSample(s)
      return s
    } catch (e: unknown) {
      if (!mountedRef.current) return null
      setSample({
        ok: false,
        sourceType: 'HTTP_API_POLLING',
        rawPayload: null,
        treeDocument: {},
        extractedEvents: [],
        eventArrayPath: '',
        eventRootPath: '',
        sampleEventIndex: 0,
        message: e instanceof Error ? e.message : 'Failed to load sample',
        recordsLabel: '—',
        fetchedAt: '',
      })
      return null
    } finally {
      if (mountedRef.current) setSampleLoading(false)
    }
  }, [streamId])

  const runDebug = useCallback(
    async (rawPayload?: unknown) => {
      if (!mountedRef.current) return
      setLoading(true)
      setError(null)
      try {
        const body =
          rawPayload !== undefined && rawPayload !== null
            ? { raw_event: rawPayload as Record<string, unknown> }
            : {}
        const res = await runStreamPipelineDebug(streamId, body)
        if (!mountedRef.current) return
        setResult(
          res
            ? {
                ...res,
                routes: res.routes ?? [],
                warnings: res.warnings ?? [],
                errors: res.errors ?? [],
              }
            : null,
        )
      } catch (e: unknown) {
        if (!mountedRef.current) return
        setResult(null)
        setError(e instanceof Error ? e.message : 'Pipeline debug failed')
      } finally {
        if (mountedRef.current) setLoading(false)
      }
    },
    [streamId],
  )

  const refresh = useCallback(async () => {
    const s = await loadSample()
    if (!mountedRef.current) return
    if (s?.ok && s.rawPayload != null) {
      await runDebug(s.rawPayload)
    } else {
      await runDebug()
    }
  }, [loadSample, runDebug])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const stageErrors = result?.errors ?? []
  const stageWarnings = result?.warnings ?? []

  return (
    <section
      aria-label="Pipeline debugger"
      className="rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 px-3 py-2 dark:border-gdc-border">
        <div className="flex items-center gap-2">
          <Bug className="h-4 w-4 text-violet-600 dark:text-violet-400" aria-hidden />
          <div>
            <p className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Pipeline debugger</p>
            <p className="text-[10px] text-slate-500 dark:text-gdc-muted">
              One sample event through mapping, enrichment, formatting, and route delivery preview (no send).
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || sampleLoading}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200/90 px-2 text-[11px] font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-gdc-border dark:hover:bg-gdc-rowHover"
        >
          {loading || sampleLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          )}
          Refresh
        </button>
      </div>

      <div className="space-y-3 p-3">
        {sample && !sample.ok ? (
          <p className="text-[11px] text-amber-700 dark:text-amber-300">
            {sample.message ?? 'No live sample available.'} Pass a raw event via mapping/API test, or configure a
            webhook sample payload.
          </p>
        ) : null}
        {error ? <p className="text-[11px] font-medium text-red-600 dark:text-red-400">{error}</p> : null}
        {(stageErrors.length > 0 || stageWarnings.length > 0) && (
          <div className="space-y-1">
            {stageWarnings.map((w) => (
              <p key={w} className="flex items-start gap-1 text-[11px] text-amber-800 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                {w}
              </p>
            ))}
            {stageErrors.map((e) => (
              <p key={e} className="text-[11px] font-medium text-red-600 dark:text-red-400">
                {e}
              </p>
            ))}
          </div>
        )}

        <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-4">
          <StageCard title="Raw event" loading={loading}>
            <div className={STAGE_PANEL}>{jsonText(result?.raw_event)}</div>
          </StageCard>
          <StageCard title="Mapped event" loading={loading}>
            <div className={STAGE_PANEL}>{jsonText(result?.mapped_event)}</div>
          </StageCard>
          <StageCard title="Enriched event" loading={loading}>
            <div className={STAGE_PANEL}>{jsonText(result?.enriched_event)}</div>
          </StageCard>
          <StageCard title="Formatted payload" loading={loading}>
            <div className={STAGE_PANEL}>{result?.formatted_payload ?? '—'}</div>
          </StageCard>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-semibold text-slate-800 dark:text-slate-200">Route delivery preview</p>
          {loading && !result ? (
            <p className="text-[11px] text-slate-500 dark:text-gdc-muted">Loading pipeline preview…</p>
          ) : null}
          {!loading && result && (result.routes?.length ?? 0) === 0 ? (
            <p className="text-[11px] text-slate-500 dark:text-gdc-muted">No routes configured.</p>
          ) : null}
          <div className="grid gap-2 md:grid-cols-2">
            {(result?.routes ?? []).map((route) => (
              <div
                key={route.route_id}
                className="rounded-lg border border-slate-200/80 p-2 dark:border-gdc-border"
              >
                <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                  Route {route.route_id} → {route.destination_type}
                </p>
                <p className="text-[10px] text-slate-500 dark:text-gdc-muted">
                  Destination {route.destination_id}
                </p>
                <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                  Formatter
                </p>
                <div className={cn(STAGE_PANEL, 'max-h-24')}>{jsonText(route.formatter_summary)}</div>
                <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                  Delivery preview
                </p>
                <div className={STAGE_PANEL}>{jsonText(route.delivery_preview)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function StageCard({
  title,
  loading,
  children,
}: {
  title: string
  loading: boolean
  children: ReactNode
}) {
  return (
    <div className="rounded-lg border border-slate-200/80 p-2 dark:border-gdc-border">
      <div className="mb-1 flex items-center justify-between gap-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-gdc-mutedStrong">
          {title}
        </p>
        {loading ? <Loader2 className="h-3 w-3 animate-spin text-violet-600" aria-hidden /> : null}
      </div>
      {children}
    </div>
  )
}
