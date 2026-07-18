import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useListboxKeyboard } from '../../../hooks/use-listbox-keyboard'
import { cn } from '../../../lib/utils'
import {
  filterTimezones,
  isValidIanaTimezone,
  orderTimezoneOptions,
  resolveBrowserTimezone,
} from '../../../lib/iana-timezones'
import {
  TIMESTAMP_SOURCE_TIMEZONE_VALUE,
  applyTimestampTimezoneSelection,
  timestampTimezoneSelectionValue,
  type TimestampTimezoneMode,
} from './timestamp-conversion-template'

export type TimestampTimezoneComboboxProps = {
  mode: TimestampTimezoneMode
  customTimezone: string
  onChange: (next: { tsTimezoneMode: TimestampTimezoneMode; tsCustomTimezone: string }) => void
  preferredUserTimezone?: string | null
  disabled?: boolean
  id?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'aria-required'?: boolean | 'true' | 'false'
  'aria-invalid'?: boolean | 'true' | 'false'
  'data-testid'?: string
  className?: string
}

/**
 * Timestamp Conversion timezone picker.
 * Supports Source Timezone + IANA zones without changing the shared settings TimezoneCombobox.
 */
export function TimestampTimezoneCombobox({
  mode,
  customTimezone,
  onChange,
  preferredUserTimezone = null,
  disabled = false,
  id,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-required': ariaRequired,
  'aria-invalid': ariaInvalid,
  'data-testid': testId = 'ts-timezone',
  className,
}: TimestampTimezoneComboboxProps) {
  const listId = useId()
  const warningId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const browserTz = useMemo(() => resolveBrowserTimezone(), [])

  const value = timestampTimezoneSelectionValue(mode, customTimezone)
  const isSource = value === TIMESTAMP_SOURCE_TIMEZONE_VALUE

  const ianaOptions = useMemo(
    () =>
      orderTimezoneOptions({
        currentValue: isSource ? null : value || null,
        browserTimezone: browserTz,
        preferredUserTimezone,
      }),
    [value, isSource, browserTz, preferredUserTimezone],
  )

  const filteredIana = useMemo(() => filterTimezones(ianaOptions, query), [ianaOptions, query])
  const sourceMatchesQuery =
    !query.trim() || 'source timezone'.includes(query.trim().toLowerCase()) || 'source'.includes(query.trim().toLowerCase())

  const invalidSaved =
    mode === 'custom' && Boolean(customTimezone.trim()) && !isValidIanaTimezone(customTimezone)

  const pickable = useMemo(() => {
    const items: string[] = []
    if (sourceMatchesQuery) items.push(TIMESTAMP_SOURCE_TIMEZONE_VALUE)
    items.push(...filteredIana)
    return items
  }, [filteredIana, sourceMatchesQuery])

  const pick = useCallback(
    (next: string) => {
      onChange(applyTimestampTimezoneSelection(next))
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

  const displayLabel = isSource ? 'Source Timezone' : value.trim() || 'UTC'
  const describedBy = [ariaDescribedBy, invalidSaved ? warningId : null].filter(Boolean).join(' ') || undefined
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
        aria-describedby={describedBy}
        aria-required={ariaRequired}
        aria-invalid={ariaInvalid}
        data-testid={`${testId}-trigger`}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={cn(
          'flex h-8 w-full items-center justify-between gap-2 rounded-md border border-slate-200/90 bg-white px-2 text-left text-[11px] text-slate-900 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100',
          disabled && 'cursor-not-allowed opacity-50',
          invalidSaved && 'border-amber-400 dark:border-amber-500/60',
        )}
      >
        <span className={cn('min-w-0 truncate', isSource ? 'font-sans' : 'font-mono')}>{displayLabel}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
      </button>

      {invalidSaved ? (
        <p id={warningId} className="mt-1 text-[10px] text-amber-700 dark:text-amber-300" data-testid={`${testId}-invalid-warning`}>
          Saved timezone <span className="font-mono">{customTimezone}</span> is not a valid IANA name.
        </p>
      ) : null}

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
              onKeyDown={onListKeyDown}
              placeholder="Search timezones…"
              aria-label="Search timestamp timezones"
              aria-controls={listId}
              aria-activedescendant={activeOptionId}
              data-testid={`${testId}-search`}
              className="h-8 w-full rounded border border-slate-200 bg-slate-50 pl-8 pr-2 text-[12px] text-slate-800 outline-none focus:border-violet-400 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
            />
          </div>

          <ul
            id={listId}
            role="listbox"
            aria-label="Timestamp conversion timezones"
            className="max-h-56 overflow-y-auto overscroll-contain p-1"
            data-testid={`${testId}-list`}
          >
            {sourceMatchesQuery ? (
              <li>
                <button
                  type="button"
                  id={`${listId}-opt-0`}
                  role="option"
                  aria-selected={isSource}
                  data-testid={`${testId}-option-source`}
                  onClick={() => pick(TIMESTAMP_SOURCE_TIMEZONE_VALUE)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[12px] text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-gdc-rowHover',
                    isSource && 'bg-violet-500/10 text-violet-800 dark:bg-violet-500/15 dark:text-violet-100',
                    activeIndex === 0 && 'ring-2 ring-inset ring-violet-400',
                  )}
                >
                  <span>Source Timezone</span>
                  {isSource ? <Check className="h-3.5 w-3.5 shrink-0 text-violet-500" aria-hidden /> : null}
                </button>
              </li>
            ) : null}

            {browserTz ? (
              <li className="px-2 pb-1 pt-1.5 text-[9px] font-semibold uppercase tracking-wider text-slate-500 dark:text-gdc-muted">
                Browser timezone: {browserTz}
              </li>
            ) : null}

            {filteredIana.length === 0 && !sourceMatchesQuery ? (
              <li className="px-2 py-2 text-[11px] italic text-slate-500 dark:text-gdc-muted">No matching timezones.</li>
            ) : (
              filteredIana.map((tz, idx) => {
                const selected = !isSource && value === tz
                const isBrowser = tz === browserTz
                const isUser = Boolean(preferredUserTimezone && tz === preferredUserTimezone)
                const optionIndex = sourceMatchesQuery ? idx + 1 : idx
                return (
                  <li key={tz}>
                    <button
                      type="button"
                      id={`${listId}-opt-${optionIndex}`}
                      role="option"
                      aria-selected={selected}
                      data-testid={`${testId}-option-${tz}`}
                      onClick={() => pick(tz)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[12px] text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-gdc-rowHover',
                        selected && 'bg-violet-500/10 text-violet-800 dark:bg-violet-500/15 dark:text-violet-100',
                        activeIndex === optionIndex && 'ring-2 ring-inset ring-violet-400',
                      )}
                    >
                      <span className="min-w-0 truncate font-mono">
                        {tz}
                        {isUser && tz !== 'UTC' ? (
                          <span className="ml-1 font-sans text-[10px] text-slate-500 dark:text-gdc-muted">(user)</span>
                        ) : null}
                        {isBrowser && tz !== 'UTC' && !isUser ? (
                          <span className="ml-1 font-sans text-[10px] text-slate-500 dark:text-gdc-muted">(browser)</span>
                        ) : null}
                      </span>
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
