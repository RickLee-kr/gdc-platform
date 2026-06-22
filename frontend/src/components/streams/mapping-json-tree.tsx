import { Check, Copy, Minus, Plus } from 'lucide-react'
import { useCallback, useState, type ReactNode } from 'react'
import { cn } from '../../lib/utils'

export type MappingJsonTreeExpandStrategy = 'smart' | 'all' | 'minimal'

type MappingJsonTreeProps = {
  value: unknown
  baseLabel: string
  basePath: string
  search: string
  onPickPath: (jsonPath: string) => void
  onUseEventArrayPath?: (jsonPath: string) => void
  onUseEventRootPath?: (jsonPath: string) => void
  onUseCheckpointPath?: (jsonPath: string) => void
  /** When set, nodes under this JSONPath prefix get a subtle highlight (e.g. selected event array). */
  highlightPathPrefix?: string | null
  /** Highlights the selected event root object in the raw tree. */
  eventRootHighlightPath?: string | null
  /** Highlights the selected checkpoint field in the raw tree. */
  checkpointHighlightPath?: string | null
  /** Controls default expand state when the tree mounts or remounts. */
  expandStrategy?: MappingJsonTreeExpandStrategy
  /** Highlights the branch containing this JSONPath (e.g. last mapped path). */
  activeHighlightPath?: string | null
  /** External hover path for coordinated styling (optional). */
  externalHoverPath?: string | null
  onExternalHoverPath?: (path: string | null) => void
  /** Show per-row Copy JSONPath buttons (default true). */
  showCopyPath?: boolean
}

function formatPrimitive(v: unknown): string {
  if (v === null) return 'null'
  if (typeof v === 'string') return `"${v}"`
  return String(v)
}

function valueTypeLabel(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return `array [${v.length}]`
  if (typeof v === 'object') return `object [${Object.keys(v as object).length}]`
  return typeof v
}

function CopyPathButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(path)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // ignore
    }
  }, [path])
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        void copy()
      }}
      className="ml-auto inline-flex h-5 shrink-0 items-center gap-0.5 rounded border border-slate-200/90 bg-white px-1 text-[9px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200 dark:hover:bg-gdc-rowHover"
      title="Copy JSONPath"
      aria-label={`Copy JSONPath ${path}`}
    >
      {copied ? <Check className="h-2.5 w-2.5 text-emerald-600" aria-hidden /> : <Copy className="h-2.5 w-2.5" aria-hidden />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function matchesSearch(haystack: string, q: string): boolean {
  if (!q.trim()) return true
  return haystack.toLowerCase().includes(q.trim().toLowerCase())
}

/** Whether this node or any descendant matches the search query (for collapsing irrelevant branches). */
function subtreeMatchesSearch(value: unknown, baseLabel: string, basePath: string, search: string): boolean {
  if (!search.trim()) return true
  if (value === null || typeof value !== 'object') {
    const pickedLabel = baseLabel || basePath
    const haystack = `${pickedLabel} ${basePath} ${formatPrimitive(value)}`
    return matchesSearch(haystack, search)
  }
  if (Array.isArray(value)) {
    const summaryLabel = `${baseLabel || 'array'} [${value.length}]`
    if (matchesSearch(`${summaryLabel} ${basePath}`, search)) return true
    return value.slice(0, 40).some((item, idx) => subtreeMatchesSearch(item, `[${idx}]`, `${basePath}[${idx}]`, search))
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
  const summaryLabel = `${baseLabel || 'object'} [${keys.length}]`
  if (matchesSearch(`${summaryLabel} ${basePath}`, search)) return true
  return keys.some((key) => {
    const childPath = basePath === '$' ? `$.${key}` : `${basePath}.${key}`
    return subtreeMatchesSearch(obj[key], key, childPath, search)
  })
}

function underHighlight(path: string, highlight: string | null | undefined): boolean {
  if (!highlight) return false
  if (path === highlight) return true
  if (highlight === '$') return true
  return path.startsWith(`${highlight}.`) || path.startsWith(`${highlight}[`)
}

function initialExpanded(depth: number, strategy: MappingJsonTreeExpandStrategy): boolean {
  if (strategy === 'all') return true
  if (strategy === 'minimal') return false
  return depth < 2
}

/** Node path is active branch when it equals `needle` or is a prefix path segment of `needle`. */
function isBranchActive(nodePath: string, needle: string | null): boolean {
  if (!needle) return false
  if (nodePath === needle) return true
  if (needle === '$') return nodePath === '$'
  if (nodePath === '$') return needle.startsWith('$.') || needle.startsWith('$[')
  return needle.startsWith(`${nodePath}.`) || needle.startsWith(`${nodePath}[`)
}

function isSelectedPath(nodePath: string, selected: string | null | undefined): boolean {
  if (!selected) return false
  return nodePath === selected
}

export function MappingJsonTree({
  value,
  baseLabel,
  basePath,
  search,
  onPickPath,
  onUseEventArrayPath,
  onUseEventRootPath,
  onUseCheckpointPath,
  highlightPathPrefix,
  eventRootHighlightPath = null,
  checkpointHighlightPath = null,
  expandStrategy = 'smart',
  activeHighlightPath = null,
  externalHoverPath = null,
  onExternalHoverPath,
  showCopyPath = true,
}: MappingJsonTreeProps) {
  const [internalHoverPath, setInternalHoverPath] = useState<string | null>(null)
  const hoverPath = externalHoverPath ?? internalHoverPath
  const setHoverPath = onExternalHoverPath ?? setInternalHoverPath

  return (
    <div className="font-mono text-[11px] leading-snug">
      <JsonTreeNodes
        value={value}
        baseLabel={baseLabel}
        basePath={basePath}
        search={search}
        onPickPath={onPickPath}
        onUseEventArrayPath={onUseEventArrayPath}
        onUseEventRootPath={onUseEventRootPath}
        onUseCheckpointPath={onUseCheckpointPath}
        depth={0}
        highlightPathPrefix={highlightPathPrefix}
        eventRootHighlightPath={eventRootHighlightPath}
        checkpointHighlightPath={checkpointHighlightPath}
        expandStrategy={expandStrategy}
        activeHighlightPath={activeHighlightPath}
        hoverPath={hoverPath}
        onHoverPath={setHoverPath}
        showCopyPath={showCopyPath}
      />
    </div>
  )
}

function JsonTreeNodes({
  value,
  baseLabel,
  basePath,
  search,
  onPickPath,
  onUseEventArrayPath,
  onUseEventRootPath,
  onUseCheckpointPath,
  depth,
  highlightPathPrefix,
  eventRootHighlightPath,
  checkpointHighlightPath,
  expandStrategy,
  activeHighlightPath,
  hoverPath,
  onHoverPath,
  showCopyPath,
}: {
  value: unknown
  baseLabel: string
  basePath: string
  search: string
  onPickPath: (jsonPath: string) => void
  onUseEventArrayPath?: (jsonPath: string) => void
  onUseEventRootPath?: (jsonPath: string) => void
  onUseCheckpointPath?: (jsonPath: string) => void
  depth: number
  highlightPathPrefix?: string | null
  eventRootHighlightPath?: string | null
  checkpointHighlightPath?: string | null
  expandStrategy: MappingJsonTreeExpandStrategy
  activeHighlightPath: string | null
  hoverPath: string | null
  onHoverPath: (path: string | null) => void
  showCopyPath: boolean
}) {
  const [open, setOpen] = useState(() => initialExpanded(depth, expandStrategy))

  if (value === null || typeof value !== 'object') {
    const rowPath = basePath
    const pickedLabel = baseLabel || rowPath
    const haystack = `${pickedLabel} ${rowPath} ${formatPrimitive(value)}`
    if (!matchesSearch(haystack, search)) return null
    const hi = underHighlight(rowPath, highlightPathPrefix)
    const activeLeaf = activeHighlightPath === rowPath
    const hoverLeaf = hoverPath === rowPath
    const checkpointSel = isSelectedPath(rowPath, checkpointHighlightPath)
    const eventRootSel = isSelectedPath(rowPath, eventRootHighlightPath)
    return (
      <div
        className={cn(
          'group flex w-full items-start gap-1 rounded px-1 py-0.5 transition-colors',
          'hover:bg-sky-500/15 dark:hover:bg-sky-400/10',
          depth > 0 && 'ml-3 border-l border-slate-200/80 pl-2 dark:border-gdc-border',
          hi && 'bg-violet-500/[0.12] dark:bg-violet-500/20',
          eventRootSel && 'bg-emerald-500/15 ring-1 ring-emerald-400/50 dark:bg-emerald-500/20',
          checkpointSel && 'bg-amber-500/15 ring-1 ring-amber-400/50 dark:bg-amber-500/20',
          hoverLeaf && 'bg-sky-500/20 dark:bg-sky-400/15',
          activeLeaf && 'bg-sky-500/25 ring-1 ring-violet-400/60 dark:bg-violet-500/25 dark:ring-violet-500/50',
        )}
        onMouseEnter={() => onHoverPath(rowPath)}
        onMouseLeave={() => onHoverPath(null)}
      >
        <button
          type="button"
          onClick={() => onPickPath(rowPath)}
          title="Click to map this field"
          className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-left"
        >
          <span className="text-violet-700 dark:text-violet-300">{pickedLabel}</span>
          <span className="rounded bg-slate-100 px-1 text-[9px] font-bold uppercase text-slate-500 dark:bg-gdc-elevated dark:text-gdc-mutedStrong">
            {valueTypeLabel(value)}
          </span>
          <span className="text-slate-400">:</span>
          <span
            className={cn(
              typeof value === 'string' && 'text-emerald-700 dark:text-emerald-400',
              typeof value === 'number' && 'text-sky-700 dark:text-sky-300',
              (value === null || typeof value === 'boolean') && 'text-amber-700 dark:text-amber-300',
            )}
          >
            {formatPrimitive(value)}
          </span>
        </button>
        {showCopyPath ? <CopyPathButton path={rowPath} /> : null}
        {onUseCheckpointPath ? (
          <button
            type="button"
            title="Set checkpoint"
            onClick={(e) => {
              e.stopPropagation()
              onUseCheckpointPath(rowPath)
            }}
            className="rounded border border-amber-300/80 px-1 py-0.5 text-[9px] font-semibold text-amber-900 opacity-0 group-hover:opacity-100 dark:text-amber-200"
          >
            Sync position
          </button>
        ) : null}
      </div>
    )
  }

  if (Array.isArray(value)) {
    const len = value.length
    const summaryLabel = `${baseLabel || 'array'} [${len}]`
    const children = value.slice(0, 40).map((item, idx) => {
      const childPath = `${basePath}[${idx}]`
      const childLabel = `[${idx}]`
      return (
        <JsonTreeNodes
          key={childPath}
          value={item}
          baseLabel={childLabel}
          basePath={childPath}
          search={search}
          onPickPath={onPickPath}
          onUseEventArrayPath={onUseEventArrayPath}
          onUseEventRootPath={onUseEventRootPath}
          onUseCheckpointPath={onUseCheckpointPath}
          depth={depth + 1}
          highlightPathPrefix={highlightPathPrefix}
          eventRootHighlightPath={eventRootHighlightPath}
          checkpointHighlightPath={checkpointHighlightPath}
          expandStrategy={expandStrategy}
          activeHighlightPath={activeHighlightPath}
          hoverPath={hoverPath}
          onHoverPath={onHoverPath}
          showCopyPath={showCopyPath}
        />
      )
    })
    const selfMatch = matchesSearch(`${summaryLabel} ${basePath}`, search)
    if (!selfMatch && search.trim() && !subtreeMatchesSearch(value, baseLabel || 'array', basePath, search)) {
      return null
    }

    const hiArr = underHighlight(basePath, highlightPathPrefix)
    const eventRootSelArr = isSelectedPath(basePath, eventRootHighlightPath)
    const branchHi = isBranchActive(basePath, activeHighlightPath)
    const branchHover = isBranchActive(basePath, hoverPath)
    return (
      <div className={cn(depth > 0 && 'ml-2 border-l border-slate-200/70 pl-2 dark:border-gdc-border')}>
        <div className="flex items-start gap-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              setOpen((o) => !o)
            }}
            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-200/90 bg-white text-slate-600 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover"
            aria-expanded={open}
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? <Minus className="h-3 w-3" aria-hidden /> : <Plus className="h-3 w-3" aria-hidden />}
          </button>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            onMouseEnter={() => onHoverPath(basePath)}
            onMouseLeave={() => onHoverPath(null)}
            className={cn(
              'min-w-0 flex-1 rounded px-1 py-0.5 text-left text-slate-700 hover:bg-slate-100/80 dark:text-slate-200 dark:hover:bg-gdc-rowHover',
              hiArr && 'bg-violet-500/[0.12] dark:bg-violet-500/20',
              eventRootSelArr && 'bg-emerald-500/15 ring-1 ring-emerald-400/50 dark:bg-emerald-500/20',
              branchHover && 'bg-sky-500/15 dark:bg-sky-400/10',
              branchHi && 'bg-violet-500/15 ring-1 ring-violet-400/40 dark:bg-violet-500/20',
            )}
            aria-expanded={open}
          >
            <span className="text-violet-700 dark:text-violet-300">{summaryLabel}</span>
            <span className="ml-1 rounded bg-slate-100 px-1 text-[9px] font-bold uppercase text-slate-500 dark:bg-gdc-elevated dark:text-gdc-mutedStrong">
              array
            </span>
          </button>
          {showCopyPath ? <CopyPathButton path={basePath} /> : null}
          {onUseEventArrayPath ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onUseEventArrayPath(basePath)
              }}
              className={cn(
                'ml-1 rounded border px-1 py-0.5 text-[9px] font-semibold',
                hiArr
                  ? 'border-violet-500 bg-violet-600 text-white'
                  : 'border-violet-300/80 text-violet-800 hover:bg-violet-500/10 dark:text-violet-200',
              )}
            >
              Event source
            </button>
          ) : null}
        </div>
        {open ? <div className="mt-1 space-y-1">{children}</div> : null}
      </div>
    )
  }

  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
  const summaryLabel = baseLabel || 'object'
  const childNodes = keys.map((key) => {
    const childPath = basePath === '$' ? `$.${key}` : `${basePath}.${key}`
    return (
      <JsonTreeNodes
        key={childPath}
        value={obj[key]}
        baseLabel={key}
        basePath={childPath}
        search={search}
        onPickPath={onPickPath}
        onUseEventArrayPath={onUseEventArrayPath}
        onUseEventRootPath={onUseEventRootPath}
        onUseCheckpointPath={onUseCheckpointPath}
        depth={depth + 1}
        highlightPathPrefix={highlightPathPrefix}
        eventRootHighlightPath={eventRootHighlightPath}
        checkpointHighlightPath={checkpointHighlightPath}
        expandStrategy={expandStrategy}
        activeHighlightPath={activeHighlightPath}
        hoverPath={hoverPath}
        onHoverPath={onHoverPath}
        showCopyPath={showCopyPath}
      />
    )
  })
  const selfMatch = matchesSearch(`${summaryLabel} ${basePath}`, search)
  if (!selfMatch && search.trim() && !subtreeMatchesSearch(value, baseLabel, basePath, search)) return null

  const hiObj = underHighlight(basePath, highlightPathPrefix)
  const eventRootSelObj = isSelectedPath(basePath, eventRootHighlightPath)
  const branchHi = isBranchActive(basePath, activeHighlightPath)
  const branchHover = isBranchActive(basePath, hoverPath)
  return (
    <div className={cn(depth > 0 && 'ml-2 border-l border-slate-200/70 pl-2 dark:border-gdc-border')}>
      {depth === 0 ? null : (
        <div className="flex items-start gap-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              setOpen((o) => !o)
            }}
            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-200/90 bg-white text-slate-600 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover"
            aria-expanded={open}
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? <Minus className="h-3 w-3" aria-hidden /> : <Plus className="h-3 w-3" aria-hidden />}
          </button>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            onMouseEnter={() => onHoverPath(basePath)}
            onMouseLeave={() => onHoverPath(null)}
            className={cn(
              'min-w-0 flex-1 rounded px-1 py-0.5 text-left text-slate-700 hover:bg-slate-100/80 dark:text-slate-200 dark:hover:bg-gdc-rowHover',
              hiObj && 'bg-violet-500/[0.12] dark:bg-violet-500/20',
              eventRootSelObj && 'bg-emerald-500/15 ring-1 ring-emerald-400/50 dark:bg-emerald-500/20',
              branchHover && 'bg-sky-500/15 dark:bg-sky-400/10',
              branchHi && 'bg-violet-500/15 ring-1 ring-violet-400/40 dark:bg-violet-500/20',
            )}
            aria-expanded={open}
          >
            <span className="text-violet-700 dark:text-violet-300">
              {summaryLabel} [{keys.length}]
            </span>
            <span className="ml-1 rounded bg-slate-100 px-1 text-[9px] font-bold uppercase text-slate-500 dark:bg-gdc-elevated dark:text-gdc-mutedStrong">
              object
            </span>
          </button>
          {showCopyPath ? <CopyPathButton path={basePath} /> : null}
        </div>
      )}
      {(depth === 0 || open) && (
        <div className={cn('space-y-1', depth > 0 && 'mt-1')}>
          {depth > 0 && (onUseEventArrayPath || onUseEventRootPath || onUseCheckpointPath) ? (
            <div className="mb-1 flex flex-wrap items-center gap-1 px-1">
              {onUseEventArrayPath ? (
                <button
                  type="button"
                  onClick={() => onUseEventArrayPath(basePath)}
                  className="rounded border border-slate-200/90 bg-white px-1.5 py-0.5 text-[10px] text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
                >
                  Event source
                </button>
              ) : null}
              {onUseEventRootPath ? (
                <button
                  type="button"
                  onClick={() => onUseEventRootPath(basePath)}
                  className={cn(
                    'rounded border px-1.5 py-0.5 text-[10px]',
                    eventRootSelObj
                      ? 'border-emerald-500 bg-emerald-600 text-white'
                      : 'border-slate-200/90 bg-white text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200',
                  )}
                >
                  Event root
                </button>
              ) : null}
              {onUseCheckpointPath ? (
                <button
                  type="button"
                  onClick={() => onUseCheckpointPath(basePath)}
                  className={cn(
                    'rounded border px-1.5 py-0.5 text-[10px]',
                    isSelectedPath(basePath, checkpointHighlightPath)
                      ? 'border-amber-500 bg-amber-600 text-white'
                      : 'border-amber-200/90 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100',
                  )}
                >
                  Sync position
                </button>
              ) : null}
            </div>
          ) : null}
          {childNodes}
        </div>
      )}
    </div>
  )
}

export function PanelChrome({
  title,
  right,
  children,
  className,
  bodyClassName,
  fillParent = false,
}: {
  title: string
  right?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  /** When true, panel grows with parent split layout (no default max-height cap). */
  fillParent?: boolean
}) {
  return (
    <section
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card',
        fillParent ? 'h-full max-h-none' : 'max-h-[min(68vh,720px)]',
        className,
      )}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200/70 px-2.5 py-1.5 dark:border-gdc-border">
        <h3 className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
        {right ? <div className="flex shrink-0 items-center gap-1">{right}</div> : null}
      </header>
      <div
        className={cn(
          fillParent ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'min-h-0 overflow-auto',
          bodyClassName,
        )}
      >
        {children}
      </div>
    </section>
  )
}
