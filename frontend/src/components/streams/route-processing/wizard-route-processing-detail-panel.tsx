import { ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cn } from '../../../lib/utils'
import type { DestinationListItem } from '../../../api/gdcDestinations'
import { StepDataProtection } from '../wizard/step-data-protection'
import { StepMappingCombined } from '../wizard/step-mapping-combined'
import type { WizardEnrichmentRule } from '../wizard/enrichment-rules-model'
import { RouteClassificationOverridesSection } from '../wizard/route-classification-overrides-section'
import { failurePolicyBehaviorLabel, formatWizardRateLimitDraft } from '../wizard/wizard-delivery-helpers'
import {
  buildRouteProtectionOverrideFromGlobal,
  buildRouteTransformOverrideFromGlobal,
  type WizardDataProtectionState,
  type WizardDestinationsState,
  type WizardMappingRow,
  type WizardRouteDraft,
  type WizardRouteProcessingInherit,
  type WizardState,
} from '../wizard/wizard-state'
import { ROUTE_PROCESSING_COPY } from './route-processing-labels'
import { RouteProcessingInheritToggle } from './route-processing-inherit-toggle'
import { RouteProcessingDetailHeader } from './route-processing-detail-header'
import { summarizeSharedProtection } from './wizard-global-processing-section'

const inputCls =
  'h-8 w-full rounded-md border border-slate-200/90 bg-white px-2 text-[12px] text-slate-900 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100'

type DetailTab = 'transform' | 'protection' | 'classification' | 'policy' | 'delivery'

const TABS: ReadonlyArray<{ key: DetailTab; label: string }> = [
  { key: 'transform', label: 'Transform' },
  { key: 'protection', label: 'Protection' },
  { key: 'classification', label: 'Classification' },
  { key: 'policy', label: 'Policy' },
  { key: 'delivery', label: 'Delivery' },
]

function patchRouteDraft(
  drafts: WizardRouteDraft[],
  key: string,
  patch: Partial<WizardRouteDraft>,
): WizardRouteDraft[] {
  return drafts.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft))
}

function buildRouteScopedState(global: WizardState, draft: WizardRouteDraft): WizardState {
  const override = draft.overrides?.transform
  if (!override) return global
  return {
    ...global,
    mapping: override.mapping,
    mappingMode: override.mappingMode,
    fullEventJsonataExpression: override.fullEventJsonataExpression,
    fullEventRegexConfigJson: override.fullEventRegexConfigJson,
    transformRules: override.transformRules,
    enrichment: override.enrichment,
    unmappedFieldsPolicy: override.unmappedFieldsPolicy,
  }
}

function buildRouteProtectionState(global: WizardState, draft: WizardRouteDraft): WizardState {
  const override = draft.overrides?.protection
  if (!override) return global
  return {
    ...global,
    dataProtection: {
      ...global.dataProtection,
      intents: override.intents,
      unknownNormalFieldPolicy: override.unknownNormalFieldPolicy,
      unknownSensitiveFieldPolicy: override.unknownSensitiveFieldPolicy,
      routeOverrides: global.dataProtection.routeOverrides.filter((o) => o.routeDraftKey === draft.key),
    },
  }
}

export function WizardRouteProcessingDetailPanel({
  state,
  draft,
  destination,
  onChangeDataProtection,
  onChangeDestinations,
}: {
  state: WizardState
  draft: WizardRouteDraft
  destination: DestinationListItem | undefined
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
}) {
  const [tab, setTab] = useState<DetailTab>('transform')
  const routeLabel = destination?.name?.trim() || `Destination #${draft.destinationId}`
  const destinationMissing = !draft.destinationId || draft.destinationId <= 0 || !destination

  const patchRoute = (patch: Partial<WizardRouteDraft>) => {
    onChangeDestinations({
      routeDrafts: patchRouteDraft(state.destinations.routeDrafts, draft.key, patch),
    })
  }

  const patchInherit = (concern: keyof WizardRouteProcessingInherit, inherit: boolean) => {
    const nextInherit = { ...draft.inherit, [concern]: inherit }
    const nextOverrides = { ...draft.overrides }
    if (!inherit) {
      if (concern === 'transform' && !nextOverrides.transform) {
        nextOverrides.transform = buildRouteTransformOverrideFromGlobal(state)
      }
      if (concern === 'protection' && !nextOverrides.protection) {
        nextOverrides.protection = buildRouteProtectionOverrideFromGlobal(state.dataProtection)
      }
      if (concern === 'policy' && !nextOverrides.policy) {
        nextOverrides.policy = { deliveryBehavior: 'continue' }
      }
    }
    patchRoute({ inherit: nextInherit, overrides: nextOverrides })
  }

  const patchRouteTransform = (patch: Partial<WizardState>) => {
    const current = draft.overrides?.transform ?? buildRouteTransformOverrideFromGlobal(state)
    const next = {
      mapping: patch.mapping ?? current.mapping,
      mappingMode: patch.mappingMode ?? current.mappingMode,
      fullEventJsonataExpression: patch.fullEventJsonataExpression ?? current.fullEventJsonataExpression,
      fullEventRegexConfigJson: patch.fullEventRegexConfigJson ?? current.fullEventRegexConfigJson,
      transformRules: patch.transformRules ?? current.transformRules,
      enrichment: patch.enrichment ?? current.enrichment,
      unmappedFieldsPolicy: patch.unmappedFieldsPolicy ?? current.unmappedFieldsPolicy,
    }
    patchRoute({ overrides: { ...draft.overrides, transform: next } })
  }

  const patchRouteProtection = (patch: Partial<WizardDataProtectionState>) => {
    const current = draft.overrides?.protection ?? buildRouteProtectionOverrideFromGlobal(state.dataProtection)
    patchRoute({
      overrides: {
        ...draft.overrides,
        protection: {
          intents: patch.intents ?? current.intents,
          unknownNormalFieldPolicy: patch.unknownNormalFieldPolicy ?? current.unknownNormalFieldPolicy,
          unknownSensitiveFieldPolicy: patch.unknownSensitiveFieldPolicy ?? current.unknownSensitiveFieldPolicy,
        },
      },
    })
  }

  const routeTransformState = useMemo(() => buildRouteScopedState(state, draft), [draft, state])
  const routeProtectionState = useMemo(() => buildRouteProtectionState(state, draft), [draft, state])

  const epsVal = typeof draft.rateLimitJson.per_second === 'number' ? String(draft.rateLimitJson.per_second) : ''
  const burstVal = typeof draft.rateLimitJson.burst_size === 'number' ? String(draft.rateLimitJson.burst_size) : ''

  return (
    <section
      className="rounded-lg border border-slate-200/90 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card"
      data-testid="route-processing-detail-panel"
    >
      <RouteProcessingDetailHeader
        routeLabel={routeLabel}
        destinationLabel={destination?.name}
        destinationMissing={destinationMissing}
      />

      <div className="flex flex-wrap gap-1 border-b border-slate-100 px-2 pt-2 dark:border-gdc-border" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            onClick={() => setTab(item.key)}
            className={cn(
              '-mb-px border-b-2 px-2.5 pb-2 text-[11px] font-semibold',
              tab === item.key
                ? 'border-violet-600 text-violet-700 dark:border-violet-400 dark:text-violet-300'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-gdc-muted',
            )}
            data-testid={`route-detail-tab-${item.key}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="space-y-3 p-3">
        {tab === 'transform' ? (
          <div className="space-y-3" data-testid="route-detail-transform">
            <RouteProcessingInheritToggle
              checked={draft.inherit.transform}
              onChange={(checked) => patchInherit('transform', checked)}
              concernLabel="Transform"
              data-testid="route-inherit-transform"
            />
            {draft.inherit.transform ? (
              <p className="text-[11px] text-slate-600 dark:text-gdc-muted">
                {ROUTE_PROCESSING_COPY.allInherited} Uncheck Inherit Shared to customize mapping for this route only.
              </p>
            ) : (
              <StepMappingCombined
                state={routeTransformState}
                onChangeMapping={(rows) => patchRouteTransform({ mapping: rows })}
                onChangeMappingMode={(mode) => patchRouteTransform({ mappingMode: mode })}
                onChangeFullEventJsonata={(expr) => patchRouteTransform({ fullEventJsonataExpression: expr })}
                onChangeFullEventRegexConfigJson={(json) => patchRouteTransform({ fullEventRegexConfigJson: json })}
                onChangeEnrichment={(rules) => patchRouteTransform({ enrichment: rules })}
                onChangeUnmappedFieldsPolicy={(policy) => patchRouteTransform({ unmappedFieldsPolicy: policy })}
                onChangeDataProtection={() => {}}
              />
            )}
          </div>
        ) : null}

        {tab === 'protection' ? (
          <div className="space-y-3" data-testid="route-detail-protection">
            <RouteProcessingInheritToggle
              checked={draft.inherit.protection}
              onChange={(checked) => patchInherit('protection', checked)}
              concernLabel="Protection"
              data-testid="route-inherit-protection"
            />
            {draft.inherit.protection ? (
              <p className="text-[11px] text-slate-600 dark:text-gdc-muted">
                Using shared protection: {summarizeSharedProtection(state.dataProtection)}. Field-level route overrides
                can still be configured in shared Data Protection.
              </p>
            ) : (
              <StepDataProtection
                state={routeProtectionState}
                onChange={(patch) => patchRouteProtection(patch)}
              />
            )}
          </div>
        ) : null}

        {tab === 'classification' ? (
          <div className="space-y-3" data-testid="route-detail-classification">
            <RouteProcessingInheritToggle
              checked={draft.inherit.classification}
              onChange={(checked) => patchInherit('classification', checked)}
              concernLabel="Classification"
              data-testid="route-inherit-classification"
            />
            {draft.inherit.classification ? (
              <p className="text-[11px] text-slate-600 dark:text-gdc-muted">
                Using shared classification defaults. Add a per-route floor override below if needed.
              </p>
            ) : (
              <p className="text-[11px] text-amber-800 dark:text-amber-200">
                Route classification override active — configure floor level for this route.
              </p>
            )}
            <RouteClassificationOverridesSection
              state={state.dataProtection}
              routeDrafts={[draft]}
              onChange={onChangeDataProtection}
            />
          </div>
        ) : null}

        {tab === 'policy' ? (
          <div className="space-y-3" data-testid="route-detail-policy">
            <RouteProcessingInheritToggle
              checked={draft.inherit.policy}
              onChange={(checked) => patchInherit('policy', checked)}
              concernLabel="Policy"
              data-testid="route-inherit-policy"
            />
            {draft.inherit.policy ? (
              <p className="text-[11px] text-slate-600 dark:text-gdc-muted">
                Using shared delivery behavior policies. Uncheck to set route-specific delivery behavior.
              </p>
            ) : (
              <label className="grid gap-1 text-[11px]">
                <span className="font-semibold text-slate-700 dark:text-slate-200">Delivery behavior</span>
                <div className="relative max-w-xs">
                  <select
                    value={draft.overrides?.policy?.deliveryBehavior ?? 'continue'}
                    onChange={(e) =>
                      patchRoute({
                        overrides: {
                          ...draft.overrides,
                          policy: {
                            deliveryBehavior: e.target.value as WizardState['dataProtection']['intents'][0]['deliveryBehavior'],
                          },
                        },
                      })
                    }
                    className={cn(inputCls, 'appearance-none pr-8')}
                    data-testid="route-policy-delivery-behavior"
                  >
                    <option value="continue">Continue</option>
                    <option value="quarantine">Quarantine</option>
                    <option value="block">Block</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
                </div>
                <span className="text-[10px] text-slate-500 dark:text-gdc-muted">
                  Block stops the entire event from delivery. Drop (in protection) removes fields only.
                </span>
              </label>
            )}
          </div>
        ) : null}

        {tab === 'delivery' ? (
          <div className="space-y-3" data-testid="route-detail-delivery">
            <p className="text-[11px] text-slate-600 dark:text-gdc-muted">
              Delivery settings are always route-specific — no shared inheritance.
            </p>
            <label className="flex items-center gap-2 text-[12px] font-medium text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => patchRoute({ enabled: e.target.checked })}
                className="accent-violet-600"
                data-testid={`route-processing-enabled-${draft.key}`}
              />
              Enabled
            </label>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Failure policy</label>
              <div className="relative max-w-md">
                <select
                  value={draft.failurePolicy}
                  onChange={(e) => patchRoute({ failurePolicy: e.target.value as WizardRouteDraft['failurePolicy'] })}
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
                      patchRoute({ rateLimitJson: next })
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
                      patchRoute({ rateLimitJson: next })
                    }}
                    data-testid={`route-processing-burst-${draft.key}`}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
