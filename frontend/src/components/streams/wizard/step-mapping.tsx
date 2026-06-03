import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Layers,
  Maximize2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Wand2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { resolveJsonPath } from '../mapping-jsonpath'
import { MappingJsonTree, PanelChrome, type MappingJsonTreeExpandStrategy } from '../mapping-json-tree'
import { cn } from '../../../lib/utils'
import type { WizardMappingRow, WizardState } from './wizard-state'
import { flattenSampleFields } from './wizard-json-extract'
import { MetadataMappingMenu } from './metadata-mapping-menu'
import { applyAutoSuggestTopLevel, unmappedTopLevelSourcePaths } from './wizard-mapping-merge'

type StepMappingProps = {
  state: WizardState
  onChangeMapping: (rows: WizardMappingRow[]) => void
}

const SUGGESTED_FIELD_GROUPS: ReadonlyArray<{ title: string; names: readonly string[] }> = [
  {
    title: 'Common Fields',
    names: ['message', 'severity', 'title', 'description', 'event_type', 'category', 'type', 'name'],
  },
  {
    title: 'Identifiers',
    names: ['id', '_id', 'event_id', 'uuid', 'guid', 'anomaly_id', 'src_ip', 'dst_ip', 'host', 'hostname'],
  },
  {
    title: 'Timestamps',
    names: ['timestamp', '@timestamp', 'time', 'created_at', 'updated_at', 'event_time', 'ts'],
  },
]

function suggestOutputField(jsonPath: string): string {
  const segments = jsonPath.split(/[\.\[\]]/).filter(Boolean)
  const last = segments[segments.length - 1] ?? 'field'
  return last.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase() || 'field'
}

function relativeToRootPath(jsonPath: string, rootPath: string): string {
  const rp = rootPath.trim()
  if (!rp || rp === '$') return jsonPath
  const rootPrefix = rp.startsWith('$') ? rp : `$.${rp}`
  if (jsonPath === rootPrefix) return '$'
  if (jsonPath.startsWith(`${rootPrefix}.`) || jsonPath.startsWith(`${rootPrefix}[`)) {
    const rest = jsonPath.slice(rootPrefix.length)
    const stripped = rest.replace(/^\[\d+\]/, '')
    return stripped ? `$${stripped}` : '$'
  }
  return jsonPath
}

function newRowId(): string {
  return `row-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`
}

function formatEventArrayLabel(state: WizardState): string {
  if (state.stream.useWholeResponseAsEvent) return '(whole response)'
  const p = state.stream.eventArrayPath.trim()
  if (!p) return '$'
  return p.startsWith('$') ? p : `$.${p}`
}

function inferValueType(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  const t = typeof v
  if (t === 'object') return 'object'
  return t
}

function truncatePreview(v: unknown, max = 56): string {
  if (v === undefined) return 'undefined'
  if (v === null) return 'null'
  if (typeof v === 'string') {
    return v.length > max ? `${v.slice(0, max)}…` : v
  }
  try {
    const s = JSON.stringify(v)
    return s.length > max ? `${s.slice(0, max)}…` : s
  } catch {
    return String(v)
  }
}

function findSuggestionPath(suggestionName: string, flatPaths: string[]): string | null {
  const want = suggestionName.replace(/^@/, '').toLowerCase()
  const snLower = suggestionName.toLowerCase()
  const exact = flatPaths.find((p) => {
    const seg = p.split(/[\.\[\]]/).filter(Boolean).pop()
    if (!seg) return false
    const sl = seg.toLowerCase().replace(/^@/, '')
    return sl === want || seg.toLowerCase() === snLower
  })
  return exact ?? null
}

/**
 * Curated common destination field names shown in the chip popover.
 *
 * The user can ignore this list entirely and type any value they like — there
 * is no enforced prefix. The list exists purely as a quick-pick aid.
 */
const COMMON_DEST_FIELDS: readonly string[] = [
  'event_name',
  'event_timestamp',
  'event_type',
  'event_severity',
  'event_action',
  'event_outcome',
  'event_message',
  'event_category',
  'event_id',
  'src_ip',
  'src_account',
  'dst_ip',
  'host_name',
  'user_name',
  'asset_name',
  'cloud_account',
  'cloud_region',
  'session_id',
]

const RECENT_DEST_STORAGE_KEY = 'gdc:wizard:recent-destination-fields'
const RECENT_DEST_LIMIT = 8

function loadRecentDestinations(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENT_DEST_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .slice(0, RECENT_DEST_LIMIT)
  } catch {
    return []
  }
}

function saveRecentDestinations(list: string[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(RECENT_DEST_STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* ignore quota / disabled storage */
  }
}

type DestinationFieldChipProps = {
  value: string
  warning?: 'duplicate' | null
  onChange: (name: string) => void
  commonFields: readonly string[]
  recentCustom: readonly string[]
  onRegisterCustom: (name: string) => void
}

/**
 * Chip-shaped picker for the destination (output) field of a mapping row.
 *
 * Behavior summary:
 *   - Shows current `outputField` as a coloured pill; placeholder when empty.
 *   - Click opens a popover anchored below the chip (fixed-positioned so the
 *     parent scroll container does not clip it).
 *   - Popover has a single text input that doubles as a search box AND a
 *     free-form custom-name input — there is no fixed prefix.
 *   - Pressing Enter or clicking "Create custom field" applies the typed value
 *     verbatim and remembers it under Recently Used.
 */
/** Popover width (matches `w-72` Tailwind class on the popover root). */
const POPOVER_WIDTH = 288
const POPOVER_GAP = 4
const VIEWPORT_MARGIN = 8

function DestinationFieldChip({
  value,
  warning,
  onChange,
  commonFields,
  recentCustom,
  onRegisterCustom,
}: DestinationFieldChipProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const chipRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  /**
   * Compute popover coordinates **synchronously from the chip's current
   * bounding rect**. We anchor the popover's RIGHT edge to the chip's right
   * edge and convert to a `left` value so the popover never drifts when the
   * window or chip width changes between renders.
   *
   * The popover is also clamped to the viewport so it does not slide
   * off-screen on narrow widths.
   */
  const computeCoords = useCallback((): { top: number; left: number } | null => {
    const r = chipRef.current?.getBoundingClientRect()
    if (!r) return null
    const desiredLeft = r.right - POPOVER_WIDTH
    const maxLeft = window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN
    const left = Math.max(VIEWPORT_MARGIN, Math.min(desiredLeft, maxLeft))
    return { top: r.bottom + POPOVER_GAP, left }
  }, [])

  /**
   * Toggle handler that computes coords *before* `open` flips to true. This
   * batches both state updates into a single render so the popover is painted
   * at the correct position on its very first frame — eliminating the
   * "popover jumps after appearing" effect that came from computing coords in
   * a post-render useEffect.
   */
  const handleToggle = useCallback(() => {
    if (open) {
      setOpen(false)
      return
    }
    const next = computeCoords()
    if (next) setCoords(next)
    setQuery('')
    setOpen(true)
  }, [open, computeCoords])

  useEffect(() => {
    if (!open) return
    function onScroll(e: Event) {
      const target = e.target as Node | null
      // Scrolling inside the field list (native scrollbar / wheel) must not close.
      if (target && popoverRef.current?.contains(target)) return
      // Ancestor scroll moved the chip — re-anchor instead of closing.
      const next = computeCoords()
      if (next) setCoords(next)
    }
    function onResize() {
      const next = computeCoords()
      if (next) setCoords(next)
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, computeCoords])

  useEffect(() => {
    if (!open) return
    function isInsidePopover(e: MouseEvent): boolean {
      const chip = chipRef.current
      const pop = popoverRef.current
      const path = e.composedPath()
      if (chip && path.includes(chip)) return true
      if (pop && path.includes(pop)) return true
      // Native scrollbar hits may not appear in composedPath/contains — use bounds.
      if (pop) {
        const r = pop.getBoundingClientRect()
        const { clientX: x, clientY: y } = e
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true
      }
      return false
    }
    function onDoc(e: MouseEvent) {
      if (isInsidePopover(e)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const queryTrim = query.trim()
  const qLower = queryTrim.toLowerCase()
  const filteredCommon = useMemo(
    () => (qLower ? commonFields.filter((f) => f.toLowerCase().includes(qLower)) : commonFields),
    [commonFields, qLower],
  )
  const filteredRecent = useMemo(
    () => (qLower ? recentCustom.filter((f) => f.toLowerCase().includes(qLower)) : recentCustom),
    [recentCustom, qLower],
  )
  const existsAsCommon = commonFields.some((f) => f === queryTrim)
  const existsAsRecent = recentCustom.some((f) => f === queryTrim)
  const showCreate = queryTrim.length > 0 && !existsAsCommon && !existsAsRecent

  const applyName = useCallback(
    (name: string, isCustom: boolean) => {
      onChange(name)
      if (isCustom) onRegisterCustom(name)
      setOpen(false)
    },
    [onChange, onRegisterCustom],
  )

  const popoverStyle: CSSProperties | undefined = coords
    ? { position: 'fixed', top: coords.top, left: coords.left, width: POPOVER_WIDTH }
    : undefined

  return (
    <>
      <button
        ref={chipRef}
        type="button"
        onClick={handleToggle}
        className={cn(
          'inline-flex h-7 min-w-[132px] max-w-[200px] items-center justify-between gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors',
          value
            ? 'border-violet-300/80 bg-violet-500/10 text-violet-800 hover:bg-violet-500/15 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-100'
            : 'border-dashed border-slate-300 bg-white text-slate-500 hover:border-violet-400 hover:text-violet-700 dark:border-gdc-border dark:bg-gdc-section dark:text-gdc-muted dark:hover:border-violet-500/40 dark:hover:text-violet-200',
          warning === 'duplicate' && 'border-amber-400 dark:border-amber-500/60',
        )}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Destination field"
        title={value || 'Choose destination field'}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {value ? (
            <>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" aria-hidden />
              <span className="truncate font-mono">{value}</span>
            </>
          ) : (
            <span className="truncate">Choose destination…</span>
          )}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
      </button>
      {open && coords && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              style={popoverStyle}
              onMouseDown={(e) => e.stopPropagation()}
              className="z-50 rounded-lg border border-slate-200/90 bg-white p-2 text-[11px] shadow-xl dark:border-gdc-border dark:bg-gdc-elevated"
            >
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                  aria-hidden
                />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (queryTrim) applyName(queryTrim, !existsAsCommon)
                    }
                  }}
                  placeholder="Search fields or type custom…"
                  className="mb-1.5 h-7 w-full rounded-md border border-slate-200/90 bg-slate-50/70 pl-7 pr-2 text-[11px] outline-none focus:border-violet-400 dark:border-gdc-border dark:bg-gdc-card dark:focus:border-violet-500/60"
                  aria-label="Search or type destination field name"
                />
              </div>
              {showCreate ? (
                <button
                  type="button"
                  onClick={() => applyName(queryTrim, true)}
                  className="mb-1.5 flex w-full items-center gap-2 rounded-md border border-violet-300/70 bg-violet-500/[0.08] px-2 py-1.5 text-left text-violet-800 hover:bg-violet-500/15 dark:border-violet-500/40 dark:bg-violet-500/[0.15] dark:text-violet-100"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-violet-700/80 dark:text-violet-300/80">
                      Create custom field
                    </p>
                    <p className="truncate font-mono text-[11px]">{queryTrim}</p>
                  </div>
                </button>
              ) : null}
              {filteredRecent.length > 0 ? (
                <div className="mb-1.5">
                  <p className="px-1 pb-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-500 dark:text-gdc-muted">
                    Recently Used
                  </p>
                  <ul role="listbox" aria-label="Recently used destination fields">
                    {filteredRecent.map((name) => (
                      <li key={`recent-${name}`}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={value === name}
                          onClick={() => applyName(name, true)}
                          className={cn(
                            'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-gdc-rowHover',
                            value === name &&
                              'bg-violet-500/10 text-violet-800 dark:bg-violet-500/15 dark:text-violet-100',
                          )}
                        >
                          <span className="truncate font-mono">{name}</span>
                          {value === name ? (
                            <Check className="h-3.5 w-3.5 shrink-0 text-violet-500" aria-hidden />
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div>
                <p className="px-1 pb-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-500 dark:text-gdc-muted">
                  Common Fields
                </p>
                {filteredCommon.length === 0 ? (
                  <p className="px-1 py-1 text-[10px] italic text-slate-500 dark:text-gdc-muted">
                    No common fields match.
                  </p>
                ) : (
                  <ul
                    role="listbox"
                    aria-label="Common destination fields"
                    className="max-h-56 overflow-y-auto overscroll-contain"
                  >
                    {filteredCommon.map((name) => (
                      <li key={`common-${name}`}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={value === name}
                          onClick={() => applyName(name, false)}
                          className={cn(
                            'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-gdc-rowHover',
                            value === name &&
                              'bg-violet-500/10 text-violet-800 dark:bg-violet-500/15 dark:text-violet-100',
                          )}
                        >
                          <span className="truncate font-mono">{name}</span>
                          {value === name ? (
                            <Check className="h-3.5 w-3.5 shrink-0 text-violet-500" aria-hidden />
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

export function StepMapping({ state, onChangeMapping }: StepMappingProps) {
  const [sampleView, setSampleView] = useState<'tree' | 'json'>('tree')
  const [previewTab, setPreviewTab] = useState<'preview' | 'raw_final'>('preview')
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null)
  const [flashRowId, setFlashRowId] = useState<string | null>(null)
  const [treeExpandStrategy, setTreeExpandStrategy] = useState<MappingJsonTreeExpandStrategy>('smart')
  const [treeMountKey, setTreeMountKey] = useState(0)
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(false)
  const [mappingSearch, setMappingSearch] = useState('')
  const [recentCustomFields, setRecentCustomFields] = useState<string[]>(() => loadRecentDestinations())

  const registerCustomField = useCallback((name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setRecentCustomFields((prev) => {
      const next = [trimmed, ...prev.filter((n) => n !== trimmed)].slice(0, RECENT_DEST_LIMIT)
      saveRecentDestinations(next)
      return next
    })
  }, [])

  const sampleEvent = state.apiTest.extractedEvents[0] ?? null
  const rootPath = state.stream.eventRootPath.trim() || '$'
  const quickFields = useMemo(() => {
    const fromAnalysis = state.apiTest.analysis?.flatPreviewFields
    if (fromAnalysis?.length) return fromAnalysis
    return flattenSampleFields(sampleEvent)
  }, [sampleEvent, state.apiTest.analysis?.flatPreviewFields])

  const flashHighlightPath = useMemo(() => {
    const row = state.mapping.find((r) => r.id === flashRowId)
    return row?.sourceJsonPath.trim() ?? null
  }, [flashRowId, state.mapping])

  const bumpFlash = useCallback((rowId: string) => {
    setFlashRowId(rowId)
    window.setTimeout(() => setFlashRowId(null), 2800)
  }, [])

  const handlePickPath = useCallback(
    (jsonPath: string) => {
      const relPath = relativeToRootPath(jsonPath, rootPath)
      let duplicate = false
      const next = [...state.mapping]
      if (next.some((m) => m.sourceJsonPath === relPath)) {
        duplicate = true
      } else {
        const id = newRowId()
        next.push({
          id,
          outputField: suggestOutputField(relPath),
          sourceJsonPath: relPath,
        })
        bumpFlash(id)
      }
      if (duplicate) {
        setDuplicateNotice(`Already mapped: ${relPath}`)
        window.setTimeout(() => setDuplicateNotice(null), 2500)
        return
      }
      setDuplicateNotice(null)
      onChangeMapping(next)
    },
    [rootPath, onChangeMapping, state.mapping, bumpFlash],
  )

  const autoSuggest = useCallback(() => {
    if (!sampleEvent || typeof sampleEvent !== 'object' || Array.isArray(sampleEvent)) return
    onChangeMapping(
      applyAutoSuggestTopLevel(state.mapping, sampleEvent as Record<string, unknown>, newRowId),
    )
  }, [onChangeMapping, sampleEvent, state.mapping])

  const resetMapping = useCallback(() => {
    if (state.mapping.length === 0) return
    if (!window.confirm('Clear all field mappings?')) return
    onChangeMapping([])
    setDuplicateNotice(null)
  }, [onChangeMapping, state.mapping.length])

  const clearAllRows = useCallback(() => {
    resetMapping()
  }, [resetMapping])

  const mappedPreview = useMemo(() => {
    if (!sampleEvent) return null
    const out: Record<string, unknown> = {}
    for (const row of state.mapping) {
      const path = row.sourceJsonPath.trim()
      const key = row.outputField.trim()
      if (!path || !key) continue
      out[key] = resolveJsonPath(sampleEvent, path)
    }
    return out
  }, [sampleEvent, state.mapping])

  const rawSampleJson = useMemo(() => {
    if (!sampleEvent) return ''
    try {
      return JSON.stringify(sampleEvent, null, 2)
    } catch {
      return ''
    }
  }, [sampleEvent])

  const mappedPreviewJson = useMemo(() => {
    if (!mappedPreview) return ''
    try {
      return JSON.stringify(mappedPreview, null, 2)
    } catch {
      return ''
    }
  }, [mappedPreview])

  const duplicateOutputKeys = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of state.mapping) {
      const k = row.outputField.trim().toLowerCase()
      if (!k) continue
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    const dups = new Set<string>()
    for (const [k, n] of counts) {
      if (n > 1) dups.add(k)
    }
    return dups
  }, [state.mapping])

  const rowWarnings = useMemo(() => {
    const map = new Map<string, { dup: boolean; missing: boolean }>()
    if (!sampleEvent) return map
    for (const row of state.mapping) {
      const key = row.outputField.trim().toLowerCase()
      const dup = key ? duplicateOutputKeys.has(key) : false
      const path = row.sourceJsonPath.trim()
      let missing = false
      if (path) {
        const v = resolveJsonPath(sampleEvent, path)
        missing = v === undefined || v === null
      }
      map.set(row.id, { dup, missing })
    }
    return map
  }, [sampleEvent, state.mapping, duplicateOutputKeys])

  const stats = useMemo(() => {
    const mappedCount = state.mapping.filter((r) => r.outputField.trim() && r.sourceJsonPath.trim()).length
    const staticCount = state.enrichment.filter((e) => e.fieldName.trim()).length
    const totalKeys = new Set<string>()
    for (const r of state.mapping) {
      const k = r.outputField.trim()
      if (k) totalKeys.add(k)
    }
    for (const e of state.enrichment) {
      const k = e.fieldName.trim()
      if (k) totalKeys.add(k)
    }
    const sampleRecord =
      sampleEvent && typeof sampleEvent === 'object' && !Array.isArray(sampleEvent)
        ? (sampleEvent as Record<string, unknown>)
        : null
    const unmappedSourceCount = unmappedTopLevelSourcePaths(state.mapping, sampleRecord).length
    const missingRequired = state.mapping.some((r) => !r.outputField.trim() || !r.sourceJsonPath.trim())
    const potentialIssues =
      duplicateOutputKeys.size > 0 ||
      [...rowWarnings.values()].some((w) => w.dup || w.missing)
    return {
      mappedCount,
      staticCount,
      enrichedCount: staticCount,
      totalOutput: totalKeys.size,
      unmappedSourceCount,
      missingRequired,
      potentialIssues,
    }
  }, [sampleEvent, state.mapping, state.enrichment, duplicateOutputKeys, rowWarnings])

  const handleSuggestedChip = useCallback(
    (name: string) => {
      const path = findSuggestionPath(name, quickFields)
      if (!path) return
      handlePickPath(path)
    },
    [quickFields, handlePickPath],
  )

  const copyFinalJson = useCallback(async () => {
    const text = mappedPreviewJson || '{}'
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      }
    } catch {
      // ignore
    }
  }, [mappedPreviewJson])

  const duplicateRow = useCallback(
    (idx: number) => {
      const row = state.mapping[idx]
      if (!row) return
      const next = [...state.mapping]
      next.splice(idx + 1, 0, {
        id: newRowId(),
        outputField: `${row.outputField}_copy`,
        sourceJsonPath: row.sourceJsonPath,
      })
      onChangeMapping(next)
    },
    [onChangeMapping, state.mapping],
  )

  const expandAll = useCallback(() => {
    setTreeExpandStrategy('all')
    setTreeMountKey((k) => k + 1)
  }, [])

  const collapseAll = useCallback(() => {
    setTreeExpandStrategy('minimal')
    setTreeMountKey((k) => k + 1)
  }, [])

  return (
    <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
      <p className="text-[12px] leading-relaxed text-slate-600 dark:text-gdc-muted">
        Map fields from the sample event to your output schema. Click a field in the JSON to add it to the mapping.
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={autoSuggest}
          disabled={!sampleEvent}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-violet-300/70 bg-white px-3 text-[12px] font-semibold text-violet-700 shadow-sm hover:bg-violet-500/[0.08] disabled:opacity-60 dark:border-violet-500/40 dark:bg-gdc-card dark:text-violet-300 dark:hover:bg-violet-500/15"
        >
          <Wand2 className="h-3.5 w-3.5" aria-hidden />
          Auto-suggest top-level fields
        </button>
        <MetadataMappingMenu state={state} onChangeMapping={onChangeMapping} />
        <button
          type="button"
          onClick={resetMapping}
          disabled={state.mapping.length === 0}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Reset mapping
        </button>
      </div>

      {!sampleEvent ? (
        <p className="mt-4 rounded-md border border-amber-200/80 bg-amber-500/[0.06] p-3 text-[12px] text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          Run the Fetch Sample Data step first so we can show a sample event. You can also add empty rows and configure them
          manually below.
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(300px,1.15fr)_minmax(280px,1fr)_minmax(320px,1.05fr)] xl:items-stretch">
        {/* Left: sample event */}
        <PanelChrome
          className="max-h-[min(72vh,760px)] min-h-[min(72vh,760px)] [&>div:last-child]:flex [&>div:last-child]:min-h-0 [&>div:last-child]:flex-1 [&>div:last-child]:flex-col [&>div:last-child]:overflow-hidden"
          title="Sample Event"
          right={
            <div className="flex items-center gap-1.5">
              {duplicateNotice ? (
                <span className="mr-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                  {duplicateNotice}
                </span>
              ) : null}
              <div className="inline-flex rounded-md border border-slate-200/90 p-0.5 dark:border-gdc-border">
                <button
                  type="button"
                  onClick={() => setSampleView('tree')}
                  className={cn(
                    'rounded px-2 py-0.5 text-[10px] font-semibold',
                    sampleView === 'tree'
                      ? 'bg-violet-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover',
                  )}
                >
                  Tree
                </button>
                <button
                  type="button"
                  onClick={() => setSampleView('json')}
                  className={cn(
                    'rounded px-2 py-0.5 text-[10px] font-semibold',
                    sampleView === 'json'
                      ? 'bg-violet-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover',
                  )}
                >
                  JSON
                </button>
              </div>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={expandAll}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200/90 text-slate-600 hover:bg-slate-50 dark:border-gdc-border dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover"
                  title="Expand all"
                  aria-label="Expand all"
                >
                  <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={collapseAll}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200/90 text-slate-600 hover:bg-slate-50 dark:border-gdc-border dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover"
                  title="Collapse all"
                  aria-label="Collapse all"
                >
                  <Layers className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            </div>
          }
        >
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 space-y-0.5 border-b border-slate-200/70 px-2.5 py-2 text-[11px] text-slate-600 dark:border-gdc-border dark:text-gdc-muted">
              <p>
                <span className="font-semibold text-slate-700 dark:text-slate-200">Event array: </span>
                <span className="font-mono text-violet-700 dark:text-violet-300">{formatEventArrayLabel(state)}</span>
              </p>
              <p>
                <span className="font-semibold text-slate-700 dark:text-slate-200">Records: </span>
                {state.apiTest.eventCount}
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-2">
              {sampleView === 'tree' && sampleEvent ? (
                <MappingJsonTree
                  key={`${treeMountKey}-${treeExpandStrategy}`}
                  value={sampleEvent}
                  baseLabel="event"
                  basePath="$"
                  search=""
                  onPickPath={handlePickPath}
                  expandStrategy={treeExpandStrategy}
                  activeHighlightPath={flashHighlightPath}
                />
              ) : null}
              {sampleView === 'json' && sampleEvent ? (
                <pre className="min-h-full overflow-auto rounded-md border border-slate-200/80 bg-slate-950/90 p-2 text-[10px] leading-snug text-emerald-100 dark:border-gdc-border">
                  {rawSampleJson}
                </pre>
              ) : null}
              {!sampleEvent ? (
                <p className="px-1 py-3 text-[11px] italic text-slate-500">No sample event available yet.</p>
              ) : null}
            </div>
          </div>
        </PanelChrome>

        {/* Center: mapping + suggestions */}
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <PanelChrome
            className="max-h-[min(52vh,560px)] min-h-0"
            title="Field Mapping"
            right={
              <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold text-violet-800 dark:text-violet-200">
                {stats.mappedCount} mapped
              </span>
            }
          >
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/70 px-2.5 py-2 dark:border-gdc-border">
              <div className="relative min-w-[160px] flex-1">
                <Search
                  className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-gdc-muted"
                  aria-hidden
                />
                <input
                  type="search"
                  value={mappingSearch}
                  onChange={(e) => setMappingSearch(e.target.value)}
                  placeholder="Search fields…"
                  className="h-7 w-full rounded-md border border-slate-200/90 bg-white pl-7 pr-2 text-[11px] text-slate-800 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100"
                  aria-label="Filter mapping rows"
                />
              </div>
              <button
                type="button"
                onClick={() =>
                  onChangeMapping([...state.mapping, { id: newRowId(), outputField: '', sourceJsonPath: '' }])
                }
                className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200/90 bg-white px-2 text-[11px] font-semibold text-slate-800 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add row
              </button>
              <button
                type="button"
                onClick={clearAllRows}
                disabled={state.mapping.length === 0}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-red-200/90 bg-white px-2 text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-500/30 dark:bg-gdc-card dark:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Clear all
              </button>
            </div>
            <div className="min-h-0 overflow-auto">
              {state.mapping.length === 0 ? (
                <p className="p-3 text-[11px] italic text-slate-500">
                  No mappings yet. Click a JSON node on the left to add one, or use Auto-suggest.
                </p>
              ) : (
                (() => {
                  const filterQ = mappingSearch.trim().toLowerCase()
                  const visibleRows = filterQ
                    ? state.mapping.filter((r) => {
                        const hay = `${r.outputField} ${r.sourceJsonPath}`.toLowerCase()
                        return hay.includes(filterQ)
                      })
                    : state.mapping
                  if (visibleRows.length === 0) {
                    return (
                      <p className="p-3 text-[11px] italic text-slate-500 dark:text-gdc-muted">
                        No mappings match “{mappingSearch}”.
                      </p>
                    )
                  }
                  return (
                    <ul className="divide-y divide-slate-200/70 dark:divide-gdc-border">
                      {visibleRows.map((row) => {
                        const idx = state.mapping.findIndex((m) => m.id === row.id)
                        const path = row.sourceJsonPath.trim()
                        const resolved = sampleEvent && path ? resolveJsonPath(sampleEvent, path) : undefined
                        const typ = inferValueType(resolved)
                        const warn = rowWarnings.get(row.id)
                        const isNew = flashRowId === row.id
                        const sampleText = truncatePreview(resolved)
                        return (
                          <li
                            key={row.id}
                            className={cn(
                              'group/row flex items-start gap-2 px-3 py-2.5 transition-colors',
                              isNew && 'bg-violet-500/[0.12]',
                              warn?.dup && 'bg-amber-500/[0.06] dark:bg-amber-500/[0.08]',
                              !isNew && !warn?.dup && 'hover:bg-slate-50/80 dark:hover:bg-gdc-rowHover/60',
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <input
                                  value={row.sourceJsonPath}
                                  placeholder="$.id"
                                  onChange={(e) => {
                                    const next = [...state.mapping]
                                    next[idx] = { ...row, sourceJsonPath: e.target.value }
                                    onChangeMapping(next)
                                  }}
                                  className={cn(
                                    'h-6 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 font-mono text-[11px] text-slate-800 outline-none hover:border-slate-200/90 hover:bg-white/60 focus:border-violet-400 focus:bg-white dark:text-slate-100 dark:hover:border-gdc-border dark:hover:bg-gdc-section/40 dark:focus:border-violet-500/60 dark:focus:bg-gdc-section',
                                  )}
                                  aria-label="Source JSONPath"
                                />
                                <span className="shrink-0 rounded-full bg-violet-500/15 px-1.5 py-px text-[9px] font-semibold capitalize text-violet-800 dark:text-violet-200">
                                  {typ}
                                </span>
                                {row.origin === 'stellar' ? (
                                  <span
                                    className="shrink-0 rounded border border-emerald-300/80 bg-emerald-500/10 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-emerald-800 dark:border-emerald-500/40 dark:text-emerald-200"
                                    title="Added from Stellar Cyber metadata mapping suggestions"
                                  >
                                    Stellar
                                  </span>
                                ) : row.origin === 'auto' ? (
                                  <span
                                    className="shrink-0 rounded border border-sky-300/80 bg-sky-500/10 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-sky-800 dark:border-sky-500/40 dark:text-sky-200"
                                    title="Added from Auto-suggest top-level fields"
                                  >
                                    Auto
                                  </span>
                                ) : null}
                                {isNew ? (
                                  <span className="shrink-0 rounded bg-violet-600 px-1 py-px text-[9px] font-bold uppercase text-white">
                                    New
                                  </span>
                                ) : null}
                              </div>
                              <p
                                className={cn(
                                  'mt-1 flex items-center gap-1.5 pl-1 font-mono text-[10px] text-slate-500 dark:text-gdc-mutedStrong',
                                  warn?.missing && 'text-amber-700 dark:text-amber-300',
                                )}
                                title={truncatePreview(resolved, 500)}
                              >
                                <span className="rounded bg-slate-200/60 px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-slate-600 dark:bg-gdc-section dark:text-gdc-muted">
                                  Result
                                </span>
                                <code className="truncate">{sampleText}</code>
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-0.5">
                              <DestinationFieldChip
                                value={row.outputField}
                                warning={warn?.dup ? 'duplicate' : null}
                                onChange={(name) => {
                                  const next = [...state.mapping]
                                  next[idx] = { ...row, outputField: name }
                                  onChangeMapping(next)
                                }}
                                commonFields={COMMON_DEST_FIELDS}
                                recentCustom={recentCustomFields}
                                onRegisterCustom={registerCustomField}
                              />
                              <button
                                type="button"
                                onClick={() => duplicateRow(idx)}
                                className="invisible inline-flex h-7 w-7 items-center justify-center rounded border border-transparent text-slate-500 hover:bg-slate-100 hover:text-violet-700 group-hover/row:visible dark:hover:bg-gdc-rowHover dark:hover:text-violet-300"
                                aria-label="Duplicate row"
                                title="Duplicate row"
                              >
                                <Copy className="h-3.5 w-3.5" aria-hidden />
                              </button>
                              <button
                                type="button"
                                onClick={() => onChangeMapping(state.mapping.filter((m) => m.id !== row.id))}
                                className="invisible inline-flex h-7 w-7 items-center justify-center rounded border border-transparent text-slate-500 hover:bg-red-50 hover:text-red-600 group-hover/row:visible dark:hover:bg-red-950/40 dark:hover:text-red-300"
                                aria-label="Remove mapping row"
                                title="Remove row"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                              </button>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )
                })()
              )}
            </div>
          </PanelChrome>

          <section className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-3 dark:border-gdc-border dark:bg-gdc-card">
            <h4 className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">Suggested Fields</h4>
            <div className="mt-2 space-y-3">
              {SUGGESTED_FIELD_GROUPS.map((group) => {
                const names = suggestionsExpanded ? group.names : group.names.slice(0, 6)
                return (
                  <div key={group.title}>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{group.title}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {names.map((name) => {
                        const exists = findSuggestionPath(name, quickFields) != null
                        return (
                          <button
                            key={`${group.title}-${name}`}
                            type="button"
                            disabled={!exists}
                            onClick={() => handleSuggestedChip(name)}
                            className={cn(
                              'rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors',
                              exists
                                ? 'border-slate-200/90 bg-white text-slate-700 hover:border-violet-400 hover:bg-violet-500/[0.06] dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200'
                                : 'cursor-not-allowed border-slate-100 bg-slate-100/80 text-slate-400 dark:border-gdc-border dark:bg-gdc-section dark:text-gdc-muted',
                            )}
                          >
                            {name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
            <button
              type="button"
              onClick={() => setSuggestionsExpanded((v) => !v)}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
            >
              {suggestionsExpanded ? (
                <>
                  Show fewer suggestions <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                </>
              ) : (
                <>
                  Show more suggestions <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                </>
              )}
            </button>
          </section>
        </div>

        {/* Right: preview + summary */}
        <div className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-4 xl:max-h-[calc(100vh-6rem)] xl:self-start xl:overflow-y-auto">
          <PanelChrome title="Final Event Preview" className="max-h-[min(42vh,440px)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 px-2.5 py-2 dark:border-gdc-border">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
                  Live
                </span>
                <div className="inline-flex rounded-md border border-slate-200/90 p-0.5 dark:border-gdc-border">
                  <button
                    type="button"
                    onClick={() => setPreviewTab('preview')}
                    className={cn(
                      'rounded px-2 py-0.5 text-[10px] font-semibold',
                      previewTab === 'preview'
                        ? 'bg-violet-600 text-white'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover',
                    )}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewTab('raw_final')}
                    className={cn(
                      'rounded px-2 py-0.5 text-[10px] font-semibold',
                      previewTab === 'raw_final'
                        ? 'bg-violet-600 text-white'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover',
                    )}
                  >
                    Raw vs Final
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void copyFinalJson()}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200/90 bg-white px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden />
                Copy JSON
              </button>
            </div>
            <div className="min-h-0 overflow-auto p-2">
              {previewTab === 'preview' ? (
                <pre className="overflow-x-auto rounded-lg border border-slate-200/80 bg-slate-950 p-2.5 text-[10px] leading-snug text-emerald-100 dark:border-gdc-border">
                  {mappedPreviewJson || '—'}
                </pre>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  <div>
                    <p className="mb-1 text-[10px] font-semibold text-slate-500">Raw sample (first event)</p>
                    <pre className="max-h-[32vh] overflow-auto rounded-lg border border-slate-200/80 bg-slate-900 p-2 text-[9px] leading-snug text-slate-200 dark:border-gdc-border">
                      {rawSampleJson || '—'}
                    </pre>
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] font-semibold text-slate-500">Mapped output</p>
                    <pre className="max-h-[32vh] overflow-auto rounded-lg border border-slate-200/80 bg-slate-950 p-2 text-[9px] leading-snug text-emerald-100 dark:border-gdc-border">
                      {mappedPreviewJson || '—'}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </PanelChrome>

          <section className="rounded-lg border border-slate-200/80 bg-white p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
            <h4 className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">Mapping Summary</h4>
            <ul className="mt-2 space-y-1.5 text-[11px] text-slate-700 dark:text-slate-200">
              <li className="flex justify-between gap-2">
                <span className="text-slate-500">Mapped fields</span>
                <span className="font-semibold">{stats.mappedCount}</span>
              </li>
              <li className="flex justify-between gap-2">
                <span className="text-slate-500">Unmapped source fields</span>
                <span
                  className={cn(
                    'font-semibold',
                    stats.unmappedSourceCount === 0
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : 'text-amber-700 dark:text-amber-300',
                  )}
                >
                  {stats.unmappedSourceCount}
                </span>
              </li>
              <li className="flex justify-between gap-2">
                <span className="text-slate-500">Static fields</span>
                <span className="font-semibold">{stats.staticCount}</span>
              </li>
              <li className="flex justify-between gap-2">
                <span className="text-slate-500">Enriched fields</span>
                <span className="font-semibold">{stats.enrichedCount}</span>
              </li>
              <li className="flex justify-between gap-2 border-t border-slate-100 pt-1.5 dark:border-gdc-border">
                <span className="text-slate-500">Total output fields</span>
                <span className="font-semibold text-violet-700 dark:text-violet-300">{stats.totalOutput}</span>
              </li>
            </ul>
            <div className="mt-3 space-y-1 border-t border-slate-100 pt-2 dark:border-gdc-border">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-slate-600 dark:text-gdc-mutedStrong">Required fields missing</span>
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300">
                  {stats.missingRequired ? '⚠' : '✓'} {stats.missingRequired ? 'Yes' : 'None'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-slate-600 dark:text-gdc-mutedStrong">Potential issues</span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 font-semibold',
                    stats.potentialIssues ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300',
                  )}
                >
                  {stats.potentialIssues ? '⚠ Review' : '✓ None'}
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  )
}
