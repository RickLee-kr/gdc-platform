import { useCallback, useState } from 'react'
import { cn } from '../../../lib/utils'
import { StepEnrichment } from './step-enrichment'
import { StepMapping } from './step-mapping'
import type { MappingSectionKey, WizardEnrichmentRow, WizardMappingRow, WizardState } from './wizard-state'

export type StepMappingCombinedProps = {
  state: WizardState
  activeSection?: MappingSectionKey
  onSectionChange?: (section: MappingSectionKey) => void
  onChangeMapping: (rows: WizardMappingRow[]) => void
  onChangeEnrichment: (rows: WizardEnrichmentRow[]) => void
}

const SECTION_DEFS: ReadonlyArray<{ key: MappingSectionKey; label: string; subtitle: string }> = [
  { key: 'field_mapping', label: 'Field Mapping', subtitle: 'JSONPath → output fields' },
  { key: 'enrichment', label: 'Enrichment', subtitle: 'Static & computed fields' },
  { key: 'transform', label: 'Transform', subtitle: 'Lookups · conditionals · normalize' },
]

export function StepMappingCombined({
  state,
  activeSection: controlledSection,
  onSectionChange,
  onChangeMapping,
  onChangeEnrichment,
}: StepMappingCombinedProps) {
  const [internalSection, setInternalSection] = useState<MappingSectionKey>('field_mapping')
  const section = controlledSection ?? internalSection

  const setSection = useCallback(
    (next: MappingSectionKey) => {
      if (onSectionChange) onSectionChange(next)
      else setInternalSection(next)
    },
    [onSectionChange],
  )

  return (
    <div className="space-y-4" data-testid="wizard-step-mapping">
      <header className="space-y-1">
        <h3 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">Mapping</h3>
        <p className="max-w-3xl text-[13px] leading-relaxed text-slate-600 dark:text-gdc-muted">
          Define which fields to send, add enrichment, and apply transform rules before delivery.
        </p>
      </header>

      <nav
        className="flex flex-wrap gap-1 rounded-lg border border-slate-200/80 bg-slate-50/80 p-1 dark:border-gdc-border dark:bg-gdc-card"
        aria-label="Mapping sections"
        data-testid="wizard-mapping-sections"
      >
        {SECTION_DEFS.map((item) => {
          const active = item.key === section
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`wizard-mapping-section-${item.key}`}
              onClick={() => setSection(item.key)}
              className={cn(
                'rounded-md px-3 py-1.5 text-left transition-colors',
                active
                  ? 'bg-white text-violet-700 shadow-sm dark:bg-gdc-section dark:text-violet-300'
                  : 'text-slate-600 hover:bg-white/70 hover:text-slate-900 dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover dark:hover:text-slate-100',
              )}
            >
              <span className="block text-[12px] font-semibold">{item.label}</span>
              <span className="block text-[10px] font-medium opacity-80">{item.subtitle}</span>
            </button>
          )
        })}
      </nav>

      <div role="tabpanel">
        {section === 'field_mapping' ? <StepMapping state={state} onChangeMapping={onChangeMapping} /> : null}
        {section === 'enrichment' ? <StepEnrichment state={state} onChange={onChangeEnrichment} /> : null}
        {section === 'transform' ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-slate-600 dark:text-gdc-muted">
              Add lookup tables, conditional branches, normalization, and calculated expressions. These rules run after field
              mapping in the same enrichment stage at runtime.
            </p>
            <StepEnrichment state={state} onChange={onChangeEnrichment} />
          </div>
        ) : null}
      </div>
    </div>
  )
}
