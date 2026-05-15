import { Minus, Plus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
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
  /** When set, nodes under this JSONPath prefix get a subtle highlight (e.g. selected event array). */
  highlightPathPrefix?: string | null
  /** Controls default expand state when the tree mounts or remounts. */
  expandStrategy?: MappingJsonTreeExpandStrategy
  /** Highlights the branch containing this JSONPath (e.g. last mapped path). */
  activeHighlightPath?: string | null
  /** External hover path for coordinated styling (optional). */
  externalHoverPath?: string | null
  onExternalHoverPath?: (path: string | null) => void
}

function formatPrimitive(v: unknown): string {
  if (v === null) return 'null'
  if (typeof v === 'string') return `"${v}"`
  return String(v)
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

export function MappingJsonTree({
  value,
  baseLabel,
  basePath,
  search,
  onPickPath,
  onUseEventArrayPath,
  onUseEventRootPath,
  highlightPathPrefix,
  expandStrategy = 'smart',
  activeHighlightPath = null,
  externalHoverPath = null,
  onExternalHoverPath,
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
        depth={0}
        highlightPathPrefix={highlightPathPrefix}
        expandStrategy={expandStrategy}
        activeHighlightPath={activeHighlightPath}
        hoverPath={hoverPath}
        onHoverPath={setHoverPath}
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
  depth,
  highlightPathPrefix,
  expandStrategy,
  activeHighlightPath,
  hoverPath,
  onHoverPath,
}: {
  value: unknown
  baseLabel: string
  basePath: string
  search: string
  onPickPath: (jsonPath: string) => void
  onUseEventArrayPath?: (jsonPath: string) => void
  onUseEventRootPath?: (jsonPath: string) => void
  depth: number
  highlightPathPrefix?: string | null
  expandStrategy: MappingJsonTreeExpandStrategy
  activeHighlightPath: string | null
  hoverPath: string | null
  onHoverPath: (path: string | null) => void
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
    return (
      <button
        type="button"
        onClick={() => onPickPath(rowPath)}
        onMouseEnter={() => onHoverPath(rowPath)}
        onMouseLeave={() => onHoverPath(null)}
        title="Click to add to mapping"
        className={cn(
          'flex w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded px-1 py-0.5 text-left transition-colors',
          'hover:bg-sky-500/15 dark:hover:bg-sky-400/10',
          depth > 0 && 'ml-3 border-l border-slate-200/80 pl-2 dark:border-gdc-border',
          hi && 'bg-violet-500/[0.12] dark:bg-violet-500/20',
          hoverLeaf && 'bg-sky-500/20 dark:bg-sky-400/15',
          activeLeaf && 'bg-sky-500/25 ring-1 ring-violet-400/60 dark:bg-violet-500/25 dark:ring-violet-500/50',
        )}
      >
        <span className="text-violet-700 dark:text-violet-300">{pickedLabel}</span>
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
          depth={depth + 1}
          highlightPathPrefix={highlightPathPrefix}
          expandStrategy={expandStrategy}
          activeHighlightPath={activeHighlightPath}
          hoverPath={hoverPath}
          onHoverPath={onHoverPath}
        />
      )
    })
    const selfMatch = matchesSearch(`${summaryLabel} ${basePath}`, search)
    if (!selfMatch && search.trim() && !subtreeMatchesSearch(value, baseLabel || 'array', basePath, search)) {
      return null
    }

    const hiArr = underHighlight(basePath, highlightPathPrefix)
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
              branchHover && 'bg-sky-500/15 dark:bg-sky-400/10',
              branchHi && 'bg-violet-500/15 ring-1 ring-violet-400/40 dark:bg-violet-500/20',
            )}
            aria-expanded={open}
          >
            <span className="text-violet-700 dark:text-violet-300">{summaryLabel}</span>
          </button>
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
        depth={depth + 1}
        highlightPathPrefix={highlightPathPrefix}
        expandStrategy={expandStrategy}
        activeHighlightPath={activeHighlightPath}
        hoverPath={hoverPath}
        onHoverPath={onHoverPath}
      />
    )
  })
  const selfMatch = matchesSearch(`${summaryLabel} ${basePath}`, search)
  if (!selfMatch && search.trim() && !subtreeMatchesSearch(value, baseLabel, basePath, search)) return null

  const hiObj = underHighlight(basePath, highlightPathPrefix)
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
              branchHover && 'bg-sky-500/15 dark:bg-sky-400/10',
              branchHi && 'bg-violet-500/15 ring-1 ring-violet-400/40 dark:bg-violet-500/20',
            )}
            aria-expanded={open}
          >
            <span className="text-violet-700 dark:text-violet-300">
              {summaryLabel} [{keys.length}]
            </span>
          </button>
        </div>
      )}
      {(depth === 0 || open) && (
        <div className={cn('space-y-1', depth > 0 && 'mt-1')}>
          {depth > 0 && (onUseEventArrayPath || onUseEventRootPath) ? (
            <div className="mb-1 flex flex-wrap items-center gap-1 px-1">
              {onUseEventArrayPath ? (
                <button
                  type="button"
                  onClick={() => onUseEventArrayPath(basePath)}
                  className="rounded border border-slate-200/90 bg-white px-1.5 py-0.5 text-[10px] text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
                >
                  Use as Event Array
                </button>
              ) : null}
              {onUseEventRootPath ? (
                <button
                  type="button"
                  onClick={() => onUseEventRootPath(basePath)}
                  className="rounded border border-slate-200/90 bg-white px-1.5 py-0.5 text-[10px] text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
                >
                  Use as Event Root
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
}: {
  title: string
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'flex max-h-[min(68vh,720px)] min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card',
        className,
      )}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200/70 px-2.5 py-1.5 dark:border-gdc-border">
        <h3 className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
        {right ? <div className="flex shrink-0 items-center gap-1">{right}</div> : null}
      </header>
      <div className="min-h-0 overflow-auto">{children}</div>
    </section>
  )
}
