import { Check, ChevronsUpDown, Plus, Search } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useListboxKeyboard } from '../../../hooks/use-listbox-keyboard'
import { cn } from '../../../lib/utils'

export type CreatableFieldComboboxProps = {
  value: string
  onChange: (next: string) => void
  /** Existing field candidates (mapping outputs, generated, profile standards). */
  candidates?: readonly string[]
  disabled?: boolean
  placeholder?: string
  id?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'aria-required'?: boolean | 'true' | 'false'
  'aria-invalid'?: boolean | 'true' | 'false'
  'data-testid'?: string
  className?: string
}

function uniquePreserveOrder(items: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of items) {
    const v = raw.trim()
    if (!v) continue
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

export function CreatableFieldCombobox({
  value,
  onChange,
  candidates = [],
  disabled = false,
  placeholder = 'Select or create field…',
  id,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-required': ariaRequired,
  'aria-invalid': ariaInvalid,
  'data-testid': testId = 'creatable-field-combobox',
  className,
}: CreatableFieldComboboxProps) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const options = useMemo(() => {
    const list = uniquePreserveOrder(candidates)
    if (value.trim() && !list.some((c) => c.toLowerCase() === value.trim().toLowerCase())) {
      return [value.trim(), ...list]
    }
    return list
  }, [candidates, value])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((c) => c.toLowerCase().includes(q))
  }, [options, query])

  const queryTrim = query.trim()
  const exactMatch = options.some((c) => c.toLowerCase() === queryTrim.toLowerCase())
  const showCreate = queryTrim.length > 0 && !exactMatch

  const pickable = useMemo(() => {
    const items: string[] = []
    if (showCreate) items.push(queryTrim)
    items.push(...filtered)
    return items
  }, [filtered, queryTrim, showCreate])

  const pick = useCallback(
    (next: string) => {
      onChange(next)
      setOpen(false)
    },
    [onChange],
  )

  const onSelectIndex = useCallback(
    (index: number) => {
      const next = pickable[index]
      if (next != null) pick(next)
    },
    [pick, pickable],
  )

  const { activeIndex, resetActive, onKeyDown: onListKeyDown } = useListboxKeyboard(pickable.length, onSelectIndex)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (open) {
      setQuery('')
      resetActive()
      queueMicrotask(() => inputRef.current?.focus())
    }
  }, [open, resetActive])

  useEffect(() => {
    resetActive()
  }, [query, resetActive])

  const displayLabel = value.trim() || placeholder
  const activeOptionId =
    activeIndex >= 0 && pickable[activeIndex] != null ? `${listId}-opt-${activeIndex}` : undefined

  return (
    <div ref={rootRef} className={cn('relative', className)} data-testid={testId}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-required={ariaRequired}
        aria-invalid={ariaInvalid}
        data-testid={`${testId}-trigger`}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={cn(
          'flex h-8 w-full items-center justify-between gap-2 rounded-md border border-slate-200/90 bg-white px-2 text-left text-[11px] text-slate-900 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span className={cn('min-w-0 truncate font-mono', !value.trim() && 'text-slate-400')}>{displayLabel}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
      </button>

      {open ? (
        <div
          className="absolute z-40 mt-1 w-full min-w-[240px] overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg dark:border-gdc-border dark:bg-gdc-elevated"
          data-testid={`${testId}-panel`}
        >
          <div className="relative border-b border-slate-100 p-1.5 dark:border-gdc-divider">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && activeIndex < 0 && queryTrim) {
                  e.preventDefault()
                  pick(queryTrim)
                  return
                }
                onListKeyDown(e)
              }}
              placeholder="Search or type new field…"
              aria-label="Search or create target field"
              aria-controls={listId}
              aria-activedescendant={activeOptionId}
              data-testid={`${testId}-search`}
              className="h-8 w-full rounded border border-slate-200 bg-slate-50 pl-8 pr-2 text-[12px] text-slate-800 outline-none focus:border-violet-400 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
            />
          </div>

          {showCreate ? (
            <button
              type="button"
              id={`${listId}-opt-0`}
              data-testid={`${testId}-create`}
              onClick={() => pick(queryTrim)}
              className={cn(
                'flex w-full items-center gap-2 border-b border-violet-200/70 bg-violet-500/[0.08] px-2 py-2 text-left text-violet-800 hover:bg-violet-500/15 dark:border-violet-500/30 dark:bg-violet-500/15 dark:text-violet-100',
                activeIndex === 0 && 'ring-2 ring-inset ring-violet-400',
              )}
            >
              <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 truncate text-[11px] font-semibold">
                Create &quot;{queryTrim}&quot;
              </span>
            </button>
          ) : null}

          <ul
            id={listId}
            role="listbox"
            aria-label="Target fields"
            className="max-h-56 overflow-y-auto overscroll-contain p-1"
            data-testid={`${testId}-list`}
          >
            {filtered.length === 0 && !showCreate ? (
              <li className="px-2 py-2 text-[11px] italic text-slate-500 dark:text-gdc-muted">
                Type a name to create a new field.
              </li>
            ) : (
              filtered.map((name, idx) => {
                const selected = value === name
                const optionIndex = showCreate ? idx + 1 : idx
                return (
                  <li key={name}>
                    <button
                      type="button"
                      id={`${listId}-opt-${optionIndex}`}
                      role="option"
                      aria-selected={selected}
                      data-testid={`${testId}-option-${name}`}
                      onClick={() => pick(name)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[11px] text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-gdc-rowHover',
                        selected && 'bg-violet-500/10 text-violet-800 dark:bg-violet-500/15 dark:text-violet-100',
                        activeIndex === optionIndex && 'ring-2 ring-inset ring-violet-400',
                      )}
                    >
                      <span className="min-w-0 truncate font-mono">{name}</span>
                      {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-violet-500" aria-hidden /> : null}
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
