import { ChevronDown, Route } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { fetchDestinationsList, type DestinationListItem } from '../../../api/gdcDestinations'
import { cn } from '../../../lib/utils'
import { failurePolicyBehaviorLabel, formatWizardRateLimitDraft } from './wizard-delivery-helpers'
import {
  countRouteProtectionOverridesForDraft,
  routeDraftHasProtectionOverrides,
} from './wizard-route-protection-overrides-summary'
import { StepMappingCombined } from './step-mapping-combined'
import type { WizardEnrichmentRule } from './enrichment-rules-model'
import type {
  WizardDataProtectionState,
  WizardDestinationsState,
  WizardMappingRow,
  WizardRouteDraft,
  WizardState,
} from './wizard-state'

const inputCls =
  'h-8 w-full rounded-md border border-slate-200/90 bg-white px-2 text-[12px] text-slate-900 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100'

export type StepRouteProcessingProps = {
  state: WizardState
  onChangeMapping: (rows: WizardMappingRow[]) => void
  onChangeMappingMode: (mode: WizardState['mappingMode']) => void
  onChangeFullEventJsonata: (expression: string) => void
  onChangeFullEventRegexConfigJson: (json: string) => void
  onChangeEnrichment: (rules: WizardEnrichmentRule[]) => void
  onChangeDataProtection: (patch: Partial<WizardDataProtectionState>) => void
  onChangeDestinations: (patch: Partial<WizardDestinationsState>) => void
  dataProtectionDrawerOpen?: boolean
  onDataProtectionDrawerOpenChange?: (open: boolean) => void
}

function patchRouteDraft(
  drafts: WizardRouteDraft[],
  key: string,
  patch: Partial<WizardRouteDraft>,
): WizardRouteDraft[] {
  return drafts.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft))
}

function RouteProcessingCard({
  draft,
  destination,
  overrideCount,
  hasCustomProtection,
  onPatch,
}: {
  draft: WizardRouteDraft
  destination: DestinationListItem | undefined
  overrideCount: number
  hasCustomProtection: boolean
  onPatch: (patch: Partial<WizardRouteDraft>) => void
}) {
  const destLabel = destination?.name?.trim() || `Destination #${draft.destinationId}`
  const epsVal = typeof draft.rateLimitJson.per_second === 'number' ? String(draft.rateLimitJson.per_second) : ''
  const burstVal = typeof draft.rateLimitJson.burst_size === 'number' ? String(draft.rateLimitJson.burst_size) : ''

  return (
    <article
      className="rounded-lg border border-slate-200/90 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card"
      data-testid={`route-processing-card-${draft.key}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5 dark:border-gdc-border">
        <div className="min-w-0">
          <h4 className="truncate text-[13px] font-semibold text-slate-900 dark:text-slate-50">{destLabel}</h4>
          <p className="text-[10px] text-slate-500 dark:text-gdc-muted">Shared stream transform · no per-route override</p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-[12px] font-medium text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => onPatch({ enabled: e.target.checked })}
            className="accent-violet-600"
            data-testid={`route-processing-enabled-${draft.key}`}
          />
          Enabled
        </label>
      </div>

      <div className="grid gap-3 px-3 py-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Failure policy</label>
          <div className="relative">
            <select
              value={draft.failurePolicy}
              onChange={(e) => onPatch({ failurePolicy: e.target.value as WizardRouteDraft['failurePolicy'] })}
              className={cn(inputCls, 'appearance-none pr-8')}
              data-testid={`route-processing-failure-policy-${draft.key}`}
            >
              <option value="LOG_AND_CONTINUE">LOG_AND_CONTINUE</option>
              <option value="RETRY_AND_BACKOFF">RETRY_AND_BACKOFF</option>
              <option value="PAUSE_STREAM_ON_FAILURE">PAUSE_STREAM_ON_FAILURE</option>
              <option value="DISABLE_ROUTE_ON_FAILURE">DISABLE_ROUTE_ON_FAILURE</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
          </div>
          <p className="text-[10px] text-slate-500">{failurePolicyBehaviorLabel(draft.failurePolicy)}</p>
        </div>

        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Rate limit</p>
          <p className="text-[11px] text-slate-600 dark:text-gdc-muted">{formatWizardRateLimitDraft(draft.rateLimitJson)}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-slate-500">EPS (optional)</label>
              <input
                type="number"
                min={0}
                className={inputCls}
                placeholder="Destination default"
                value={epsVal}
                onChange={(e) => {
                  const v = e.target.value
                  const next = { ...draft.rateLimitJson }
                  if (v === '') delete next.per_second
                  else next.per_second = Number(v)
                  onPatch({ rateLimitJson: next })
                }}
                data-testid={`route-processing-eps-${draft.key}`}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-slate-500">Burst (optional)</label>
              <input
                type="number"
                min={0}
                className={inputCls}
                placeholder="Destination default"
                value={burstVal}
                onChange={(e) => {
                  const v = e.target.value
                  const next = { ...draft.rateLimitJson }
                  if (v === '') delete next.burst_size
                  else next.burst_size = Number(v)
                  onPatch({ rateLimitJson: next })
                }}
                data-testid={`route-processing-burst-${draft.key}`}
              />
            </div>
          </div>
        </div>
      </div>
      {hasCustomProtection ? (
        <footer
          className="border-t border-slate-100 px-3 py-2 text-[10px] text-violet-800 dark:border-gdc-border dark:text-violet-200"
          data-testid={`route-processing-protection-footer-${draft.key}`}
        >
          {overrideCount > 0
            ? `Protection Overrides: ${overrideCount}`
            : 'Uses custom protection'}
        </footer>
      ) : null}
    </article>
  )
}

export function StepRouteProcessing({
  state,
  onChangeMapping,
  onChangeMappingMode,
  onChangeFullEventJsonata,
  onChangeFullEventRegexConfigJson,
  onChangeEnrichment,
  onChangeDataProtection,
  onChangeDestinations,
  dataProtectionDrawerOpen,
  onDataProtectionDrawerOpenChange,
}: StepRouteProcessingProps) {
  const [destinations, setDestinations] = useState<DestinationListItem[]>([])

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

  const patchRoute = (key: string, patch: Partial<WizardRouteDraft>) => {
    onChangeDestinations({
      routeDrafts: patchRouteDraft(routeDrafts, key, patch),
    })
  }

  return (
    <div className="space-y-6" data-testid="wizard-step-route-processing">
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-700 dark:text-violet-300">
          <Route className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 space-y-1">
          <h3 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">Route Processing</h3>
          <p className="max-w-3xl text-[13px] leading-relaxed text-slate-600 dark:text-gdc-muted">
            Configure shared stream transform and data protection, then review each route&apos;s delivery settings.
            Per-route transform and protection overrides are not available in this release.
          </p>
        </div>
      </header>

      <section className="space-y-3" data-testid="route-processing-shared-transform">
        <div>
          <h4 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Shared Transform</h4>
          <p className="mt-0.5 text-[11px] text-slate-600 dark:text-gdc-muted">
            Mapping and transform rules apply to every route on this stream.
          </p>
        </div>
        <StepMappingCombined
          state={state}
          onChangeMapping={onChangeMapping}
          onChangeMappingMode={onChangeMappingMode}
          onChangeFullEventJsonata={onChangeFullEventJsonata}
          onChangeFullEventRegexConfigJson={onChangeFullEventRegexConfigJson}
          onChangeEnrichment={onChangeEnrichment}
          onChangeDataProtection={onChangeDataProtection}
          dataProtectionDrawerOpen={dataProtectionDrawerOpen}
          onDataProtectionDrawerOpenChange={onDataProtectionDrawerOpenChange}
        />
      </section>

      <section className="space-y-3" data-testid="route-processing-routes">
        <div>
          <h4 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Routes</h4>
          <p className="mt-0.5 text-[11px] text-slate-600 dark:text-gdc-muted">
            Review delivery settings for each destination route. Transform and protection use stream defaults.
          </p>
        </div>

        {routeDrafts.length === 0 ? (
          <p className="rounded-md border border-amber-200/80 bg-amber-500/[0.06] px-3 py-2 text-[12px] text-amber-900 dark:border-amber-500/35 dark:text-amber-100">
            No routes configured. Go back to Destinations to add delivery paths.
          </p>
        ) : (
          <div className="space-y-3">
            {routeDrafts.map((draft) => (
              <RouteProcessingCard
                key={draft.key}
                draft={draft}
                destination={destById.get(draft.destinationId)}
                overrideCount={countRouteProtectionOverridesForDraft(state.dataProtection, draft.key)}
                hasCustomProtection={routeDraftHasProtectionOverrides(state.dataProtection, draft.key)}
                onPatch={(patch) => patchRoute(draft.key, patch)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
