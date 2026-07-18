import {
  ArrowLeftRight,
  Braces,
  Calculator,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Database,
  GitBranch,
  GripVertical,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Sparkles,
  Tag,
  Trash2,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '../../../lib/utils'
import type { EnrichmentExecPreviewWarning, EnrichmentValidationIssue } from '../../../api/gdcRuntimePreview'
import {
  ENRICHMENT_RULE_TYPES,
  QUICK_ADD_PRESETS,
  countRulesByType,
  defaultRuleForType,
  issuesForEnrichmentRule,
  localJsonataTemplateIssues,
  localNormalizeIssues,
  localTimestampConversionIssues,
  localTypeConversionIssues,
  newEnrichmentRuleId,
  newConditionId,
  syncJsonataExpression,
  type EnrichmentRuleType,
  type WizardEnrichmentRule,
} from './enrichment-rules-model'
import {
  TIMESTAMP_ON_FAILURE_OPTIONS,
  buildTimestampJsonataTemplate,
  inputFormatOptionsForValue,
  outputFormatOptionsForValue,
  previewTimestampConversion,
  timestampTimezoneToIana,
} from './timestamp-conversion-template'
import { CreatableFieldCombobox } from './creatable-field-combobox'
import { sampleValueForSourceField, UnionSchemaFieldCombobox } from './union-schema-field-combobox'
import { TimestampTimezoneCombobox } from './timestamp-timezone-combobox'
import { useDisplayTimezoneOptional } from '../../../contexts/display-timezone-context'
import type { UnionSchema } from '../../../utils/unionSchema'
import {
  TYPE_CONVERSION_ON_FAILURE_OPTIONS,
  TYPE_CONVERSION_TARGET_OPTIONS,
  previewTypeConversion,
} from './type-conversion-template'
import {
  NORMALIZE_ON_FAILURE_OPTIONS,
  NORMALIZE_OPERATION_OPTIONS,
  previewNormalizeRule,
} from './normalize-template'
import {
  JSONATA_CONDITIONAL_OPERATOR_OPTIONS,
  JSONATA_TEMPLATE_OPTIONS,
  buildJsonataFromTemplate,
  jsonataTemplateLabel,
  newJsonataPairId,
  previewJsonataTemplate,
  type JsonataTemplateId,
  type JsonataTemplateParams,
} from './jsonata-template-library'
import { getNestedPreviewValue } from './wizard-review-preview'

type EnrichmentRulesEditorProps = {
  rules: WizardEnrichmentRule[]
  onChange: (rules: WizardEnrichmentRule[]) => void
  /** Keys already present on mapped output (KEEP_EXISTING hint). */
  mappedKeysLower?: ReadonlySet<string>
  /** Backend-enriched event used for rule output preview. */
  previewEvent?: Record<string, unknown>
  /** Mapped sample event (before enrichment) for calculated input label. */
  mappedSampleEvent?: Record<string, unknown>
  /** Current stream Union Schema — Source Field picker source of truth. */
  unionSchema?: UnionSchema | null
  /** Target Field candidates (mapping outputs, generated, profile standards). */
  targetFieldCandidates?: readonly string[]
  /** Prefill Source Field when adding a rule from a selected Union Schema path. */
  selectedSourceField?: string | null
  validationIssues?: EnrichmentValidationIssue[]
  previewWarnings?: EnrichmentExecPreviewWarning[]
  validationLoading?: boolean
  className?: string
  /** Rule types hidden from add menus and filters (e.g. lookup in Charter v3 Transform). */
  excludeRuleTypes?: ReadonlyArray<EnrichmentRuleType>
  /** Override section heading (default: Transform rules). */
  sectionTitle?: string
  /** Noun after active count (default: rule). */
  activeCountNoun?: string
  /** Override add-menu button label (default: Add rule). */
  addMenuLabel?: string
  /** Override per-type labels in the add menu. */
  addTypeLabels?: Partial<Record<EnrichmentRuleType, { label: string; description: string }>>
  emptyStateNoRules?: string
  emptyStateNoFilter?: string
  emptyStateHint?: string
  resetConfirmMessage?: string
  /** Calculated field value label (default: Expression). */
  calculatedValueLabel?: string
  calculatedValuePlaceholder?: string
  /** Hide inline add menu when an external control (e.g. tab-bar + Add field) owns creation. */
  hideAddMenu?: boolean
  'data-testid'?: string
}

type FilterKey = 'all' | EnrichmentRuleType

const TYPE_ICON: Record<EnrichmentRuleType, typeof Tag> = {
  static: Tag,
  calculated: Calculator,
  lookup: Database,
  conditional: GitBranch,
  normalize: Zap,
  timestamp_conversion: Clock,
  type_conversion: ArrowLeftRight,
  jsonata: Braces,
}

const TYPE_ICON_CLASS: Record<EnrichmentRuleType, string> = {
  static: 'text-violet-600 dark:text-violet-400',
  calculated: 'text-amber-600 dark:text-amber-400',
  lookup: 'text-emerald-600 dark:text-emerald-400',
  conditional: 'text-violet-600 dark:text-violet-300',
  normalize: 'text-sky-600 dark:text-sky-400',
  timestamp_conversion: 'text-cyan-600 dark:text-cyan-400',
  type_conversion: 'text-indigo-600 dark:text-indigo-400',
  jsonata: 'text-fuchsia-600 dark:text-fuchsia-400',
}

const inputCls =
  'h-8 w-full min-w-0 rounded-md border border-slate-200/90 bg-white px-2 text-[11px] text-slate-900 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100'

const textareaCls =
  'w-full min-w-0 rounded-md border border-slate-200/90 bg-white px-2 py-1.5 font-mono text-[11px] text-slate-900 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100'

function ruleTypeLabel(type: EnrichmentRuleType): string {
  return ENRICHMENT_RULE_TYPES.find((t) => t.type === type)?.label ?? type
}

export function EnrichmentRulesEditor({
  rules,
  onChange,
  mappedKeysLower,
  previewEvent,
  mappedSampleEvent,
  unionSchema = null,
  targetFieldCandidates = [],
  selectedSourceField = null,
  validationIssues = [],
  previewWarnings = [],
  validationLoading = false,
  className,
  excludeRuleTypes = [],
  sectionTitle = 'Transform rules',
  activeCountNoun = 'rule',
  addMenuLabel = 'Add rule',
  addTypeLabels,
  emptyStateNoRules = 'No transform rules yet',
  emptyStateNoFilter = 'No rules match this filter',
  emptyStateHint,
  resetConfirmMessage = 'Reset all transform rules? This cannot be undone in the wizard.',
  calculatedValueLabel = 'Expression',
  calculatedValuePlaceholder = "eventName.includes('Delete') ? 8 : 5",
  hideAddMenu = false,
  'data-testid': dataTestId = 'wizard-enrichment-rules-editor',
}: EnrichmentRulesEditorProps) {
  const [filter, setFilter] = useState<FilterKey>('all')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [cardMenuId, setCardMenuId] = useState<string | null>(null)
  const addMenuRef = useRef<HTMLDivElement>(null)
  const knownRuleIdsRef = useRef(new Set(rules.map((r) => r.id)))

  const excluded = useMemo(() => new Set(excludeRuleTypes), [excludeRuleTypes])

  const visibleRuleTypes = useMemo(
    () => ENRICHMENT_RULE_TYPES.filter((t) => !excluded.has(t.type)),
    [excluded],
  )

  const counts = useMemo(() => countRulesByType(rules), [rules])

  const filteredRules = useMemo(() => {
    const base = rules.filter((r) => !excluded.has(r.type))
    if (filter === 'all') return base
    return base.filter((r) => r.type === filter)
  }, [excluded, filter, rules])

  useEffect(() => {
    if (!addMenuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) setAddMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [addMenuOpen])

  useEffect(() => {
    const prevIds = knownRuleIdsRef.current
    const addedIds = rules.filter((r) => !prevIds.has(r.id)).map((r) => r.id)
    if (addedIds.length > 0) {
      setExpandedIds((prev) => {
        const next = new Set(prev)
        for (const id of addedIds) next.add(id)
        return next
      })
    }
    knownRuleIdsRef.current = new Set(rules.map((r) => r.id))
  }, [rules])

  const updateRule = useCallback(
    (id: string, patch: Partial<WizardEnrichmentRule>) => {
      onChange(
        rules.map((r) => {
          if (r.id !== id) return r
          const merged = { ...r, ...patch }
          if (merged.type === 'jsonata') return syncJsonataExpression(merged)
          return merged
        }),
      )
    },
    [onChange, rules],
  )

  const removeRule = useCallback(
    (id: string) => {
      onChange(rules.filter((r) => r.id !== id))
      setExpandedIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    },
    [onChange, rules],
  )

  const addRule = useCallback(
    (type: EnrichmentRuleType) => {
      const rule = defaultRuleForType(type, rules.length, {
        sourceField: selectedSourceField,
      })
      onChange([...rules, rule])
      setExpandedIds((prev) => new Set(prev).add(rule.id))
      setAddMenuOpen(false)
    },
    [onChange, rules, selectedSourceField],
  )

  const addPreset = useCallback(
    (preset: (typeof QUICK_ADD_PRESETS)[number]) => {
      const exists = rules.some((r) => r.fieldName.trim().toLowerCase() === preset.field.toLowerCase())
      if (exists) return
      const rule: WizardEnrichmentRule = {
        ...defaultRuleForType('static', rules.length),
        id: newEnrichmentRuleId(),
        label: preset.label,
        fieldName: preset.field,
        staticValue: preset.value,
        type: 'static',
      }
      onChange([...rules, rule])
      setExpandedIds((prev) => new Set(prev).add(rule.id))
    },
    [onChange, rules],
  )

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const resetAll = useCallback(() => {
    if (rules.length === 0) return
    if (!window.confirm(resetConfirmMessage)) return
    onChange([])
    setExpandedIds(new Set())
  }, [onChange, resetConfirmMessage, rules.length])

  const resolvedEmptyHint =
    emptyStateHint ??
    (hideAddMenu
      ? 'Use + Add field above or Quick Add Presets to get started.'
      : `Use ${addMenuLabel} or Quick Add Presets to get started.`)

  const duplicateRule = useCallback(
    (rule: WizardEnrichmentRule) => {
      const copy: WizardEnrichmentRule = {
        ...rule,
        id: newEnrichmentRuleId(),
        label: `${rule.label} (copy)`,
        fieldName: rule.fieldName.trim() ? `${rule.fieldName}_copy` : '',
        conditions: rule.conditions.map((c) => ({ ...c, id: newConditionId() })),
      }
      onChange([...rules, copy])
      setExpandedIds((prev) => new Set(prev).add(copy.id))
      setCardMenuId(null)
    },
    [onChange, rules],
  )

  const activeCount = rules.filter((r) => r.enabled && r.fieldName.trim()).length

  return (
    <section
      data-testid={dataTestId}
      className={cn('rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card', className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{sectionTitle}</h3>
          <p className="text-[11px] text-slate-500 dark:text-gdc-muted">
            {activeCount} active {activeCountNoun}
            {activeCount === 1 ? '' : 's'} · {rules.length} total
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={resetAll}
            disabled={rules.length === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Reset
          </button>
          {hideAddMenu ? null : (
            <div className="relative" ref={addMenuRef}>
              <button
                type="button"
                onClick={() => setAddMenuOpen((o) => !o)}
                className="inline-flex h-8 items-center gap-1 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white hover:bg-violet-700"
                aria-expanded={addMenuOpen}
                aria-haspopup="menu"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {addMenuLabel}
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', addMenuOpen && 'rotate-180')} aria-hidden />
              </button>
              {addMenuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 z-30 mt-1 min-w-[240px] overflow-hidden rounded-lg border border-slate-200/90 bg-white py-1 shadow-lg dark:border-gdc-border dark:bg-gdc-card"
                >
                  {visibleRuleTypes.map((meta) => {
                    const Icon = TYPE_ICON[meta.type]
                    const addLabel = addTypeLabels?.[meta.type]?.label ?? meta.label
                    const addDescription = addTypeLabels?.[meta.type]?.description ?? meta.description
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
                          <span className="block text-[12px] font-semibold text-slate-800 dark:text-slate-100">{addLabel}</span>
                          <span className="block text-[10px] text-slate-500 dark:text-gdc-muted">{addDescription}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} label={`All (${counts.all})`} />
        {visibleRuleTypes.map((meta) => {
          const Icon = TYPE_ICON[meta.type]
          return (
            <FilterChip
              key={meta.type}
              active={filter === meta.type}
              onClick={() => setFilter(meta.type)}
              label={`${meta.label} (${counts[meta.type]})`}
              icon={<Icon className="h-3 w-3" aria-hidden />}
            />
          )
        })}
      </div>

      <div className="mt-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Quick Add Presets</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {QUICK_ADD_PRESETS.map((p) => {
            const added = rules.some((r) => r.fieldName.trim().toLowerCase() === p.field.toLowerCase())
            return (
              <button
                key={p.field}
                type="button"
                disabled={added}
                onClick={() => addPreset(p)}
                title={added ? 'Already added' : `Add ${p.field}`}
                className={cn(
                  'inline-flex h-7 items-center rounded-full border px-2.5 text-[11px] font-semibold transition-colors',
                  added
                    ? 'cursor-not-allowed border-violet-200/80 bg-violet-500/10 text-violet-600 opacity-80 dark:border-violet-500/30 dark:text-violet-300'
                    : 'border-violet-300/70 bg-violet-500/[0.07] text-violet-800 hover:bg-violet-500/15 dark:border-violet-500/40 dark:text-violet-200 dark:hover:bg-violet-500/20',
                )}
              >
                {p.field}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {filteredRules.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-6 text-center dark:border-gdc-border dark:bg-gdc-card">
            <p className="text-[12px] font-medium text-slate-700 dark:text-slate-200">
              {rules.length === 0 ? emptyStateNoRules : emptyStateNoFilter}
            </p>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-gdc-muted">{resolvedEmptyHint}</p>
          </div>
        ) : (
          filteredRules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              expanded={expandedIds.has(rule.id)}
              onToggle={() => toggleExpanded(rule.id)}
              onUpdate={(patch) => updateRule(rule.id, patch)}
              onRemove={() => removeRule(rule.id)}
              onDuplicate={() => duplicateRule(rule)}
              menuOpen={cardMenuId === rule.id}
              onMenuToggle={() => setCardMenuId((id) => (id === rule.id ? null : rule.id))}
              onMenuClose={() => setCardMenuId(null)}
              mappedConflict={
                !!mappedKeysLower &&
                rule.fieldName.trim().length > 0 &&
                mappedKeysLower.has(rule.fieldName.trim().toLowerCase())
              }
              previewEvent={previewEvent}
              mappedSampleEvent={mappedSampleEvent}
              unionSchema={unionSchema}
              targetFieldCandidates={targetFieldCandidates}
              validationIssues={validationIssues}
              previewWarnings={previewWarnings}
              validationLoading={validationLoading}
              calculatedValueLabel={calculatedValueLabel}
              calculatedValuePlaceholder={calculatedValuePlaceholder}
            />
          ))
        )}
      </div>

      <p className="mt-3 flex items-center gap-1 text-[10px] text-slate-500 dark:text-gdc-muted">
        <GripVertical className="h-3 w-3 shrink-0 opacity-50" aria-hidden />
        Drag to reorder fields (ordering follows list order; reordering UI is not enabled).
      </p>
    </section>
  )
}

function FilterChip({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean
  onClick: () => void
  label: string
  icon?: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[10px] font-semibold transition-colors',
        active
          ? 'border-violet-500/50 bg-violet-500/15 text-violet-800 dark:border-violet-400/40 dark:text-violet-200'
          : 'border-slate-200/90 bg-white text-slate-600 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-gdc-muted',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function RuleCard({
  rule,
  expanded,
  onToggle,
  onUpdate,
  onRemove,
  onDuplicate,
  menuOpen,
  onMenuToggle,
  onMenuClose,
  mappedConflict,
  previewEvent,
  mappedSampleEvent,
  unionSchema = null,
  targetFieldCandidates = [],
  validationIssues,
  previewWarnings,
  validationLoading,
  calculatedValueLabel,
  calculatedValuePlaceholder,
}: {
  rule: WizardEnrichmentRule
  expanded: boolean
  onToggle: () => void
  onUpdate: (patch: Partial<WizardEnrichmentRule>) => void
  onRemove: () => void
  onDuplicate: () => void
  menuOpen: boolean
  onMenuToggle: () => void
  onMenuClose: () => void
  mappedConflict: boolean
  previewEvent?: Record<string, unknown>
  mappedSampleEvent?: Record<string, unknown>
  unionSchema?: UnionSchema | null
  targetFieldCandidates?: readonly string[]
  validationIssues: EnrichmentValidationIssue[]
  previewWarnings: EnrichmentExecPreviewWarning[]
  validationLoading: boolean
  calculatedValueLabel: string
  calculatedValuePlaceholder: string
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const Icon = TYPE_ICON[rule.type]
  const displayTz = useDisplayTimezoneOptional()
  const targetPreviewValue = useMemo(() => {
    if (!previewEvent || !rule.fieldName.trim()) return null
    return getNestedPreviewValue(previewEvent, rule.fieldName)
  }, [previewEvent, rule.fieldName])
  const timestampSampleRaw = useMemo(() => {
    if (rule.type !== 'timestamp_conversion') return undefined
    const fromSchema = sampleValueForSourceField(unionSchema, rule.tsSourceField)
    if (fromSchema !== undefined) return fromSchema
    if (!mappedSampleEvent) return undefined
    const src = rule.tsSourceField.trim()
    if (!src) return undefined
    return getNestedPreviewValue(mappedSampleEvent, src)
  }, [mappedSampleEvent, rule, unionSchema])
  const timestampPreview = useMemo(() => {
    if (rule.type !== 'timestamp_conversion') return null
    return previewTimestampConversion({
      raw: timestampSampleRaw,
      inputFormat: rule.tsInputFormat,
      outputFormat: rule.tsOutputFormat,
      timezoneIana: timestampTimezoneToIana(rule.tsTimezoneMode, rule.tsCustomTimezone),
    })
  }, [rule, timestampSampleRaw])
  const timestampBeforeValue = timestampPreview?.before ?? null
  const typeBeforeValue = useMemo(() => {
    if (rule.type !== 'type_conversion' || !mappedSampleEvent) return null
    const src = rule.tcSourceField.trim()
    if (!src) return null
    return getNestedPreviewValue(mappedSampleEvent, src)
  }, [mappedSampleEvent, rule])
  const typeAfterValue = useMemo(() => {
    if (rule.type !== 'type_conversion' || typeBeforeValue === null) return null
    return previewTypeConversion(typeBeforeValue, rule.tcTargetType).value
  }, [rule, typeBeforeValue])
  const normalizeSampleRaw = useMemo(() => {
    if (rule.type !== 'normalize') return undefined
    const fromSchema = sampleValueForSourceField(unionSchema, rule.normalizeSourceField)
    if (fromSchema !== undefined) return fromSchema
    if (!mappedSampleEvent) return undefined
    const src = rule.normalizeSourceField.trim()
    if (!src) return undefined
    return getNestedPreviewValue(mappedSampleEvent, src)
  }, [mappedSampleEvent, rule, unionSchema])
  const normalizePreview = useMemo(() => {
    if (rule.type !== 'normalize') return null
    return previewNormalizeRule({
      raw: normalizeSampleRaw,
      operation: rule.normalizeOperation,
    })
  }, [rule, normalizeSampleRaw])
  const normalizeBeforeValue = normalizePreview?.before ?? null
  const normalizeAfterValue = normalizePreview?.after ?? null
  const normalizePreviewWarning = normalizePreview?.warning ?? null
  const jsonataPreview = useMemo(() => {
    if (rule.type !== 'jsonata') return null
    try {
      return previewJsonataTemplate(
        mappedSampleEvent,
        rule.jtTemplate,
        rule.jtParams,
        rule.jtAdvancedOverride ? rule.expression : undefined,
      )
    } catch {
      return { value: null, warning: 'Preview failed', before: null }
    }
  }, [mappedSampleEvent, rule])
  const cardValidation = useMemo(() => {
    const fromApi = issuesForEnrichmentRule(rule, validationIssues)
    const local = [
      ...localTimestampConversionIssues(rule),
      ...localTypeConversionIssues(rule, typeBeforeValue ?? undefined),
      ...localNormalizeIssues(rule, normalizeSampleRaw),
      ...localJsonataTemplateIssues(rule, mappedSampleEvent),
    ]
    return [...fromApi, ...local]
  }, [rule, validationIssues, typeBeforeValue, normalizeSampleRaw, mappedSampleEvent])
  const cardPreviewWarnings = useMemo(
    () => issuesForEnrichmentRule(rule, previewWarnings),
    [rule, previewWarnings],
  )
  const validationErrors = cardValidation.filter((i) => i.severity === 'error')
  const validationWarns = cardValidation.filter((i) => i.severity === 'warning')
  const hasCardIssue = validationErrors.length > 0 || validationWarns.length > 0 || cardPreviewWarnings.length > 0
  const calcPreviewInput = useMemo(() => {
    if (!mappedSampleEvent) return 'sample event'
    const v =
      mappedSampleEvent.eventName ??
      mappedSampleEvent.event_name ??
      mappedSampleEvent.action
    return v != null ? String(v) : 'sample event'
  }, [mappedSampleEvent])

  const cardSummary =
    rule.type === 'timestamp_conversion'
      ? `${rule.tsSourceField.trim() || '—'} → ${rule.fieldName.trim() || '—'}`
      : rule.type === 'normalize'
        ? `${rule.normalizeSourceField.trim() || '—'} → ${rule.fieldName.trim() || '—'}`
        : rule.fieldName || '—'

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onMenuClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onMenuClose()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen, onMenuClose])

  return (
    <article
      className={cn(
        'rounded-lg border border-slate-200/80 bg-white dark:border-gdc-border dark:bg-gdc-card',
        !rule.enabled && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-2 px-2 py-2">
        <GripVertical className="h-4 w-4 shrink-0 text-slate-300 dark:text-gdc-muted" aria-hidden />
        <Icon className={cn('h-4 w-4 shrink-0', TYPE_ICON_CLASS[rule.type])} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">{rule.label || 'Untitled'}</span>
            <span className="rounded-full border border-slate-200/90 bg-slate-50 px-2 py-px text-[9px] font-semibold text-slate-600 dark:border-gdc-border dark:bg-gdc-elevated dark:text-slate-300">
              {ruleTypeLabel(rule.type)}
            </span>
            {hasCardIssue ? (
              <span
                className="inline-flex items-center gap-0.5 rounded-full border border-amber-400/50 bg-amber-500/10 px-1.5 py-px text-[9px] font-semibold text-amber-800 dark:text-amber-200"
                title={[...validationErrors, ...validationWarns, ...cardPreviewWarnings].map((i) => i.message).join('; ')}
              >
                ⚠
                {validationErrors.length > 0 ? ' Error' : cardPreviewWarnings.length > 0 ? ' Preview' : ' Warn'}
              </span>
            ) : null}
            {rule.type !== 'static' && rule.enabled ? (
              <span className="rounded-full border border-violet-400/40 bg-violet-500/10 px-1.5 py-px text-[9px] font-semibold text-violet-800 dark:text-violet-200">
                Applied live
              </span>
            ) : null}
          </div>
          <p className="truncate font-mono text-[10px] text-slate-500 dark:text-gdc-muted" data-testid="enrichment-rule-card-summary">
            {cardSummary}
            {rule.type !== 'timestamp_conversion' &&
            rule.type !== 'normalize' &&
            targetPreviewValue != null &&
            rule.fieldName.trim() ? (
              <span className="text-emerald-700 dark:text-emerald-300">
                {' → '}
                {String(targetPreviewValue)}
              </span>
            ) : null}
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-1.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={(e) => onUpdate({ enabled: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-slate-300 text-violet-600 focus:ring-violet-500/30"
            aria-label={`Enable ${rule.label.trim() || 'rule'}`}
          />
          Enabled
        </label>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={onMenuToggle}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-gdc-rowHover"
            aria-label="Rule actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 z-20 mt-1 min-w-[120px] rounded-md border border-slate-200/90 bg-white py-1 shadow-lg dark:border-gdc-border dark:bg-gdc-card"
            >
              <button
                type="button"
                role="menuitem"
                onClick={onDuplicate}
                className="block w-full px-3 py-1.5 text-left text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-gdc-rowHover"
              >
                Duplicate
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onRemove()
                  onMenuClose()
                }}
                className="block w-full px-3 py-1.5 text-left text-[11px] font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                Delete
              </button>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-gdc-rowHover"
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse rule' : 'Expand rule'}
        >
          {expanded ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
        </button>
      </div>

      {expanded ? (
        <div className="border-t border-slate-100 px-3 py-3 dark:border-gdc-border">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Display name</span>
              <input
                value={rule.label}
                onChange={(e) => onUpdate({ label: e.target.value })}
                className={inputCls}
                placeholder="Rule label"
              />
            </label>
            {rule.type === 'timestamp_conversion' || rule.type === 'normalize' ? (
              <div className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Summary</span>
                <p
                  className="flex h-8 items-center font-mono text-[11px] text-slate-600 dark:text-gdc-muted"
                  data-testid={rule.type === 'normalize' ? 'normalize-card-summary' : 'ts-card-summary'}
                >
                  {cardSummary}
                </p>
              </div>
            ) : (
              <label className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Target field</span>
                <input
                  value={rule.fieldName}
                  onChange={(e) => onUpdate({ fieldName: e.target.value })}
                  className={cn(inputCls, 'font-mono')}
                  placeholder="metadata.field_name"
                />
              </label>
            )}
          </div>
          {mappedConflict ? (
            <p className="mt-2 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
              Output field exists — transform rule skipped (KEEP_EXISTING).
            </p>
          ) : null}
          {validationLoading ? (
            <p className="mt-2 text-[10px] text-slate-500 dark:text-gdc-muted">Validating…</p>
          ) : null}
          {validationErrors.length > 0 ? (
            <ul
              id={`enrichment-rule-${rule.id}-errors`}
              role="alert"
              className="mt-2 space-y-1 rounded-md border border-red-300/50 bg-red-50/80 px-2 py-1.5 dark:border-red-500/30 dark:bg-red-950/30"
            >
              {validationErrors.map((issue, idx) => (
                <li key={`${issue.code}-${idx}`} className="text-[10px] font-medium text-red-800 dark:text-red-200">
                  {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
          {validationWarns.length > 0 ? (
            <ul className="mt-2 space-y-1 rounded-md border border-amber-300/50 bg-amber-50/80 px-2 py-1.5 dark:border-amber-500/30 dark:bg-amber-950/30">
              {validationWarns.map((issue, idx) => (
                <li key={`${issue.code}-${idx}`} className="text-[10px] font-medium text-amber-800 dark:text-amber-200">
                  {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
          {cardPreviewWarnings.length > 0 ? (
            <ul className="mt-2 space-y-1 rounded-md border border-amber-300/50 bg-amber-50/70 px-2 py-1.5 dark:border-amber-500/30 dark:bg-amber-950/25">
              {cardPreviewWarnings.map((issue, idx) => (
                <li key={`${issue.code}-${idx}`} className="text-[10px] font-medium text-amber-900 dark:text-amber-100">
                  <span className="font-mono">{issue.code}</span>: {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
          {rule.type !== 'static' && rule.enabled ? (
            <p className="mt-2 text-[10px] text-violet-700 dark:text-violet-300">
              Applied live — this rule runs on every event in the transform stage (same evaluation as preview).
            </p>
          ) : null}

          <div className="mt-3">
            {renderRuleBody(rule, onUpdate, {
              calcOutput: targetPreviewValue,
              calcInput: rule.type === 'calculated' ? calcPreviewInput : undefined,
              calculatedValueLabel,
              calculatedValuePlaceholder,
              timestampBefore: timestampBeforeValue,
              timestampAfter: timestampPreview?.after ?? null,
              timestampPreviewWarning: timestampPreview?.warning ?? null,
              typeBefore: typeBeforeValue,
              typeAfter: typeAfterValue,
              normalizeBefore: normalizeBeforeValue,
              normalizeAfter: normalizeAfterValue,
              normalizePreviewWarning,
              jsonataPreview,
              unionSchema,
              targetFieldCandidates,
              preferredUserTimezone: displayTz?.userTimezone ?? null,
              hasValidationErrors: validationErrors.length > 0,
              errorListId: `enrichment-rule-${rule.id}-errors`,
            })}
          </div>
        </div>
      ) : null}
    </article>
  )
}

function renderRuleBody(
  rule: WizardEnrichmentRule,
  onUpdate: (patch: Partial<WizardEnrichmentRule>) => void,
  calcPreview: {
    calcOutput: unknown
    calcInput?: string
    calculatedValueLabel: string
    calculatedValuePlaceholder: string
    timestampBefore?: unknown
    timestampAfter?: unknown
    timestampPreviewWarning?: string | null
    typeBefore?: unknown
    typeAfter?: unknown
    normalizeBefore?: unknown
    normalizeAfter?: unknown
    normalizePreviewWarning?: string | null
    jsonataPreview?: { value: unknown; warning: string | null; before: unknown } | null
    unionSchema?: UnionSchema | null
    targetFieldCandidates?: readonly string[]
    preferredUserTimezone?: string | null
    hasValidationErrors?: boolean
    errorListId?: string
  },
) {
  const hasValidationErrors = Boolean(calcPreview.hasValidationErrors)
  const errorListId = calcPreview.errorListId
  switch (rule.type) {
    case 'static':
      return (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Value</span>
            <input
              value={rule.staticValue}
              onChange={(e) => onUpdate({ staticValue: e.target.value })}
              className={cn(inputCls, 'font-mono')}
              placeholder="Fixed value or {{now_utc}}"
            />
          </label>
          <TargetFieldPreview rule={rule} output={calcPreview.calcOutput} />
        </div>
      )
    case 'calculated':
      return (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {calcPreview.calculatedValueLabel}
            </span>
            <div className="relative">
              <Code2 className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-slate-400" aria-hidden />
              <textarea
                value={rule.expression}
                onChange={(e) => onUpdate({ expression: e.target.value })}
                rows={3}
                className={cn(textareaCls, 'border-violet-400/60 pl-8 focus:border-violet-500 dark:border-violet-500/50')}
                placeholder={calcPreview.calculatedValuePlaceholder}
              />
            </div>
          </label>
          <TargetFieldPreview rule={rule} output={calcPreview.calcOutput} inputLabel={calcPreview.calcInput} />
        </div>
      )
    case 'lookup':
      return (
        <div className="space-y-2">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Lookup table</span>
            <select
              value={rule.lookupTable}
              onChange={(e) => onUpdate({ lookupTable: e.target.value })}
              className={inputCls}
            >
              <option value="aws-regions">AWS Regions</option>
              <option value="severity-labels">Severity Labels</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Key field</span>
            <input
              value={rule.lookupKeyField}
              onChange={(e) => onUpdate({ lookupKeyField: e.target.value })}
              className={cn(inputCls, 'font-mono')}
              placeholder="region"
            />
          </label>
        </div>
        <TargetFieldPreview rule={rule} output={calcPreview.calcOutput} />
        </div>
      )
    case 'conditional':
      return (
        <div className="space-y-2">
          {rule.conditions.map((cond, idx) => (
            <div key={cond.id} className="grid gap-2 rounded-md border border-slate-100 p-2 dark:border-gdc-border sm:grid-cols-[1fr_1fr_auto]">
              <label className="block space-y-1">
                <span className="text-[10px] font-semibold text-slate-500">When</span>
                <input
                  value={cond.when}
                  onChange={(e) => {
                    const next = rule.conditions.map((c, i) => (i === idx ? { ...c, when: e.target.value } : c))
                    onUpdate({ conditions: next })
                  }}
                  className={cn(inputCls, 'font-mono text-[10px]')}
                  placeholder="status === 'success'"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] font-semibold text-slate-500">Then</span>
                <input
                  value={cond.then}
                  onChange={(e) => {
                    const next = rule.conditions.map((c, i) => (i === idx ? { ...c, then: e.target.value } : c))
                    onUpdate({ conditions: next })
                  }}
                  className={inputCls}
                  placeholder="success"
                />
              </label>
              <button
                type="button"
                onClick={() => onUpdate({ conditions: rule.conditions.filter((_, i) => i !== idx) })}
                disabled={rule.conditions.length <= 1}
                className="mt-5 inline-flex h-8 w-8 items-center justify-center self-end rounded-md text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-950/40"
                aria-label="Remove condition"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              onUpdate({
                conditions: [...rule.conditions, { id: newConditionId(), when: '', then: '' }],
              })
            }
            className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
          >
            + Add condition
          </button>
          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Default</span>
            <input
              value={rule.conditionalDefault}
              onChange={(e) => onUpdate({ conditionalDefault: e.target.value })}
              className={inputCls}
              placeholder="unknown"
            />
          </label>
          <TargetFieldPreview rule={rule} output={calcPreview.calcOutput} />
        </div>
      )
    case 'normalize': {
      const targetCandidates = (() => {
        const list = [...(calcPreview.targetFieldCandidates ?? [])]
        if (rule.normalizeSourceField.trim()) list.unshift(rule.normalizeSourceField.trim())
        if (rule.fieldName.trim()) list.unshift(rule.fieldName.trim())
        return list
      })()
      const onSourceChange = (sourceField: string) => {
        const patch: Partial<WizardEnrichmentRule> = { normalizeSourceField: sourceField }
        if (!rule.fieldName.trim() || rule.fieldName.trim() === rule.normalizeSourceField.trim()) {
          patch.fieldName = sourceField
        }
        onUpdate(patch)
      }
      return (
        <div className="space-y-3" data-testid="normalize-fields">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="block space-y-1">
              <span
                id={`normalize-source-label-${rule.id}`}
                className="text-[10px] font-semibold uppercase tracking-wide text-slate-500"
              >
                Source Field
                <span className="text-red-500" aria-hidden>
                  {' '}
                  *
                </span>
              </span>
              <UnionSchemaFieldCombobox
                value={rule.normalizeSourceField}
                onChange={onSourceChange}
                unionSchema={calcPreview.unionSchema}
                aria-labelledby={`normalize-source-label-${rule.id}`}
                aria-required
                aria-invalid={hasValidationErrors && !rule.normalizeSourceField.trim() ? true : undefined}
                aria-describedby={hasValidationErrors && errorListId ? errorListId : undefined}
                data-testid="normalize-source-field"
              />
            </div>
            <div className="block space-y-1">
              <span
                id={`normalize-target-label-${rule.id}`}
                className="text-[10px] font-semibold uppercase tracking-wide text-slate-500"
              >
                Target Field
                <span className="text-red-500" aria-hidden>
                  {' '}
                  *
                </span>
              </span>
              <CreatableFieldCombobox
                value={rule.fieldName}
                onChange={(fieldName) => onUpdate({ fieldName })}
                candidates={targetCandidates}
                aria-labelledby={`normalize-target-label-${rule.id}`}
                aria-required
                aria-invalid={hasValidationErrors && !rule.fieldName.trim() ? true : undefined}
                aria-describedby={hasValidationErrors && errorListId ? errorListId : undefined}
                data-testid="normalize-target-field"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Operation</span>
              <select
                value={rule.normalizeOperation}
                onChange={(e) => {
                  const op = e.target.value as WizardEnrichmentRule['normalizeOperation']
                  onUpdate({ normalizeOperation: op, normalizeFormat: op })
                }}
                className={inputCls}
                data-testid="normalize-operation"
              >
                {NORMALIZE_OPERATION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">On Failure</span>
              <select
                value={rule.normalizeOnFailure}
                onChange={(e) =>
                  onUpdate({
                    normalizeOnFailure: e.target.value as WizardEnrichmentRule['normalizeOnFailure'],
                  })
                }
                className={inputCls}
                data-testid="normalize-on-failure"
              >
                {NORMALIZE_ON_FAILURE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div
            className="rounded-lg border border-slate-200/80 bg-slate-50/90 px-3 py-2 dark:border-gdc-border dark:bg-gdc-elevated"
            data-testid="normalize-before-after-preview"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Transform Preview</p>
            {calcPreview.normalizePreviewWarning ? (
              <p
                className="mt-2 text-[11px] text-amber-800 dark:text-amber-200"
                data-testid="normalize-preview-warning"
              >
                {calcPreview.normalizePreviewWarning}
              </p>
            ) : (
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                <div>
                  <p className="text-[10px] font-semibold text-slate-500">Before</p>
                  <p
                    className="mt-0.5 break-all font-mono text-[11px] text-slate-800 dark:text-slate-100"
                    data-testid="normalize-preview-before"
                  >
                    {calcPreview.normalizeBefore == null
                      ? '—'
                      : typeof calcPreview.normalizeBefore === 'string'
                        ? calcPreview.normalizeBefore
                        : JSON.stringify(calcPreview.normalizeBefore)}
                  </p>
                </div>
                <div className="text-center text-slate-400" aria-hidden>
                  ↓
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-slate-500">After</p>
                  <p
                    className="mt-0.5 break-all font-mono text-[11px] font-semibold text-emerald-800 dark:text-emerald-200"
                    data-testid="normalize-preview-after"
                  >
                    {calcPreview.normalizeAfter == null
                      ? '—'
                      : typeof calcPreview.normalizeAfter === 'string'
                        ? calcPreview.normalizeAfter
                        : JSON.stringify(calcPreview.normalizeAfter)}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )
    }
    case 'timestamp_conversion': {
      const autoTemplate = buildTimestampJsonataTemplate({
        sourceField: rule.tsSourceField,
        inputFormat: rule.tsInputFormat,
        outputFormat: rule.tsOutputFormat,
      })
      const shownTemplate = rule.tsExpressionOverride.trim() || autoTemplate
      const inputOptions = inputFormatOptionsForValue(rule.tsInputFormat)
      const outputOptions = outputFormatOptionsForValue(rule.tsOutputFormat)
      const targetCandidates = (() => {
        const list = [...(calcPreview.targetFieldCandidates ?? [])]
        if (rule.tsSourceField.trim()) list.unshift(rule.tsSourceField.trim())
        if (rule.fieldName.trim()) list.unshift(rule.fieldName.trim())
        return list
      })()
      const onSourceChange = (sourceField: string) => {
        const patch: Partial<WizardEnrichmentRule> = { tsSourceField: sourceField }
        if (!rule.fieldName.trim() || rule.fieldName.trim() === rule.tsSourceField.trim()) {
          patch.fieldName = sourceField
        }
        onUpdate(patch)
      }
      return (
        <div className="space-y-3" data-testid="timestamp-conversion-fields">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="block space-y-1">
              <span
                id={`ts-source-label-${rule.id}`}
                className="text-[10px] font-semibold uppercase tracking-wide text-slate-500"
              >
                Source Field
                <span className="text-red-500" aria-hidden>
                  {' '}
                  *
                </span>
              </span>
              <UnionSchemaFieldCombobox
                value={rule.tsSourceField}
                onChange={onSourceChange}
                unionSchema={calcPreview.unionSchema}
                aria-labelledby={`ts-source-label-${rule.id}`}
                aria-required
                aria-invalid={hasValidationErrors && !rule.tsSourceField.trim() ? true : undefined}
                aria-describedby={hasValidationErrors && errorListId ? errorListId : undefined}
                data-testid="ts-source-field"
              />
            </div>
            <div className="block space-y-1">
              <span
                id={`ts-target-label-${rule.id}`}
                className="text-[10px] font-semibold uppercase tracking-wide text-slate-500"
              >
                Target Field
                <span className="text-red-500" aria-hidden>
                  {' '}
                  *
                </span>
              </span>
              <CreatableFieldCombobox
                value={rule.fieldName}
                onChange={(fieldName) => onUpdate({ fieldName })}
                candidates={targetCandidates}
                aria-labelledby={`ts-target-label-${rule.id}`}
                aria-required
                aria-invalid={hasValidationErrors && !rule.fieldName.trim() ? true : undefined}
                aria-describedby={hasValidationErrors && errorListId ? errorListId : undefined}
                data-testid="ts-target-field"
              />
            </div>
          </div>
          <div className="flex items-center justify-center text-[11px] font-semibold text-slate-400" aria-hidden>
            ↓
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Input Format</span>
              <select
                value={rule.tsInputFormat}
                onChange={(e) =>
                  onUpdate({ tsInputFormat: e.target.value as WizardEnrichmentRule['tsInputFormat'] })
                }
                className={inputCls}
                data-testid="ts-input-format"
              >
                {inputOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Output Format</span>
              <select
                value={rule.tsOutputFormat}
                onChange={(e) =>
                  onUpdate({ tsOutputFormat: e.target.value as WizardEnrichmentRule['tsOutputFormat'] })
                }
                className={inputCls}
                data-testid="ts-output-format"
              >
                {outputOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="block space-y-1">
              <span
                id={`ts-timezone-label-${rule.id}`}
                className="text-[10px] font-semibold uppercase tracking-wide text-slate-500"
              >
                Timezone
              </span>
              <TimestampTimezoneCombobox
                mode={rule.tsTimezoneMode}
                customTimezone={rule.tsCustomTimezone}
                preferredUserTimezone={calcPreview.preferredUserTimezone}
                onChange={(next) => onUpdate(next)}
                aria-labelledby={`ts-timezone-label-${rule.id}`}
                data-testid="ts-timezone"
              />
            </div>
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                On Conversion Failure
              </span>
              <select
                value={rule.tsOnFailure}
                onChange={(e) =>
                  onUpdate({ tsOnFailure: e.target.value as WizardEnrichmentRule['tsOnFailure'] })
                }
                className={inputCls}
                data-testid="ts-on-failure"
              >
                {TIMESTAMP_ON_FAILURE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div
            className="rounded-lg border border-slate-200/80 bg-slate-50/90 px-3 py-2 dark:border-gdc-border dark:bg-gdc-elevated"
            data-testid="ts-before-after-preview"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Transform Preview</p>
            {calcPreview.timestampPreviewWarning ? (
              <p className="mt-2 text-[11px] text-amber-800 dark:text-amber-200" data-testid="ts-preview-warning">
                {calcPreview.timestampPreviewWarning}
              </p>
            ) : (
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                <div>
                  <p className="text-[10px] font-semibold text-slate-500">Before</p>
                  <p
                    className="mt-0.5 break-all font-mono text-[11px] text-slate-800 dark:text-slate-100"
                    data-testid="ts-preview-before"
                  >
                    {calcPreview.timestampBefore == null
                      ? '—'
                      : typeof calcPreview.timestampBefore === 'string'
                        ? calcPreview.timestampBefore
                        : JSON.stringify(calcPreview.timestampBefore)}
                  </p>
                </div>
                <div className="text-center text-slate-400" aria-hidden>
                  ↓
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-slate-500">After</p>
                  <p
                    className="mt-0.5 break-all font-mono text-[11px] font-semibold text-emerald-800 dark:text-emerald-200"
                    data-testid="ts-preview-after"
                  >
                    {calcPreview.timestampAfter == null
                      ? '—'
                      : typeof calcPreview.timestampAfter === 'string'
                        ? calcPreview.timestampAfter
                        : JSON.stringify(calcPreview.timestampAfter)}
                  </p>
                </div>
              </div>
            )}
          </div>

          <details
            className="rounded-lg border border-slate-200/80 dark:border-gdc-border"
            data-testid="ts-advanced-jsonata"
          >
            <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold text-violet-700 dark:text-violet-300">
              Advanced · JSONata Template
            </summary>
            <div className="space-y-2 border-t border-slate-100 px-3 py-2 dark:border-gdc-border">
              <label htmlFor={`ts-jsonata-template-${rule.id}`} className="text-[10px] text-slate-500 dark:text-gdc-muted">
                Auto-generated expression. Edit to override runtime evaluation with JSONata.
              </label>
              <textarea
                id={`ts-jsonata-template-${rule.id}`}
                value={shownTemplate}
                onChange={(e) => onUpdate({ tsExpressionOverride: e.target.value })}
                rows={3}
                className={textareaCls}
                data-testid="ts-jsonata-template"
              />
              {rule.tsExpressionOverride.trim() ? (
                <button
                  type="button"
                  className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
                  onClick={() => onUpdate({ tsExpressionOverride: '' })}
                >
                  Reset to auto-generated template
                </button>
              ) : null}
            </div>
          </details>
        </div>
      )
    }
    case 'type_conversion':
      return (
        <div className="space-y-3" data-testid="type-conversion-fields">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Source Field</span>
              <input
                value={rule.tcSourceField}
                onChange={(e) => onUpdate({ tcSourceField: e.target.value })}
                className={cn(inputCls, 'font-mono')}
                placeholder="severity"
                data-testid="tc-source-field"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Target Field</span>
              <input
                value={rule.fieldName}
                onChange={(e) => onUpdate({ fieldName: e.target.value })}
                className={cn(inputCls, 'font-mono')}
                placeholder="severity"
                data-testid="tc-target-field"
              />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Target Type</span>
              <select
                value={rule.tcTargetType}
                onChange={(e) =>
                  onUpdate({ tcTargetType: e.target.value as WizardEnrichmentRule['tcTargetType'] })
                }
                className={inputCls}
                data-testid="tc-target-type"
              >
                {TYPE_CONVERSION_TARGET_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">On Failure</span>
              <select
                value={rule.tcOnFailure}
                onChange={(e) =>
                  onUpdate({ tcOnFailure: e.target.value as WizardEnrichmentRule['tcOnFailure'] })
                }
                className={inputCls}
                data-testid="tc-on-failure"
              >
                {TYPE_CONVERSION_ON_FAILURE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div
            className="rounded-lg border border-slate-200/80 bg-slate-50/90 px-3 py-2 dark:border-gdc-border dark:bg-gdc-elevated"
            data-testid="tc-before-after-preview"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Transform Preview</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
              <div>
                <p className="text-[10px] font-semibold text-slate-500">Before</p>
                <p className="mt-0.5 break-all font-mono text-[11px] text-slate-800 dark:text-slate-100">
                  {calcPreview.typeBefore == null
                    ? '—'
                    : typeof calcPreview.typeBefore === 'string'
                      ? calcPreview.typeBefore
                      : JSON.stringify(calcPreview.typeBefore)}
                </p>
              </div>
              <div className="text-center text-slate-400" aria-hidden>
                ↓
              </div>
              <div>
                <p className="text-[10px] font-semibold text-slate-500">After</p>
                <p className="mt-0.5 break-all font-mono text-[11px] font-semibold text-emerald-800 dark:text-emerald-200">
                  {calcPreview.typeAfter == null
                    ? '—'
                    : typeof calcPreview.typeAfter === 'string'
                      ? calcPreview.typeAfter
                      : JSON.stringify(calcPreview.typeAfter)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )
    case 'jsonata': {
      const generated = rule.jtTemplate
        ? buildJsonataFromTemplate(rule.jtTemplate, rule.jtParams)
        : ''
      const shownExpression = rule.jtAdvancedOverride ? rule.expression : rule.expression || generated
      const preview = calcPreview.jsonataPreview
      const afterValue =
        calcPreview.calcOutput != null && calcPreview.calcOutput !== ''
          ? calcPreview.calcOutput
          : preview?.value
      const updateParams = (patch: Partial<JsonataTemplateParams>) => {
        onUpdate({
          jtParams: { ...rule.jtParams, ...patch },
          jtAdvancedOverride: false,
        })
      }
      const formatPreview = (v: unknown) => {
        if (v == null) return '—'
        if (typeof v === 'string') return v
        try {
          return JSON.stringify(v)
        } catch {
          return String(v)
        }
      }
      return (
        <div className="space-y-3" data-testid="jsonata-template-fields">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Template</span>
              <select
                value={rule.jtTemplate || ''}
                onChange={(e) => {
                  const next = e.target.value as JsonataTemplateId | ''
                  onUpdate({
                    jtTemplate: next,
                    jtAdvancedOverride: false,
                    label: next ? jsonataTemplateLabel(next) : 'Advanced JSONata',
                  })
                }}
                className={inputCls}
                data-testid="jsonata-template-select"
              >
                <option value="">Advanced JSONata (manual)</option>
                {JSONATA_TEMPLATE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Target Field</span>
              <input
                value={rule.fieldName}
                onChange={(e) => onUpdate({ fieldName: e.target.value })}
                className={cn(inputCls, 'font-mono')}
                placeholder="target_field"
                data-testid="jsonata-target-field"
              />
            </label>
          </div>

          {rule.jtTemplate && !rule.jtAdvancedOverride ? (
            <div className="space-y-3" data-testid="jsonata-template-form">
              {(rule.jtTemplate === 'copy_field' ||
                rule.jtTemplate === 'rename_field' ||
                rule.jtTemplate === 'default_value' ||
                rule.jtTemplate === 'array_join') && (
                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Source Field
                  </span>
                  <input
                    value={rule.jtParams.sourceField}
                    onChange={(e) => updateParams({ sourceField: e.target.value })}
                    className={cn(inputCls, 'font-mono')}
                    data-testid="jsonata-source-field"
                  />
                </label>
              )}
              {rule.jtTemplate === 'extract_nested' && (
                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Source Path
                  </span>
                  <input
                    value={rule.jtParams.sourcePath}
                    onChange={(e) => updateParams({ sourcePath: e.target.value })}
                    className={cn(inputCls, 'font-mono')}
                    placeholder="user.email"
                    data-testid="jsonata-source-path"
                  />
                </label>
              )}
              {(rule.jtTemplate === 'concat_fields' || rule.jtTemplate === 'coalesce') && (
                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Source Fields (comma-separated)
                  </span>
                  <input
                    value={rule.jtParams.sourceFields.join(', ')}
                    onChange={(e) =>
                      updateParams({
                        sourceFields: e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    className={cn(inputCls, 'font-mono')}
                    placeholder="first_name, last_name"
                    data-testid="jsonata-source-fields"
                  />
                </label>
              )}
              {(rule.jtTemplate === 'concat_fields' || rule.jtTemplate === 'array_join') && (
                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Separator
                  </span>
                  <input
                    value={rule.jtParams.separator}
                    onChange={(e) => updateParams({ separator: e.target.value })}
                    className={inputCls}
                    data-testid="jsonata-separator"
                  />
                </label>
              )}
              {rule.jtTemplate === 'default_value' && (
                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Default Value
                  </span>
                  <input
                    value={rule.jtParams.defaultValue}
                    onChange={(e) => updateParams({ defaultValue: e.target.value })}
                    className={inputCls}
                    data-testid="jsonata-default-value"
                  />
                </label>
              )}
              {rule.jtTemplate === 'conditional_value' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Condition Field
                    </span>
                    <input
                      value={rule.jtParams.conditionField}
                      onChange={(e) => updateParams({ conditionField: e.target.value })}
                      className={cn(inputCls, 'font-mono')}
                      data-testid="jsonata-condition-field"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Operator
                    </span>
                    <select
                      value={rule.jtParams.operator}
                      onChange={(e) =>
                        updateParams({
                          operator: e.target.value as JsonataTemplateParams['operator'],
                        })
                      }
                      className={inputCls}
                      data-testid="jsonata-operator"
                    >
                      {JSONATA_CONDITIONAL_OPERATOR_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {rule.jtParams.operator !== 'is_empty' && rule.jtParams.operator !== 'is_not_empty' ? (
                    <label className="block space-y-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Compare Value
                      </span>
                      <input
                        value={rule.jtParams.compareValue}
                        onChange={(e) => updateParams({ compareValue: e.target.value })}
                        className={inputCls}
                        data-testid="jsonata-compare-value"
                      />
                    </label>
                  ) : null}
                  <label className="block space-y-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Then Value
                    </span>
                    <input
                      value={rule.jtParams.thenValue}
                      onChange={(e) => updateParams({ thenValue: e.target.value })}
                      className={inputCls}
                      data-testid="jsonata-then-value"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Else Value
                    </span>
                    <input
                      value={rule.jtParams.elseValue}
                      onChange={(e) => updateParams({ elseValue: e.target.value })}
                      className={inputCls}
                      data-testid="jsonata-else-value"
                    />
                  </label>
                </div>
              )}
              {rule.jtTemplate === 'static_value' && (
                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Value</span>
                  <input
                    value={rule.jtParams.staticValue}
                    onChange={(e) => updateParams({ staticValue: e.target.value })}
                    className={cn(inputCls, 'font-mono')}
                    data-testid="jsonata-static-value"
                  />
                </label>
              )}
              {rule.jtTemplate === 'build_object' && (
                <div className="space-y-2" data-testid="jsonata-object-pairs">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Key / Value Field pairs
                  </span>
                  {rule.jtParams.objectPairs.map((pair, idx) => (
                    <div key={pair.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <label className="block space-y-1">
                        <span className="sr-only">Object key {idx + 1}</span>
                        <input
                          value={pair.key}
                          onChange={(e) => {
                            const next = rule.jtParams.objectPairs.map((p, i) =>
                              i === idx ? { ...p, key: e.target.value } : p,
                            )
                            updateParams({ objectPairs: next })
                          }}
                          className={cn(inputCls, 'font-mono')}
                          placeholder="key"
                          aria-label={`Object key ${idx + 1}`}
                          data-testid={`jsonata-object-key-${idx}`}
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="sr-only">Value field {idx + 1}</span>
                        <input
                          value={pair.valueField}
                          onChange={(e) => {
                            const next = rule.jtParams.objectPairs.map((p, i) =>
                              i === idx ? { ...p, valueField: e.target.value } : p,
                            )
                            updateParams({ objectPairs: next })
                          }}
                          className={cn(inputCls, 'font-mono')}
                          placeholder="value_field"
                          aria-label={`Value field ${idx + 1}`}
                          data-testid={`jsonata-object-value-${idx}`}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          updateParams({
                            objectPairs: rule.jtParams.objectPairs.filter((_, i) => i !== idx),
                          })
                        }
                        disabled={rule.jtParams.objectPairs.length <= 1}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        aria-label={`Remove pair ${idx + 1}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      updateParams({
                        objectPairs: [
                          ...rule.jtParams.objectPairs,
                          { id: newJsonataPairId(), key: '', valueField: '' },
                        ],
                      })
                    }
                    className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
                  >
                    + Add pair
                  </button>
                </div>
              )}
            </div>
          ) : null}

          <details
            className="rounded-lg border border-slate-200/80 dark:border-gdc-border"
            open={rule.jtAdvancedOverride || !rule.jtTemplate}
            data-testid="jsonata-advanced-expression"
          >
            <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold text-violet-700 dark:text-violet-300">
              Advanced · JSONata Expression
              {rule.jtAdvancedOverride ? (
                <span
                  className="ml-2 rounded-full border border-amber-400/50 bg-amber-500/10 px-1.5 py-px text-[9px] font-semibold text-amber-800 dark:text-amber-200"
                  data-testid="jsonata-advanced-override-badge"
                >
                  Advanced override enabled
                </span>
              ) : null}
            </summary>
            <div className="space-y-2 border-t border-slate-100 px-3 py-2 dark:border-gdc-border">
              <label
                htmlFor={`jsonata-expression-${rule.id}`}
                className="text-[10px] text-slate-500 dark:text-gdc-muted"
              >
                Auto-generated from the template. Edit to override runtime evaluation.
              </label>
              <textarea
                id={`jsonata-expression-${rule.id}`}
                value={shownExpression}
                onChange={(e) =>
                  onUpdate({
                    expression: e.target.value,
                    jtAdvancedOverride: true,
                  })
                }
                rows={3}
                className={cn(textareaCls, 'border-violet-400/60 focus:border-violet-500')}
                data-testid="jsonata-expression"
              />
              {rule.jtAdvancedOverride && rule.jtTemplate ? (
                <button
                  type="button"
                  onClick={() =>
                    onUpdate({
                      jtAdvancedOverride: false,
                      expression: buildJsonataFromTemplate(rule.jtTemplate, rule.jtParams),
                    })
                  }
                  className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
                  data-testid="jsonata-reset-template"
                >
                  Reset to auto-generated template
                </button>
              ) : null}
            </div>
          </details>

          <div
            className="rounded-lg border border-slate-200/80 bg-slate-50/90 px-3 py-2 dark:border-gdc-border dark:bg-gdc-elevated"
            data-testid="jsonata-before-after-preview"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Transform Preview
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
              <div>
                <p className="text-[10px] font-semibold text-slate-500">Before</p>
                <p className="mt-0.5 break-all font-mono text-[11px] text-slate-800 dark:text-slate-100">
                  {formatPreview(preview?.before)}
                </p>
              </div>
              <div className="text-center text-slate-400" aria-hidden>
                ↓
              </div>
              <div>
                <p className="text-[10px] font-semibold text-slate-500">After</p>
                <p className="mt-0.5 break-all font-mono text-[11px] font-semibold text-emerald-800 dark:text-emerald-200">
                  {formatPreview(afterValue)}
                </p>
              </div>
            </div>
            {preview?.warning ? (
              <p
                className="mt-2 text-[10px] font-medium text-amber-800 dark:text-amber-200"
                data-testid="jsonata-preview-warning"
              >
                {preview.warning}
              </p>
            ) : null}
          </div>
        </div>
      )
    }
    default:
      return null
  }
}

function TargetFieldPreview({
  rule,
  output,
  inputLabel,
}: {
  rule: WizardEnrichmentRule
  output: unknown
  inputLabel?: string
}) {
  const field = rule.fieldName.trim() || 'target field'
  return (
    <div className="rounded-lg border border-slate-200/80 bg-slate-50/90 px-3 py-2 dark:border-gdc-border dark:bg-gdc-elevated">
      <p className="flex items-center gap-1 text-[10px] font-semibold text-slate-600 dark:text-gdc-muted">
        <Sparkles className="h-3 w-3 text-emerald-600 dark:text-emerald-400" aria-hidden />
        Target preview · <span className="font-mono">{field}</span>
      </p>
      <p className="mt-1 font-mono text-[11px] text-slate-700 dark:text-slate-200">
        {inputLabel != null ? (
          <>
            Input: <span className="text-slate-500">&quot;{inputLabel}&quot;</span>
            {' → '}
          </>
        ) : null}
        Output:{' '}
        <span className="inline-flex rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-px font-semibold text-emerald-800 dark:text-emerald-200">
          {output != null && output !== '' ? String(output) : '—'}
        </span>
      </p>
    </div>
  )
}
