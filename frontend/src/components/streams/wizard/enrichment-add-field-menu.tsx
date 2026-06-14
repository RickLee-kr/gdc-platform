import {
  Calculator,
  ChevronDown,
  Database,
  GitBranch,
  Plus,
  Tag,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '../../../lib/utils'
import {
  ENRICHMENT_RULE_TYPES,
  defaultRuleForType,
  type EnrichmentRuleType,
  type WizardEnrichmentRule,
} from './enrichment-rules-model'

const TYPE_ICON = {
  static: Tag,
  calculated: Calculator,
  lookup: Database,
  conditional: GitBranch,
  normalize: Zap,
} as const

const TYPE_ICON_CLASS = {
  static: 'text-violet-600 dark:text-violet-400',
  calculated: 'text-amber-600 dark:text-amber-400',
  lookup: 'text-emerald-600 dark:text-emerald-400',
  conditional: 'text-violet-600 dark:text-violet-300',
  normalize: 'text-sky-600 dark:text-sky-400',
} as const

export type EnrichmentAddFieldMenuProps = {
  rules: WizardEnrichmentRule[]
  onRulesChange: (rules: WizardEnrichmentRule[]) => void
  /** Button label (default: Add field). */
  buttonLabel?: string
  excludeRuleTypes?: ReadonlyArray<EnrichmentRuleType>
  className?: string
  'data-testid'?: string
}

/** 206f0f7 Enrichment "Add Enrichment" dropdown — reusable on Transform tab bar. */
export function EnrichmentAddFieldMenu({
  rules,
  onRulesChange,
  buttonLabel = 'Add field',
  excludeRuleTypes = [],
  className,
  'data-testid': dataTestId = 'wizard-transform-add-field-menu',
}: EnrichmentAddFieldMenuProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const excluded = useMemo(() => new Set(excludeRuleTypes), [excludeRuleTypes])
  const visibleRuleTypes = useMemo(
    () => ENRICHMENT_RULE_TYPES.filter((t) => !excluded.has(t.type)),
    [excluded],
  )

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const addRule = useCallback(
    (type: EnrichmentRuleType) => {
      const rule = defaultRuleForType(type, rules.length)
      onRulesChange([...rules, rule])
      setOpen(false)
    },
    [onRulesChange, rules],
  )

  return (
    <div className={cn('relative shrink-0', className)} ref={menuRef} data-testid={dataTestId}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-8 items-center gap-1 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white hover:bg-violet-700"
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="wizard-transform-add-field-trigger"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {buttonLabel}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 min-w-[240px] overflow-hidden rounded-lg border border-slate-200/90 bg-white py-1 shadow-lg dark:border-gdc-border dark:bg-gdc-card"
        >
          {visibleRuleTypes.map((meta) => {
            const Icon = TYPE_ICON[meta.type]
            return (
              <button
                key={meta.type}
                type="button"
                role="menuitem"
                data-testid={`wizard-enrichment-add-${meta.type}`}
                onClick={() => addRule(meta.type)}
                className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-gdc-rowHover"
              >
                <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', TYPE_ICON_CLASS[meta.type])} aria-hidden />
                <span>
                  <span className="block text-[12px] font-semibold text-slate-800 dark:text-slate-100">{meta.label}</span>
                  <span className="block text-[10px] text-slate-500 dark:text-gdc-muted">{meta.description}</span>
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
