import { ArrowRight, ChevronDown, HelpCircle, Loader2, Plus, RefreshCw, Search, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchConnectorById } from '../../api/gdcConnectors'
import { fetchStreamMappingUiConfig } from '../../api/gdcRuntime'
import { fetchStreamById } from '../../api/gdcStreams'
import { cn } from '../../lib/utils'
import { opTable, opTd, opTh, opThRow, opTr } from '../dashboard/widgets/operational-table-styles'
import { StatusBadge } from '../shell/status-badge'
import { MappingJsonTree, PanelChrome } from '../streams/mapping-json-tree'
import { resolveJsonPath } from '../streams/mapping-jsonpath'
import type { MappingEditRow, MappingFieldType } from './mapping-edit-types'

function guessType(value: unknown): MappingFieldType {
  if (typeof value === 'number') return 'number'
  if (typeof value === 'string' && /\d{4}-\d{2}-\d{2}T/.test(value)) return 'datetime'
  return 'string'
}

function suggestOutput(path: string): string {
  const key = path.split('.').at(-1) ?? 'field'
  return key.replace(/\[.*\]/g, '').replace(/[^a-zA-Z0-9_]/g, '_') || 'field'
}

function fieldMappingsToEditRows(fieldMappings: Record<string, string>): MappingEditRow[] {
  let i = 0
  return Object.entries(fieldMappings).map(([outputField, sourceJsonPath]) => ({
    id: `m-${i++}-${outputField}`,
    sourceJsonPath,
    outputField,
    type: 'string' as MappingFieldType,
    required: false,
    defaultValue: '',
    source: 'auto' as const,
  }))
}

type MappingMeta = {
  connector: string
  stream: string
  sourceType: string
  status: 'ACTIVE' | 'INACTIVE'
  targetSchema: string
  updatedAt: string
  updatedBy: string
}

const EMPTY_META: MappingMeta = {
  connector: '—',
  stream: '—',
  sourceType: '—',
  status: 'INACTIVE',
  targetSchema: '—',
  updatedAt: '—',
  updatedBy: '—',
}

export function MappingEditPage() {
  const { mappingId = '' } = useParams<{ mappingId: string }>()
  const navigate = useNavigate()
  const streamNum = /^\d+$/.test(mappingId) ? Number(mappingId) : null
  const [meta, setMeta] = useState<MappingMeta>(EMPTY_META)
  const [sourceDocument, setSourceDocument] = useState<Record<string, unknown>>({})
  const [rows, setRows] = useState<MappingEditRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sourceSearch, setSourceSearch] = useState('')
  const [tableSearch, setTableSearch] = useState('')
  const [sourceView, setSourceView] = useState<'tree' | 'json'>('tree')
  const [previewMode, setPreviewMode] = useState<'single' | 'batch'>('single')

  useEffect(() => {
    let cancelled = false
    if (streamNum == null) {
      setMeta(EMPTY_META)
      setRows([])
      setSourceDocument({})
      setLoadError('Mapping edit requires a numeric stream id in the URL.')
      return
    }
    setLoading(true)
    setLoadError(null)
    ;(async () => {
      try {
        const [stream, cfg] = await Promise.all([fetchStreamById(streamNum), fetchStreamMappingUiConfig(streamNum)])
        if (cancelled) return
        if (!stream || !cfg) {
          setMeta({ ...EMPTY_META, stream: `Stream ${streamNum}` })
          setRows([])
          setSourceDocument({})
          setLoadError('Could not load stream or mapping-ui config.')
          return
        }
        let connectorName = '—'
        const cid = typeof stream.connector_id === 'number' ? stream.connector_id : null
        if (cid != null) {
          const c = await fetchConnectorById(cid)
          if (!cancelled && c?.name) connectorName = c.name
        }
        const fm = cfg.mapping?.field_mappings ?? {}
        setRows(Object.keys(fm).length > 0 ? fieldMappingsToEditRows(fm) : [])
        setSourceDocument({})
        setMeta({
          connector: connectorName,
          stream: cfg.stream_name || stream.name || `Stream ${streamNum}`,
          sourceType: cfg.source_type ?? stream.stream_type ?? '—',
          status: stream.enabled === false ? 'INACTIVE' : 'ACTIVE',
          targetSchema: 'GDC Common Schema',
          updatedAt: stream.updated_at?.slice(0, 19).replace('T', ' ') ?? '—',
          updatedBy: '—',
        })
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Load failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [streamNum, mappingId])

  const filteredRows = useMemo(() => {
    const q = tableSearch.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => `${r.sourceJsonPath} ${r.outputField} ${r.type}`.toLowerCase().includes(q))
  }, [rows, tableSearch])

  const onPickPath = (path: string) => {
    const raw = resolveJsonPath(sourceDocument, path)
    setRows((prev) => [
      ...prev,
      {
        id: `pick-${Date.now()}`,
        sourceJsonPath: path,
        outputField: suggestOutput(path),
        type: guessType(raw),
        required: false,
        defaultValue: '',
        source: 'manual',
      },
    ])
  }

  const preview = useMemo(() => {
    const out: Record<string, unknown> = {}
    for (const row of rows) {
      const resolved = resolveJsonPath(sourceDocument, row.sourceJsonPath)
      const value = resolved === undefined ? (row.defaultValue || null) : resolved
      out[row.outputField] = value
    }
    return out
  }, [rows, sourceDocument])

  const summary = useMemo(() => {
    const required = rows.filter((r) => r.required).length
    const optional = rows.length - required
    const custom = rows.filter((r) => r.source === 'custom').length
    const unmappedRequired = rows.filter((r) => r.required && !r.sourceJsonPath).length
    return { total: rows.length, required, optional, custom, unmappedRequired }
  }, [rows])

  return (
    <div className="w-full min-w-0 space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-200/70 bg-white/80 p-3 dark:border-gdc-border dark:bg-gdc-card">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">Edit Mapping</h2>
            <StatusBadge tone={meta.status === 'ACTIVE' ? 'success' : 'neutral'}>{meta.status}</StatusBadge>
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-hidden /> : null}
          </div>
          <p className="text-[13px] text-slate-600 dark:text-gdc-muted">Define how source fields are mapped to output fields and preview the result.</p>
          {loadError ? <p className="text-[12px] font-medium text-amber-800 dark:text-amber-200">{loadError}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-3 text-[12px] font-medium hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card">
            <RefreshCw className="h-3.5 w-3.5" />
            Preview Output
          </button>
          <button type="button" onClick={() => navigate('/mappings')} className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-3 text-[12px] font-medium hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card">
            Cancel
          </button>
          <button type="button" className="inline-flex h-8 items-center gap-1 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white hover:bg-violet-700">
            Save Mapping
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200/70 bg-white/80 p-3 text-[12px] dark:border-gdc-border dark:bg-gdc-card md:grid-cols-4 xl:grid-cols-7">
        {[
          ['Connector', meta.connector],
          ['Stream', meta.stream],
          ['Source Type', meta.sourceType],
          ['Mapping Status', meta.status],
          ['Target Schema', meta.targetSchema],
          ['Last Updated', meta.updatedAt],
          ['Updated By', meta.updatedBy],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
            <p className="truncate pt-0.5 font-medium text-slate-800 dark:text-slate-100">{value}</p>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 xl:col-span-3">
          <PanelChrome
            title="Source Fields"
            right={
              <div className="flex rounded-md border border-slate-200 bg-slate-50 p-0.5 text-[11px] dark:border-gdc-border dark:bg-gdc-card">
                <button type="button" onClick={() => setSourceView('tree')} className={cn('rounded px-2 py-0.5', sourceView === 'tree' && 'bg-white shadow dark:bg-gdc-elevated')}>
                  Tree
                </button>
                <button type="button" onClick={() => setSourceView('json')} className={cn('rounded px-2 py-0.5', sourceView === 'json' && 'bg-white shadow dark:bg-gdc-elevated')}>
                  JSON
                </button>
              </div>
            }
          >
            <div className="border-b border-slate-200/70 p-2 dark:border-gdc-border">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={sourceSearch}
                  onChange={(e) => setSourceSearch(e.target.value)}
                  placeholder="Search fields…"
                  className="h-8 w-full rounded-md border border-slate-200 bg-white pl-7 pr-2 text-[12px] dark:border-gdc-border dark:bg-gdc-card"
                />
              </div>
            </div>
            <div className="max-h-[420px] overflow-auto p-2">
              {Object.keys(sourceDocument).length === 0 ? (
                <p className="px-2 py-4 text-[12px] text-slate-500 dark:text-gdc-muted">
                  No source sample loaded. Open stream mapping to fetch live data, or pick paths after loading config rows.
                </p>
              ) : sourceView === 'tree' ? (
                <MappingJsonTree value={sourceDocument} baseLabel="" basePath="$" search={sourceSearch} onPickPath={onPickPath} />
              ) : (
                <pre className="overflow-auto rounded-md bg-slate-950 p-2 text-[10px] text-slate-100">{JSON.stringify(sourceDocument, null, 2)}</pre>
              )}
            </div>
          </PanelChrome>
        </div>

        <div className="col-span-12 xl:col-span-6">
          <PanelChrome
            title="Field Mappings"
            right={
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    value={tableSearch}
                    onChange={(e) => setTableSearch(e.target.value)}
                    placeholder="Search mappings…"
                    className="h-7 w-40 rounded-md border border-slate-200 bg-white pl-7 pr-2 text-[11px] dark:border-gdc-border dark:bg-gdc-card"
                  />
                </div>
                <button type="button" className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium dark:border-gdc-border dark:bg-gdc-card">
                  <Sparkles className="h-3 w-3" />
                  Auto-map
                </button>
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1 rounded-md bg-violet-600 px-2 text-[11px] font-semibold text-white"
                  onClick={() =>
                    setRows((prev) => [
                      ...prev,
                      {
                        id: `new-${Date.now()}`,
                        sourceJsonPath: '',
                        outputField: '',
                        type: 'string',
                        required: false,
                        defaultValue: '',
                        source: 'custom',
                      },
                    ])
                  }
                >
                  <Plus className="h-3 w-3" />
                  Add
                </button>
              </div>
            }
          >
            <div className="overflow-x-auto">
              <table className={opTable}>
                <thead>
                  <tr className={opThRow}>
                    <th className={opTh}>Source JSON Path</th>
                    <th className={opTh}>Output Field</th>
                    <th className={opTh}>Type</th>
                    <th className={opTh}>Required</th>
                    <th className={opTh}>Default</th>
                    <th className={cn(opTh, 'text-right')}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr className={opTr}>
                      <td colSpan={6} className={cn(opTd, 'text-center text-slate-500')}>
                        {loading ? 'Loading mapping config…' : 'No field mappings configured for this stream.'}
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row) => (
                      <tr key={row.id} className={opTr}>
                        <td className={cn(opTd, 'font-mono text-[11px]')}>{row.sourceJsonPath || '—'}</td>
                        <td className={opTd}>{row.outputField}</td>
                        <td className={opTd}>{row.type}</td>
                        <td className={opTd}>{row.required ? 'Yes' : 'No'}</td>
                        <td className={opTd}>{row.defaultValue || '—'}</td>
                        <td className={cn(opTd, 'text-right')}>
                          <button type="button" onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))} className="text-red-600 hover:text-red-700">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </PanelChrome>
        </div>

        <div className="col-span-12 xl:col-span-3 space-y-3">
          <PanelChrome title="Mapping Summary">
            <ul className="space-y-1 p-2.5 text-[12px]">
              <li className="flex justify-between"><span className="text-slate-500">Total fields</span><span className="font-semibold">{summary.total}</span></li>
              <li className="flex justify-between"><span className="text-slate-500">Required</span><span className="font-semibold">{summary.required}</span></li>
              <li className="flex justify-between"><span className="text-slate-500">Optional</span><span className="font-semibold">{summary.optional}</span></li>
              <li className="flex justify-between"><span className="text-slate-500">Custom</span><span className="font-semibold">{summary.custom}</span></li>
              <li className="flex justify-between"><span className="text-slate-500">Unmapped required</span><span className="font-semibold text-amber-700">{summary.unmappedRequired}</span></li>
            </ul>
          </PanelChrome>

          <PanelChrome
            title="Output Preview"
            right={
              <div className="flex rounded-md border border-slate-200 bg-slate-50 p-0.5 text-[11px] dark:border-gdc-border dark:bg-gdc-card">
                <button type="button" onClick={() => setPreviewMode('single')} className={cn('rounded px-2 py-0.5', previewMode === 'single' && 'bg-white shadow dark:bg-gdc-elevated')}>
                  Single
                </button>
                <button type="button" onClick={() => setPreviewMode('batch')} className={cn('rounded px-2 py-0.5', previewMode === 'batch' && 'bg-white shadow dark:bg-gdc-elevated')}>
                  Batch
                </button>
              </div>
            }
          >
            <pre className="max-h-[280px] overflow-auto p-2.5 text-[10px] text-slate-700 dark:text-slate-200">{JSON.stringify(preview, null, 2)}</pre>
          </PanelChrome>

          <PanelChrome title="Need help?">
            <div className="space-y-2 p-2.5 text-[12px] text-slate-600 dark:text-gdc-muted">
              <p>Mapping rows are loaded from the stream mapping-ui config API.</p>
              <p className="inline-flex items-center gap-1 font-medium text-violet-700 dark:text-violet-300">
                Documentation
                <ArrowRight className="h-3 w-3" />
              </p>
              <HelpCircle className="h-4 w-4 text-slate-400" aria-hidden />
            </div>
          </PanelChrome>
        </div>
      </div>
    </div>
  )
}
