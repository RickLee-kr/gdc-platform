import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Code2,
  ExternalLink,
  GripHorizontal,
  LayoutGrid,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { StatusBadge } from '../shell/status-badge'
import { opTable, opTd, opTh, opThRow, opTr } from '../dashboard/widgets/operational-table-styles'
import { MappingJsonTree, PanelChrome } from './mapping-json-tree'
import { resolveJsonPath } from './mapping-jsonpath'
import {
  emptyStreamMappingPageState,
  MAPPING_FUNCTION_CARDS,
  type EnrichmentRowModel,
  type FunctionCardModel,
  type MappingFieldType,
  type MappingRowModel,
} from './stream-mapping-model'
import { StreamWorkflowSummaryStrip } from './stream-workflow-checklist'
import { computeStreamWorkflow } from '../../utils/streamWorkflow'
import { resolveSourceTypePresentation } from '../../utils/sourceTypePresentation'
import { saveStreamMappingUiConfigStrict } from '../../api/gdcRuntimeUi'
import { fetchStreamById } from '../../api/gdcStreams'
import { fetchStreamMappingUiConfig } from '../../api/gdcRuntime'
import { fetchConnectorById } from '../../api/gdcConnectors'
import { runHttpApiTest } from '../../api/gdcRuntimePreview'
import { buildStreamHttpConfigFromStreamRead, connectorBaseUrlFromMappingUi } from '../../utils/streamHttpConfigFromStreamRead'

function coerceMappedValue(value: unknown, type: MappingFieldType): unknown {
  if (value === undefined) return null
  if (type === 'number') {
    if (typeof value === 'number' && !Number.isNaN(value)) return value
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  if (type === 'datetime') return value === null ? null : String(value)
  if (value === null) return null
  return String(value)
}

function suggestOutputField(jsonPath: string): string {
  const stripped = jsonPath.replace(/^\$\.?/, '')
  const parts = stripped.split(/\.|\[|\]/).filter(Boolean)
  const last = parts[parts.length - 1] ?? 'field'
  const cleaned = last.replace(/[^a-zA-Z0-9_]/g, '_')
  return cleaned || 'field'
}

function resolveEnrichmentValue(value: string): string {
  const t = value.trim()
  if (t === '{{ now_utc }}') return new Date().toISOString()
  return value
}

type PreviewTab = 'json' | 'table'

type StepKey = 'source' | 'mapping' | 'enrichment' | 'preview'

const STEP_ORDER: readonly StepKey[] = ['source', 'mapping', 'enrichment', 'preview']

function inferMappingCellType(value: unknown): MappingFieldType {
  if (typeof value === 'number' && Number.isFinite(value)) return 'number'
  if (typeof value === 'string' && /\d{4}-\d{2}-\d{2}T/.test(value)) return 'datetime'
  return 'string'
}

function fieldMappingsToRows(fieldMappings: Record<string, string>, root: Record<string, unknown>): MappingRowModel[] {
  let i = 0
  return Object.entries(fieldMappings).map(([outputField, sourceJsonPath]) => {
    const raw = resolveJsonPath(root, sourceJsonPath)
    return {
      id: `saved-${i++}-${outputField}`,
      outputField,
      sourceJsonPath,
      type: inferMappingCellType(raw),
      origin: 'auto' as const,
    }
  })
}

function enrichmentRecordToRows(rec: Record<string, unknown>): EnrichmentRowModel[] {
  return Object.entries(rec).map(([field, value]) => {
    const s = typeof value === 'string' ? value : JSON.stringify(value)
    const fn = s.includes('{{') && s.includes('}}')
    return { field, value: s, type: fn ? ('function' as const) : ('static' as const) }
  })
}

function Stepper({
  active,
  mappedCount,
  enrichmentCount,
  sourceHint,
}: {
  active: StepKey
  mappedCount: number
  enrichmentCount: number
  sourceHint: string
}) {
  const idx = STEP_ORDER.indexOf(active)
  const labels: Record<StepKey, { title: string; hint: string }> = {
    source: { title: 'Source Test', hint: sourceHint },
    mapping: { title: 'Mapping', hint: `${mappedCount} fields mapped` },
    enrichment: { title: 'Enrichment', hint: `${enrichmentCount} fields` },
    preview: { title: 'Preview', hint: 'Sample output' },
  }

  return (
    <nav aria-label="Mapping workflow" className="flex flex-wrap gap-2 rounded-lg border border-slate-200/70 bg-white/90 px-2 py-2 dark:border-gdc-border dark:bg-gdc-card">
      {STEP_ORDER.map((key, i) => {
        const done = i < idx
        const current = i === idx
        const pending = i > idx
        return (
          <div
            key={key}
            className={cn(
              'flex min-w-[140px] flex-1 items-start gap-2 rounded-md px-2 py-1.5',
              current && 'bg-violet-500/[0.07] ring-1 ring-violet-200/70 dark:bg-violet-500/[0.09] dark:ring-violet-500/25',
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                done && 'bg-emerald-500 text-white',
                current && !done && 'bg-violet-600 text-white',
                pending && 'border border-slate-200 bg-slate-50 text-slate-500 dark:border-gdc-border dark:bg-gdc-card dark:text-gdc-muted',
              )}
              aria-hidden
            >
              {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <div className="min-w-0">
              <p className={cn('text-[11px] font-semibold', current ? 'text-violet-900 dark:text-violet-100' : 'text-slate-800 dark:text-slate-100')}>
                {labels[key].title}
              </p>
              <p className="truncate text-[10px] text-slate-500 dark:text-gdc-muted">{labels[key].hint}</p>
            </div>
          </div>
        )
      })}
    </nav>
  )
}

type FuncTab = 'all' | FunctionCardModel['category']

export function StreamMappingPage() {
  const { streamId = '' } = useParams<{ streamId: string }>()
  const backendStreamId = useMemo(() => (/^\d+$/.test(streamId) ? Number(streamId) : null), [streamId])
  const emptyShell = useMemo(() => emptyStreamMappingPageState(streamId), [streamId])

  const [sourceDocument, setSourceDocument] = useState<Record<string, unknown>>(() => ({ ...emptyShell.sourceDocument }))
  const [enrichment, setEnrichment] = useState<EnrichmentRowModel[]>(() => [...emptyShell.enrichment])
  const [rows, setRows] = useState<MappingRowModel[]>(() => [...emptyShell.initialMappings])
  const [streamTitle, setStreamTitle] = useState(emptyShell.streamName)
  const [connectorLabel, setConnectorLabel] = useState(emptyShell.connectorName)
  const [streamStatusUi, setStreamStatusUi] = useState<string>(String(emptyShell.status))
  const [sourcePayloadMode, setSourcePayloadMode] = useState<'api' | 'empty'>('empty')
  const [sourceFooter, setSourceFooter] = useState({
    recordsLabel: String(emptyShell.recordsFetched),
    fetchedLabel: emptyShell.fetchedAt,
    ok: true,
  })
  const [payloadBanner, setPayloadBanner] = useState<string | null>(null)
  const [configLoading, setConfigLoading] = useState(false)

  const baselineRowsRef = useRef<MappingRowModel[] | null>(null)
  const baselineEnrichmentRef = useRef<EnrichmentRowModel[] | null>(null)

  const [mappingSearch, setMappingSearch] = useState('')
  const [treeSearch, setTreeSearch] = useState('')
  const [previewTab, setPreviewTab] = useState<PreviewTab>('json')
  const [withEnrichment, setWithEnrichment] = useState(true)
  const [activeStep, setActiveStep] = useState<StepKey>('mapping')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [dupWarn, setDupWarn] = useState<string | null>(null)
  const [funcTab, setFuncTab] = useState<FuncTab>('all')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  const [savedSnapshot, setSavedSnapshot] = useState<string>(() => JSON.stringify(emptyShell.initialMappings))
  const [mappingSourceType, setMappingSourceType] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const d = emptyStreamMappingPageState(streamId)

    function applyEmptyLocal() {
      setSourceDocument({ ...d.sourceDocument })
      setRows([...d.initialMappings])
      setEnrichment([...d.enrichment])
      setStreamTitle(d.streamName)
      setConnectorLabel(d.connectorName)
      setStreamStatusUi(String(d.status))
      setSourcePayloadMode('empty')
      setSourceFooter({ recordsLabel: String(d.recordsFetched), fetchedLabel: d.fetchedAt, ok: true })
      setPayloadBanner(null)
      baselineRowsRef.current = null
      baselineEnrichmentRef.current = null
      setSavedSnapshot(JSON.stringify(d.initialMappings))
      setEditingId(null)
      setDupWarn(null)
      setSaveError(null)
      setSaveSuccess(null)
      setMappingSourceType('HTTP_API_POLLING')
    }

    async function loadFromBackend(id: number) {
      setConfigLoading(true)
      setPayloadBanner(null)
      try {
        const [stream, cfg] = await Promise.all([fetchStreamById(id), fetchStreamMappingUiConfig(id)])
        if (cancelled) return
        if (!stream || !cfg) {
          applyEmptyLocal()
          setPayloadBanner('Could not load stream or mapping-ui config.')
          return
        }

        setStreamTitle(cfg.stream_name || stream.name || `Stream ${id}`)
        setStreamStatusUi(String(cfg.stream_status || stream.status || 'RUNNING'))
        setMappingSourceType(cfg.source_type ?? stream.stream_type ?? null)

        const cid = typeof stream.connector_id === 'number' ? stream.connector_id : null
        if (cid != null) {
          const c = await fetchConnectorById(cid)
          if (!cancelled && c?.name) setConnectorLabel(c.name)
          else if (!cancelled) setConnectorLabel('—')
        } else {
          setConnectorLabel('—')
        }

        const streamCfg = buildStreamHttpConfigFromStreamRead(stream, cfg)
        const baseUrl = connectorBaseUrlFromMappingUi(stream, cfg)
        const res = await runHttpApiTest({
          connector_id: cid ?? undefined,
          source_config: cid != null ? {} : { base_url: baseUrl },
          stream_config: streamCfg,
          checkpoint: null,
          fetch_sample: true,
        })
        if (cancelled) return

        let doc: Record<string, unknown>
        const rawParsed = res.response?.parsed_json
        if (res.ok && rawParsed !== null && rawParsed !== undefined) {
          if (typeof rawParsed === 'object' && !Array.isArray(rawParsed)) {
            doc = { ...(rawParsed as Record<string, unknown>) }
          } else if (Array.isArray(rawParsed)) {
            doc = { data: rawParsed }
          } else {
            doc = { value: rawParsed as unknown }
          }
          setSourcePayloadMode('api')
          const sum = res.analysis?.response_summary
          const approx = sum?.approx_size_bytes != null ? `${sum.approx_size_bytes} B JSON` : 'parsed response'
          setSourceFooter({
            recordsLabel: approx,
            fetchedLabel: new Date().toISOString().slice(0, 19).replace('T', ' '),
            ok: true,
          })
          setPayloadBanner(null)
        } else {
          doc = { ...d.sourceDocument }
          setSourcePayloadMode('empty')
          setSourceFooter({ recordsLabel: String(d.recordsFetched), fetchedLabel: d.fetchedAt, ok: false })
          setPayloadBanner(
            res.ok
              ? 'API returned empty or non-object JSON — source tree unavailable.'
              : `Sample HTTP fetch failed (${res.message ?? res.error_type ?? 'error'}).`,
          )
        }
        setSourceDocument(doc)

        const fm = cfg.mapping?.field_mappings ?? {}
        const mappingRows = Object.keys(fm).length > 0 ? fieldMappingsToRows(fm, doc) : []
        setRows(mappingRows)

        const en = (cfg.enrichment?.enrichment ?? {}) as Record<string, unknown>
        const enRows =
          cfg.enrichment?.exists && Object.keys(en).length > 0 ? enrichmentRecordToRows(en) : [...d.enrichment]
        setEnrichment(enRows)

        baselineRowsRef.current = mappingRows.map((r) => ({ ...r }))
        baselineEnrichmentRef.current = enRows.map((r) => ({ ...r }))
        setSavedSnapshot(JSON.stringify(mappingRows))
        setEditingId(null)
        setDupWarn(null)
        setSaveError(null)
        setSaveSuccess(null)
      } catch (e) {
        if (!cancelled) {
          applyEmptyLocal()
          setPayloadBanner(e instanceof Error ? e.message : 'Load error.')
        }
      } finally {
        if (!cancelled) setConfigLoading(false)
      }
    }

    if (backendStreamId == null) {
      applyEmptyLocal()
      return () => {
        cancelled = true
      }
    }
    void loadFromBackend(backendStreamId)
    return () => {
      cancelled = true
    }
  }, [streamId, backendStreamId])

  const filteredRows = useMemo(() => {
    const q = mappingSearch.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.sourceJsonPath.toLowerCase().includes(q) ||
        r.outputField.toLowerCase().includes(q) ||
        r.type.toLowerCase().includes(q),
    )
  }, [rows, mappingSearch])

  const mappedPreview = useMemo(() => {
    const out: Record<string, unknown> = {}
    for (const row of rows) {
      const raw = resolveJsonPath(sourceDocument, row.sourceJsonPath)
      out[row.outputField] = coerceMappedValue(raw, row.type)
    }
    return out
  }, [rows, sourceDocument])

  const finalPreview = useMemo(() => {
    let base: Record<string, unknown> = { ...mappedPreview }
    if (withEnrichment) {
      const extra: Record<string, unknown> = {}
      for (const e of enrichment) {
        extra[e.field] = resolveEnrichmentValue(e.value)
      }
      base = { ...extra, ...base }
    }
    return base
  }, [mappedPreview, withEnrichment, enrichment])

  const derivedStats = useMemo(() => {
    const auto = rows.filter((r) => r.origin === 'auto').length
    const manual = rows.filter((r) => r.origin === 'manual').length
    return {
      autoMapped: auto,
      manualMapped: manual,
      unmapped: emptyShell.stats.unmapped,
    }
  }, [rows, emptyShell.stats.unmapped])

  const functionCards = useMemo(() => {
    if (funcTab === 'all') return [...MAPPING_FUNCTION_CARDS]
    return MAPPING_FUNCTION_CARDS.filter((c) => c.category === funcTab)
  }, [funcTab])

  const handlePickPath = useCallback(
    (jsonPath: string) => {
      let duplicate = false
      setRows((prev) => {
        if (prev.some((r) => r.sourceJsonPath === jsonPath)) {
          duplicate = true
          return prev
        }
        const id = `new-${Date.now()}`
        const outputField = suggestOutputField(jsonPath)
        const raw = resolveJsonPath(sourceDocument, jsonPath)
        const guessedType: MappingFieldType =
          typeof raw === 'number' ? 'number' : typeof raw === 'string' && /\d{4}-\d{2}-\d{2}T/.test(raw) ? 'datetime' : 'string'
        setDupWarn(null)
        return [...prev, { id, sourceJsonPath: jsonPath, outputField, type: guessedType, origin: 'manual' }]
      })
      if (duplicate) {
        setDupWarn(`Already mapped: ${jsonPath}`)
        window.setTimeout(() => setDupWarn(null), 3200)
      }
      setActiveStep('mapping')
    },
    [sourceDocument],
  )

  const resetMapping = useCallback(() => {
    const br = baselineRowsRef.current
    const be = baselineEnrichmentRef.current
    setRows(br ? [...br] : [...emptyShell.initialMappings])
    setEnrichment(be ? [...be] : [...emptyShell.enrichment])
    setEditingId(null)
  }, [emptyShell.initialMappings, emptyShell.enrichment])

  const deleteRow = useCallback((id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id))
    setEditingId((e) => (e === id ? null : e))
  }, [])

  const updateRow = useCallback((id: string, patch: Partial<MappingRowModel>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }, [])

  const hasUnsavedChanges = JSON.stringify(rows) !== savedSnapshot

  const mappingPresentation = useMemo(
    () => resolveSourceTypePresentation(mappingSourceType),
    [mappingSourceType],
  )

  const workflowSnapshot = useMemo(
    () =>
      computeStreamWorkflow({
        streamId,
        status: 'STOPPED',
        events1h: 0,
        deliveryPct: 0,
        routesTotal: 0,
        routesOk: 0,
        hasConnector: true,
        hasApiTest: true,
        hasMapping: rows.length > 0,
        hasEnrichment: enrichment.length > 0,
        sourceType: mappingSourceType,
      }),
    [streamId, rows.length, enrichment.length, mappingSourceType],
  )

  async function handleSaveMapping() {
    if (isSaving) return
    setIsSaving(true)
    setSaveError(null)
    setSaveSuccess(null)
    const rowsWithMapping = rows.filter((r) => r.outputField.trim() !== '' && r.sourceJsonPath.trim() !== '')
    if (backendStreamId == null) {
      setSavedSnapshot(JSON.stringify(rows))
      setSaveSuccess('Saved locally (preview only) · numeric stream id required for API-backed save.')
      setIsSaving(false)
      return
    }
    if (rowsWithMapping.length === 0) {
      setSaveError('Add at least one mapping row before saving.')
      setIsSaving(false)
      return
    }
    try {
      const fieldMappings: Record<string, string> = {}
      for (const row of rowsWithMapping) {
        fieldMappings[row.outputField] = row.sourceJsonPath
      }
      const result = await saveStreamMappingUiConfigStrict(backendStreamId, {
        mapping: {
          field_mappings: fieldMappings,
        },
      })
      setSavedSnapshot(JSON.stringify(rows))
      baselineRowsRef.current = rows.map((r) => ({ ...r }))
      baselineEnrichmentRef.current = enrichment.map((r) => ({ ...r }))
      setSaveSuccess(`API-backed · ${result.message}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : '매핑 저장에 실패했습니다.'
      setSaveError(`API save failed: ${message}`)
    } finally {
      setIsSaving(false)
    }
  }

  const sourceStepHint = configLoading ? 'Loading sample…' : sourcePayloadMode === 'api' ? 'Live HTTP sample' : 'Empty shell'
  const statusTone: 'success' | 'warning' | 'error' | 'neutral' | 'info' =
    streamStatusUi === 'ERROR'
      ? 'error'
      : streamStatusUi === 'STOPPED' || streamStatusUi === 'PAUSED'
        ? 'neutral'
        : streamStatusUi === 'DEGRADED'
          ? 'warning'
          : 'success'

  return (
    <div className="w-full min-w-0 space-y-3">
      <div className="flex flex-col gap-3 border-b border-slate-200/80 pb-3 dark:border-gdc-border lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">Mapping</h2>
            <StatusBadge tone={statusTone} className="font-bold uppercase tracking-wide">
              {String(streamStatusUi || 'RUNNING').toUpperCase()}
            </StatusBadge>
          </div>
          <p className="text-[13px] text-slate-600 dark:text-gdc-muted">Define field mapping and enrichment for this stream.</p>
          <p className="text-[11px] text-slate-500 dark:text-gdc-muted">
            {connectorLabel} <span className="text-slate-400">·</span> {streamTitle}{' '}
            <span className="font-mono text-slate-400">({streamId})</span>
            <span className="text-slate-400"> · </span>
            Source tree · {sourcePayloadMode === 'api' ? 'live HTTP sample' : 'empty shell'}
            <span className="text-slate-400"> · </span>
            Save state ·{' '}
            {backendStreamId != null
              ? 'API-backed (POST /runtime/streams/{id}/mapping-ui/save)'
              : 'empty shell (no numeric stream id)'}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span
            className="inline-flex h-8 items-center rounded-full border border-slate-200/90 bg-slate-50 px-2.5 text-[11px] font-semibold text-slate-700 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
            aria-live="polite"
          >
            {isSaving ? 'Saving…' : saveError ? 'Save failed' : saveSuccess ? 'Saved' : hasUnsavedChanges ? 'Unsaved changes' : 'Saved'}
          </span>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200/90 bg-white px-2.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200 dark:hover:bg-gdc-rowHover"
            onClick={() => {
              setActiveStep('source')
            }}
          >
            Test Source
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200/90 bg-white px-2.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200 dark:hover:bg-gdc-rowHover"
          >
            More
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => void handleSaveMapping()}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white shadow-sm hover:bg-violet-700"
          >
            {isSaving ? 'Saving…' : 'Save Mapping'}
          </button>
        </div>
      </div>
      {saveError ? <p className="text-[12px] font-medium text-red-700 dark:text-red-300">{saveError}</p> : null}
      {saveSuccess ? <p className="text-[12px] font-medium text-emerald-700 dark:text-emerald-300">{saveSuccess}</p> : null}
      {payloadBanner ? (
        <p className="rounded-md border border-amber-200/80 bg-amber-500/[0.07] px-2.5 py-1.5 text-[12px] text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100/90" role="status">
          {payloadBanner}
        </p>
      ) : null}

      <StreamWorkflowSummaryStrip
        snapshot={workflowSnapshot}
        activeStep="mapping"
        highlightCompleted={['connector', 'apiTest']}
      />

      <Stepper active={activeStep} mappedCount={rows.length} enrichmentCount={enrichment.length} sourceHint={sourceStepHint} />

      {dupWarn ? (
        <p className="rounded-md border border-amber-200/80 bg-amber-500/[0.07] px-2.5 py-1.5 text-[12px] text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100/90" role="status">
          {dupWarn}
        </p>
      ) : null}

      <div className="grid grid-cols-12 gap-3">
        {/* Source */}
        <div className="col-span-12 xl:col-span-5">
          <PanelChrome
            title="Source Data (JSON)"
            right={
              <>
                <label className="sr-only" htmlFor="src-format">
                  Format
                </label>
                <select
                  id="src-format"
                  className="h-7 rounded border border-slate-200/90 bg-slate-50/80 px-1.5 text-[11px] font-medium text-slate-700 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
                  disabled
                >
                  <option>JSON</option>
                </select>
                <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-gdc-rowHover" aria-label="Toggle code view">
                  <Code2 className="h-3.5 w-3.5" />
                </button>
              </>
            }
          >
            <div className="flex flex-col gap-2 p-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
                <input
                  type="search"
                  placeholder="Search fields…"
                  value={treeSearch}
                  onChange={(e) => setTreeSearch(e.target.value)}
                  className="h-8 w-full rounded-md border border-slate-200/90 bg-slate-50/80 py-1 pl-8 pr-2 text-[12px] text-slate-900 placeholder:text-slate-400 focus:border-violet-300 focus:outline-none focus:ring-1 focus:ring-violet-300/50 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100"
                  aria-label="Search fields"
                />
              </div>
              <p className="text-[10px] text-slate-500 dark:text-gdc-muted">Click any field to append a mapping row (JSONPath is generated).</p>
              <div className="relative rounded-md border border-slate-200/60 bg-slate-50/50 p-2 dark:border-gdc-border dark:bg-gdc-section">
                {configLoading ? (
                  <div className="flex min-h-[200px] items-center justify-center gap-2 text-[12px] text-slate-500 dark:text-gdc-muted">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Loading source sample…
                  </div>
                ) : (
                  <MappingJsonTree value={sourceDocument} baseLabel="" basePath="$" search={treeSearch} onPickPath={handlePickPath} />
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-200/70 pt-2 text-[11px] text-slate-600 dark:border-gdc-border dark:text-gdc-muted">
                <span>
                  Payload: <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">{sourceFooter.recordsLabel}</span>
                </span>
                <span className="text-slate-300 dark:text-gdc-muted" aria-hidden>
                  ·
                </span>
                <span>
                  Refreshed: <span className="tabular-nums">{sourceFooter.fetchedLabel}</span>
                </span>
                <span className="ml-auto inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                  {sourceFooter.ok ? 'OK' : 'Fallback'}
                </span>
              </div>
            </div>
          </PanelChrome>
        </div>

        {/* Mapping table */}
        <div className="col-span-12 xl:col-span-4">
          <PanelChrome
            title={`Field Mapping (${rows.length})`}
            right={
              <>
                <div className="relative hidden min-w-[140px] sm:block">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
                  <input
                    type="search"
                    placeholder="Search mapping…"
                    value={mappingSearch}
                    onChange={(e) => setMappingSearch(e.target.value)}
                    className="h-7 w-full rounded-md border border-slate-200/90 bg-slate-50/80 py-0.5 pl-7 pr-2 text-[11px] text-slate-900 placeholder:text-slate-400 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100"
                  />
                </div>
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1 rounded-md bg-violet-600 px-2 text-[11px] font-semibold text-white hover:bg-violet-700"
                  onClick={() => {
                    const id = `blank-${Date.now()}`
                    setRows((r) => [...r, { id, sourceJsonPath: '', outputField: 'new_field', type: 'string', origin: 'manual' }])
                    setEditingId(id)
                  }}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden /> Add Field
                </button>
                <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-gdc-rowHover" aria-label="Mapping settings">
                  <Settings2 className="h-3.5 w-3.5" />
                </button>
              </>
            }
          >
            <div className="flex flex-col gap-2 p-0">
              <div className="overflow-x-auto px-2 pt-2">
                <table className={opTable}>
                  <thead>
                    <tr className={opThRow}>
                      <th className={cn(opTh, 'w-8')} scope="col">
                        #
                      </th>
                      <th className={opTh} scope="col">
                        Source Field (JSONPath)
                      </th>
                      <th className={cn(opTh, 'w-8 px-0 text-center')} scope="col" aria-label="Map to">
                        →
                      </th>
                      <th className={opTh} scope="col">
                        Output Field
                      </th>
                      <th className={cn(opTh, 'w-[96px]')} scope="col">
                        Type
                      </th>
                      <th className={cn(opTh, 'w-[72px] text-right')} scope="col">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row, i) => {
                      const editing = editingId === row.id
                      return (
                        <tr key={row.id} className={opTr}>
                          <td className={cn(opTd, 'tabular-nums text-slate-500')}>{i + 1}</td>
                          <td className={cn(opTd, 'max-w-[180px] font-mono text-[11px] text-violet-800 dark:text-violet-200')}>
                            {editing ? (
                              <input
                                value={row.sourceJsonPath}
                                onChange={(e) => updateRow(row.id, { sourceJsonPath: e.target.value })}
                                className="w-full rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px] dark:border-gdc-border dark:bg-gdc-section"
                                aria-label="Source JSONPath"
                              />
                            ) : (
                              <span className="break-all">{row.sourceJsonPath || '—'}</span>
                            )}
                          </td>
                          <td className={cn(opTd, 'px-0 text-center text-slate-400')}>
                            <ArrowRight className="inline h-3.5 w-3.5" aria-hidden />
                          </td>
                          <td className={opTd}>
                            {editing ? (
                              <input
                                value={row.outputField}
                                onChange={(e) => updateRow(row.id, { outputField: e.target.value })}
                                className="w-full rounded border border-slate-200 bg-white px-1 py-0.5 text-[12px] dark:border-gdc-border dark:bg-gdc-section"
                              />
                            ) : (
                              <span className="font-medium text-slate-800 dark:text-slate-100">{row.outputField}</span>
                            )}
                          </td>
                          <td className={opTd}>
                            {editing ? (
                              <select
                                value={row.type}
                                onChange={(e) => updateRow(row.id, { type: e.target.value as MappingFieldType })}
                                className="w-full rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px] dark:border-gdc-border dark:bg-gdc-section"
                              >
                                <option value="string">string</option>
                                <option value="number">number</option>
                                <option value="datetime">datetime</option>
                              </select>
                            ) : (
                              <span className="text-slate-600 dark:text-gdc-muted">{row.type}</span>
                            )}
                          </td>
                          <td className={cn(opTd, 'text-right')}>
                            <button
                              type="button"
                              className="mr-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-gdc-rowHover"
                              aria-label="Edit row"
                              onClick={() => setEditingId(editing ? null : row.id)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-300"
                              aria-label="Delete row"
                              onClick={() => deleteRow(row.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-slate-200/70 px-2.5 py-2 dark:border-gdc-border">
                <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-gdc-muted">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                  Auto mapped: <span className="font-semibold tabular-nums">{derivedStats.autoMapped}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-gdc-muted">
                  <span className="h-2 w-2 rounded-full bg-sky-500" aria-hidden />
                  Manual mapped: <span className="font-semibold tabular-nums">{derivedStats.manualMapped}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-gdc-muted">
                  <span className="h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-600" aria-hidden />
                  Unmapped: <span className="font-semibold tabular-nums">{derivedStats.unmapped}</span>
                </span>
                <button
                  type="button"
                  onClick={resetMapping}
                  className="ml-auto inline-flex h-7 items-center rounded-md border border-slate-200/90 px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:text-slate-200 dark:hover:bg-gdc-rowHover"
                >
                  Reset Mapping
                </button>
              </div>
              <p className="flex items-center gap-1 border-t border-dashed border-slate-200/80 px-2.5 py-1.5 text-[10px] text-slate-400 dark:border-gdc-border">
                <GripHorizontal className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Drag-and-drop from tree is planned for a later phase — use click-to-map for now.
              </p>
            </div>
          </PanelChrome>
        </div>

        {/* Preview + Enrichment column */}
        <div className="col-span-12 flex flex-col gap-3 xl:col-span-3">
          <PanelChrome
            title="Mapping Preview (Sample Output)"
            right={
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200/90 px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:text-slate-200 dark:hover:bg-gdc-rowHover"
                onClick={() => setActiveStep('preview')}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Refresh
              </button>
            }
          >
            <div className="flex flex-col gap-2 p-2">
              <div className="flex rounded-md border border-slate-200/80 bg-slate-50/80 p-0.5 dark:border-gdc-border dark:bg-gdc-section">
                <button
                  type="button"
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-[11px] font-semibold',
                    previewTab === 'json' ? 'bg-white text-slate-900 shadow-sm dark:bg-gdc-card dark:text-slate-50' : 'text-slate-500',
                  )}
                  onClick={() => setPreviewTab('json')}
                >
                  <Code2 className="h-3.5 w-3.5" aria-hidden />
                  JSON
                </button>
                <button
                  type="button"
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-[11px] font-semibold',
                    previewTab === 'table' ? 'bg-white text-slate-900 shadow-sm dark:bg-gdc-card dark:text-slate-50' : 'text-slate-500',
                  )}
                  onClick={() => setPreviewTab('table')}
                >
                  <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
                  Table
                </button>
              </div>
              {previewTab === 'json' ? (
                <pre className="max-h-[280px] overflow-auto rounded-md border border-slate-200/60 bg-slate-950/95 p-2 text-[11px] leading-relaxed text-emerald-100/95 dark:border-gdc-border">
                  {JSON.stringify(withEnrichment ? finalPreview : mappedPreview, null, 2)}
                </pre>
              ) : (
                <div className="max-h-[280px] overflow-auto rounded-md border border-slate-200/60 bg-white dark:border-gdc-border dark:bg-gdc-section">
                  <table className={opTable}>
                    <thead>
                      <tr className={opThRow}>
                        <th className={opTh} scope="col">
                          Field
                        </th>
                        <th className={opTh} scope="col">
                          Value
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(withEnrichment ? finalPreview : mappedPreview).map(([k, v]) => (
                        <tr key={k} className={opTr}>
                          <td className={cn(opTd, 'font-mono text-[11px] text-violet-800 dark:text-violet-200')}>{k}</td>
                          <td className={cn(opTd, 'max-w-[140px] truncate font-mono text-[11px] text-slate-700 dark:text-gdc-mutedStrong')}>
                            {v === null || v === undefined ? 'null' : String(v)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </PanelChrome>

          <PanelChrome
            title={`Enrichment (${enrichment.length})`}
            right={
              <button
                type="button"
                className="inline-flex h-7 items-center rounded-md border border-slate-200/90 px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:text-slate-200 dark:hover:bg-gdc-rowHover"
                onClick={() => setActiveStep('enrichment')}
              >
                Edit Enrichment
              </button>
            }
          >
            <div className="flex flex-col gap-2 p-2">
              <div className="overflow-x-auto">
                <table className={opTable}>
                  <thead>
                    <tr className={opThRow}>
                      <th className={opTh} scope="col">
                        Field
                      </th>
                      <th className={opTh} scope="col">
                        Value
                      </th>
                      <th className={cn(opTh, 'w-[72px]')} scope="col">
                        Type
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrichment.map((row) => (
                      <tr key={row.field} className={opTr}>
                        <td className={cn(opTd, 'font-medium text-slate-800 dark:text-slate-100')}>{row.field}</td>
                        <td className={cn(opTd, 'max-w-[160px] truncate font-mono text-[11px] text-slate-600 dark:text-gdc-muted')}>{row.value}</td>
                        <td className={cn(opTd, 'text-slate-500')}>{row.type}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-200/70 pt-2 dark:border-gdc-border">
                <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-700 dark:text-gdc-mutedStrong">
                  <input type="checkbox" className="accent-violet-600" checked={withEnrichment} onChange={(e) => setWithEnrichment(e.target.checked)} />
                  Preview with enrichment
                </label>
                <button
                  type="button"
                  className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-slate-200/90 px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:text-slate-200 dark:hover:bg-gdc-rowHover"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  Refresh
                </button>
              </div>
            </div>
          </PanelChrome>
        </div>

        {/* Bottom row */}
        <div className="col-span-12 xl:col-span-4">
          <PanelChrome
            title="Field Library"
            right={
              <div className="relative hidden w-[160px] md:block">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
                <input
                  type="search"
                  placeholder="Search…"
                  className="h-7 w-full rounded-md border border-slate-200/90 bg-slate-50/80 py-0.5 pl-7 pr-2 text-[11px] dark:border-gdc-border dark:bg-gdc-section"
                  disabled
                  aria-label="Search field library"
                />
              </div>
            }
          >
            <ul className="space-y-1 p-2">
              {emptyShell.fieldLibrary.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12px] text-slate-700 hover:bg-slate-100/80 dark:text-slate-200 dark:hover:bg-gdc-rowHover"
                  >
                    <span>{g.label}</span>
                    <span className="tabular-nums text-[11px] text-slate-500">{g.count}</span>
                  </button>
                </li>
              ))}
              <li className="pt-1">
                <button
                  type="button"
                  className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-slate-300/90 py-1.5 text-[11px] font-medium text-slate-600 hover:border-violet-400 hover:bg-violet-500/[0.04] hover:text-violet-800 dark:border-gdc-border dark:text-gdc-muted dark:hover:border-violet-500/50 dark:hover:text-violet-200"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  New Field Group
                </button>
              </li>
            </ul>
          </PanelChrome>
        </div>

        <div className="col-span-12 xl:col-span-5">
          <PanelChrome title="Functions" className="max-h-[320px]">
            <div className="flex flex-col gap-2 p-2">
              <div className="flex flex-wrap gap-1">
                {(['all', 'string', 'number', 'date', 'logic', 'array', 'other'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setFuncTab(tab)}
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                      funcTab === tab ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-gdc-elevated dark:text-gdc-muted dark:hover:bg-gdc-rowHover',
                    )}
                  >
                    {tab === 'date' ? 'Date' : tab === 'all' ? 'All' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
              <div className="grid max-h-[220px] grid-cols-1 gap-1.5 overflow-auto sm:grid-cols-2">
                {functionCards.map((fn) => (
                  <div
                    key={fn.name}
                    className="rounded-md border border-slate-200/70 bg-slate-50/50 px-2 py-1.5 dark:border-gdc-border dark:bg-gdc-section"
                  >
                    <p className="font-mono text-[11px] font-semibold text-violet-800 dark:text-violet-200">{fn.name}</p>
                    <p className="font-mono text-[10px] text-slate-500 dark:text-gdc-muted">{fn.signature}</p>
                    <p className="mt-0.5 text-[10px] leading-snug text-slate-600 dark:text-gdc-muted">{fn.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </PanelChrome>
        </div>

        <div className="col-span-12 xl:col-span-3">
          <PanelChrome
            title="Tips"
            right={
              <BookOpen className="h-3.5 w-3.5 text-slate-400" aria-hidden />
            }
          >
            <ul className="space-y-2 p-2.5 text-[12px] leading-snug text-slate-600 dark:text-gdc-muted">
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-violet-500" aria-hidden />
                Click a field in the source tree to append a mapping row with an auto-generated JSONPath.
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-violet-500" aria-hidden />
                Use functions to transform or combine fields in enrichment or mapping expressions (engine wiring comes later).
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-violet-500" aria-hidden />
                Enrichment is kept separate from mapping — toggle preview to see the combined field view.
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-violet-500" aria-hidden />
                Run <strong>{mappingPresentation.workflow.apiTestShortLabel}</strong> if the live sample here looks wrong — this page
                auto-fetches using the same stream settings as the preview step when the stream id is numeric.
              </li>
            </ul>
            <div className="border-t border-slate-200/70 px-2.5 pb-2.5 pt-2 dark:border-gdc-border">
              <a
                className="inline-flex items-center gap-1 text-[12px] font-medium text-violet-700 hover:underline dark:text-violet-300"
                href="https://example.com/docs/mapping"
                target="_blank"
                rel="noreferrer"
              >
                Learn more about mapping
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            </div>
          </PanelChrome>
        </div>
      </div>
    </div>
  )
}
