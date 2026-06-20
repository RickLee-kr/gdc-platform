import { Route } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { fetchDestinationsList, type DestinationListItem } from '../../../api/gdcDestinations'
import { WizardSharedProcessingSection } from '../route-processing/wizard-global-processing-section'
import { WizardRouteProcessingDetailPanel } from '../route-processing/wizard-route-processing-detail-panel'
import { WizardRouteProcessingList } from '../route-processing/wizard-route-processing-list'
import { ROUTE_PROCESSING_COPY } from '../route-processing/route-processing-labels'
import { StepMappingCombined } from './step-mapping-combined'
import type { WizardEnrichmentRule } from './enrichment-rules-model'
import { WizardDataProtectionDrawer } from './wizard-data-protection-drawer'
import type {
  WizardDataProtectionState,
  WizardDestinationsState,
  WizardMappingRow,
  WizardState,
} from './wizard-state'

export type StepRouteProcessingProps = {
  state: WizardState
  onChangeMapping: (rows: WizardMappingRow[]) => void
  onChangeMappingMode: (mode: WizardState['mappingMode']) => void
  onChangeFullEventJsonata: (expression: string) => void
  onChangeFullEventRegexConfigJson: (json: string) => void
  onChangeEnrichment: (rules: WizardEnrichmentRule[]) => void
  onChangeUnmappedFieldsPolicy?: (policy: WizardState['unmappedFieldsPolicy']) => void
  onChangeDataProtection: (patch: Partial<WizardDataProtectionState>) => void
  onChangeDestinations: (patch: Partial<WizardDestinationsState>) => void
  dataProtectionDrawerOpen?: boolean
  onDataProtectionDrawerOpenChange?: (open: boolean) => void
}

export function StepRouteProcessing({
  state,
  onChangeMapping,
  onChangeMappingMode,
  onChangeFullEventJsonata,
  onChangeFullEventRegexConfigJson,
  onChangeEnrichment,
  onChangeUnmappedFieldsPolicy,
  onChangeDataProtection,
  onChangeDestinations,
  dataProtectionDrawerOpen,
  onDataProtectionDrawerOpenChange,
}: StepRouteProcessingProps) {
  const [destinations, setDestinations] = useState<DestinationListItem[]>([])
  const [globalEditing, setGlobalEditing] = useState(true)
  const [selectedRouteKey, setSelectedRouteKey] = useState<string | null>(null)
  const [protectionDrawerOpen, setProtectionDrawerOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const rows = await fetchDestinationsList()
      if (!cancelled) setDestinations(rows)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const destById = useMemo(() => new Map(destinations.map((d) => [d.id, d])), [destinations])
  const routeDrafts = state.destinations.routeDrafts

  useEffect(() => {
    if (routeDrafts.length === 0) {
      setSelectedRouteKey(null)
      return
    }
    setSelectedRouteKey((prev) => {
      if (prev != null && routeDrafts.some((d) => d.key === prev)) return prev
      return routeDrafts[0]?.key ?? null
    })
  }, [routeDrafts])

  const selectedDraft = routeDrafts.find((d) => d.key === selectedRouteKey) ?? null
  const drawerOpen = dataProtectionDrawerOpen ?? protectionDrawerOpen
  const setDrawerOpen = onDataProtectionDrawerOpenChange ?? setProtectionDrawerOpen

  return (
    <div className="space-y-6" data-testid="wizard-step-route-processing">
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-700 dark:text-violet-300">
          <Route className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 space-y-1">
          <h3 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">Route Processing</h3>
          <p className="max-w-3xl text-[13px] leading-relaxed text-slate-600 dark:text-gdc-muted">
            Configure shared processing defaults, then customize each destination route when transform, protection,
            classification, or policy must differ per destination.
          </p>
        </div>
      </header>

      <WizardSharedProcessingSection
        state={state}
        editing={globalEditing}
        onEditToggle={() => setGlobalEditing((v) => !v)}
      >
        <div className="space-y-4" data-testid="route-processing-shared-transform">
          <div>
            <h5 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Shared Transform</h5>
            <p className="mt-0.5 text-[11px] text-slate-600 dark:text-gdc-muted">
              Union schema mapping and transform rules — inherited by all routes unless overridden.
            </p>
          </div>
          <StepMappingCombined
            state={state}
            onChangeMapping={onChangeMapping}
            onChangeMappingMode={onChangeMappingMode}
            onChangeFullEventJsonata={onChangeFullEventJsonata}
            onChangeFullEventRegexConfigJson={onChangeFullEventRegexConfigJson}
            onChangeEnrichment={onChangeEnrichment}
            onChangeUnmappedFieldsPolicy={onChangeUnmappedFieldsPolicy}
            onChangeDataProtection={onChangeDataProtection}
            dataProtectionDrawerOpen={drawerOpen}
            onDataProtectionDrawerOpenChange={setDrawerOpen}
          />
        </div>
      </WizardSharedProcessingSection>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]" data-testid="route-processing-split-layout">
        <WizardRouteProcessingList
          routeDrafts={routeDrafts}
          destinations={destinations}
          dataProtection={state.dataProtection}
          selectedKey={selectedRouteKey}
          onSelect={setSelectedRouteKey}
        />

        {selectedDraft ? (
          <WizardRouteProcessingDetailPanel
            state={state}
            draft={selectedDraft}
            destination={destById.get(selectedDraft.destinationId)}
            onChangeMapping={onChangeMapping}
            onChangeMappingMode={onChangeMappingMode}
            onChangeFullEventJsonata={onChangeFullEventJsonata}
            onChangeFullEventRegexConfigJson={onChangeFullEventRegexConfigJson}
            onChangeEnrichment={onChangeEnrichment}
            onChangeUnmappedFieldsPolicy={onChangeUnmappedFieldsPolicy}
            onChangeDataProtection={onChangeDataProtection}
            onChangeDestinations={onChangeDestinations}
            dataProtectionDrawerOpen={drawerOpen}
            onDataProtectionDrawerOpenChange={setDrawerOpen}
          />
        ) : (
          <section
            className="flex min-h-[12rem] items-center justify-center rounded-lg border border-dashed border-slate-200/90 p-6 text-center dark:border-gdc-border"
            data-testid="route-processing-detail-empty"
          >
            <p className="text-[12px] text-slate-500 dark:text-gdc-muted">{ROUTE_PROCESSING_COPY.selectRouteConfigure}</p>
          </section>
        )}
      </div>

      <WizardDataProtectionDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        state={state}
        onChange={onChangeDataProtection}
      />
    </div>
  )
}
