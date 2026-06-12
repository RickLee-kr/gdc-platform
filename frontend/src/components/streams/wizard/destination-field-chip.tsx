import { Check, ChevronDown, Plus, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../../lib/utils'

/** Curated common destination field names shown in the chip popover. */
export const COMMON_DEST_FIELDS: readonly string[] = [
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

export const RECENT_DEST_STORAGE_KEY = 'gdc:wizard:recent-destination-fields'
export const RECENT_DEST_LIMIT = 8

export function loadRecentDestinations(): string[] {
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

export function saveRecentDestinations(list: string[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(RECENT_DEST_STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* ignore quota / disabled storage */
  }
}

const POPOVER_WIDTH = 288
const POPOVER_GAP = 4
const VIEWPORT_MARGIN = 8

export type DestinationFieldChipProps = {
  value: string
  warning?: 'duplicate' | null
  onChange: (name: string) => void
  commonFields?: readonly string[]
  recentCustom: readonly string[]
  onRegisterCustom: (name: string) => void
}

export function DestinationFieldChip({
  value,
  warning,
  onChange,
  commonFields = COMMON_DEST_FIELDS,
  recentCustom,
  onRegisterCustom,
}: DestinationFieldChipProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const chipRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const computeCoords = useCallback((): { top: number; left: number } | null => {
    const r = chipRef.current?.getBoundingClientRect()
    if (!r) return null
    const desiredLeft = r.right - POPOVER_WIDTH
    const maxLeft = window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN
    const left = Math.max(VIEWPORT_MARGIN, Math.min(desiredLeft, maxLeft))
    return { top: r.bottom + POPOVER_GAP, left }
  }, [])

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
      if (target && popoverRef.current?.contains(target)) return
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
