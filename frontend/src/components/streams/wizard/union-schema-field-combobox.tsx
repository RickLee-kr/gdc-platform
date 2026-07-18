import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useListboxKeyboard } from '../../../hooks/use-listbox-keyboard'
import { cn } from '../../../lib/utils'
import type { UnionSchema, UnionSchemaField } from '../../../utils/unionSchema'
import {
  sourceFieldMatchesUnionPath,
  unionPathToSourceField,
} from './timestamp-conversion-template'

export type UnionSchemaFieldComboboxProps = {
  value: string
  onChange: (sourceField: string) => void
  unionSchema?: UnionSchema | null
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

function formatSample(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function fieldMetaLine(field: UnionSchemaField, totalEvents: number): string {
  const parts = [field.field_type]
  if (totalEvents > 0) {
    parts.push(`${field.occurrence_count}/${totalEvents}`)
  }
  const sample = field.sample_values[0]
  if (sample !== undefined) {
    parts.push(formatSample(sample))
  }
  return parts.join(' · ')
}

export function UnionSchemaFieldCombobox({
  value,
  onChange,
  unionSchema = null,
  disabled = false,
  placeholder = 'Select source field…',
  id,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-required': ariaRequired,
  'aria-invalid': ariaInvalid,
  'data-testid': testId = 'union-schema-field-combobox',
  className,
}: UnionSchemaFieldComboboxProps) {
  const listId = useId()
  const warningId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const fields = unionSchema?.fields ?? []
  const totalEvents = unionSchema?.total_events ?? 0

  const matchedField = useMemo(
    () => fields.find((f) => sourceFieldMatchesUnionPath(value, f.field_path)) ?? null,
    [fields, value],
  )

  const missingFromSchema = Boolean(value.trim()) && fields.length > 0 && !matchedField

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return fields
    return fields.filter((f) => {
      const path = unionPathToSourceField(f.field_path).toLowerCase()
      const sample = f.sample_values.map(formatSample).join(' ').toLowerCase()
      return (
        path.includes(q) ||
        f.field_path.toLowerCase().includes(q) ||
        f.field_type.toLowerCase().includes(q) ||
        sample.includes(q)
      )
    })
  }, [fields, query])

  const pick = useCallback(
    (fieldPath: string) => {
      onChange(unionPathToSourceField(fieldPath))
      setOpen(false)
    },
    [onChange],
  )

  const onSelectIndex = useCallback(
    (index: number) => {
      const field = filtered[index]
      if (field) pick(field.field_path)
    },
    [filtered, pick],
  )

  const { activeIndex, resetActive, onKeyDown: onListKeyDown } = useListboxKeyboard(filtered.length, onSelectIndex)

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
  const describedBy = [ariaDescribedBy, missingFromSchema ? warningId : null].filter(Boolean).join(' ') || undefined
  const activeOptionId =
    activeIndex >= 0 && filtered[activeIndex] != null ? `${listId}-opt-${activeIndex}` : undefined

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
          missingFromSchema && 'border-amber-400 dark:border-amber-500/60',
        )}
      >
        <span className={cn('min-w-0 truncate font-mono', !value.trim() && 'text-slate-400')}>{displayLabel}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
      </button>

      {missingFromSchema ? (
        <p id={warningId} className="mt-1 text-[10px] text-amber-700 dark:text-amber-300" data-testid={`${testId}-missing-warning`}>
          This field is not present in the current Union Schema.
        </p>
      ) : null}

      {open ? (
        <div
          className="absolute z-40 mt-1 w-full min-w-[260px] overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg dark:border-gdc-border dark:bg-gdc-elevated"
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
              placeholder="Search fields…"
              aria-label="Search source fields"
              aria-controls={listId}
              aria-activedescendant={activeOptionId}
              data-testid={`${testId}-search`}
              className="h-8 w-full rounded border border-slate-200 bg-slate-50 pl-8 pr-2 text-[12px] text-slate-800 outline-none focus:border-violet-400 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
            />
          </div>

          {missingFromSchema ? (
            <div className="border-b border-amber-200/70 bg-amber-50/80 px-2 py-1.5 dark:border-amber-500/30 dark:bg-amber-950/30">
              <button
                type="button"
                role="option"
                aria-selected
                data-testid={`${testId}-option-preserved`}
                onClick={() => setOpen(false)}
                className="flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-left text-[11px] text-amber-900 dark:text-amber-100"
              >
                <span className="min-w-0 truncate font-mono">{value}</span>
                <Check className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
              </button>
              <p className="px-1 text-[9px] text-amber-800 dark:text-amber-200">
                Preserved — not in current Union Schema
              </p>
            </div>
          ) : null}

          <ul
            id={listId}
            role="listbox"
            aria-label="Union Schema fields"
            className="max-h-56 overflow-y-auto overscroll-contain p-1"
            data-testid={`${testId}-list`}
          >
            {fields.length === 0 ? (
              <li className="px-2 py-2 text-[11px] italic text-slate-500 dark:text-gdc-muted">
                No Union Schema fields available.
              </li>
            ) : filtered.length === 0 ? (
              <li className="px-2 py-2 text-[11px] italic text-slate-500 dark:text-gdc-muted">No matching fields.</li>
            ) : (
              filtered.map((field, idx) => {
                const sourcePath = unionPathToSourceField(field.field_path)
                const selected = sourceFieldMatchesUnionPath(value, field.field_path)
                return (
                  <li key={field.field_path}>
                    <button
                      type="button"
                      id={`${listId}-opt-${idx}`}
                      role="option"
                      aria-selected={selected}
                      data-testid={`${testId}-option-${sourcePath}`}
                      onClick={() => pick(field.field_path)}
                      className={cn(
                        'flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-gdc-rowHover',
                        selected && 'bg-violet-500/10 dark:bg-violet-500/15',
                        activeIndex === idx && 'ring-2 ring-inset ring-violet-400',
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-mono text-[11px] text-slate-800 dark:text-slate-100">
                          {sourcePath}
                        </span>
                        {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-violet-500" aria-hidden /> : null}
                      </span>
                      <span className="truncate text-[9px] text-slate-500 dark:text-gdc-muted">
                        {fieldMetaLine(field, totalEvents)}
                      </span>
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

/** First sample value for a stored source_field from Union Schema. */
export function sampleValueForSourceField(
  unionSchema: UnionSchema | null | undefined,
  sourceField: string,
): unknown {
  if (!unionSchema || !sourceField.trim()) return undefined
  const field = unionSchema.fields.find((f) => sourceFieldMatchesUnionPath(sourceField, f.field_path))
  return field?.sample_values[0]
}
