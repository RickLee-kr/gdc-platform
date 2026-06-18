import { Plus, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import {
  isDuplicateRouteClassificationOverride,
} from './wizard-governance-persist'
import {
  newWizardRouteClassificationOverrideKey,
  normalizeWizardClassificationLevel,
  type WizardClassificationLevel,
  type WizardDataProtectionState,
  type WizardRouteClassificationOverride,
  type WizardRouteDraft,
} from './wizard-state'

const CLASSIFICATION_LEVELS: ReadonlyArray<{ value: WizardClassificationLevel; label: string }> = [
  { value: 'PUBLIC', label: 'PUBLIC' },
  { value: 'INTERNAL', label: 'INTERNAL' },
  { value: 'CONFIDENTIAL', label: 'CONFIDENTIAL' },
  { value: 'RESTRICTED', label: 'RESTRICTED' },
]

function defaultClassificationOverride(): WizardRouteClassificationOverride {
  return {
    key: newWizardRouteClassificationOverrideKey(),
    routeDraftKey: '',
    classificationLevel: 'INTERNAL',
    enabled: true,
  }
}

export function RouteClassificationOverridesSection({
  state,
  routeDrafts,
  onChange,
}: {
  state: Pick<WizardDataProtectionState, 'routeClassificationOverrides'>
  routeDrafts: readonly WizardRouteDraft[]
  onChange: (patch: Partial<WizardDataProtectionState>) => void
}) {
  const overrides = state.routeClassificationOverrides

  const routeLabels = useMemo(() => {
    const labels = new Map<string, string>()
    routeDrafts.forEach((draft, index) => {
      labels.set(draft.key, `Route ${index + 1} (dest #${draft.destinationId})`)
    })
    return labels
  }, [routeDrafts])

  const updateOverrides = (next: WizardRouteClassificationOverride[]) => {
    onChange({ routeClassificationOverrides: next })
  }

  const updateOverride = (key: string, patch: Partial<WizardRouteClassificationOverride>) => {
    updateOverrides(overrides.map((o) => (o.key === key ? { ...o, ...patch } : o)))
  }

  const removeOverride = (key: string) => {
    onChange({
      routeClassificationOverrides: overrides.filter((o) => o.key !== key),
    })
  }

  const addOverride = () => {
    const availableDraft = routeDrafts.find(
      (draft) => !isDuplicateRouteClassificationOverride(overrides, draft.key),
    )
    const next = defaultClassificationOverride()
    if (availableDraft) next.routeDraftKey = availableDraft.key
    onChange({ routeClassificationOverrides: [...overrides, next] })
  }

  return (
    <div
      className="space-y-2 rounded-lg border border-slate-200/90 bg-slate-50/60 p-3 dark:border-gdc-border dark:bg-gdc-section/60"
      data-testid="route-classification-overrides-section"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">
            Per-Route Classification Level
          </p>
          <p className="text-[10px] text-slate-500 dark:text-gdc-muted">
            Optional floor per route — never downgrades stream classification (max level).
          </p>
        </div>
        <button
          type="button"
          onClick={addOverride}
          disabled={routeDrafts.length === 0}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200/90 bg-white px-2 text-[10px] font-semibold text-violet-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gdc-border dark:bg-gdc-card dark:text-violet-300"
          data-testid="route-classification-override-add"
        >
          <Plus className="h-3 w-3" aria-hidden />
          Add Override
        </button>
      </div>

      {routeDrafts.length === 0 ? (
        <p className="text-[10px] text-amber-700 dark:text-amber-200">
          Add destinations in the Destinations step before configuring per-route classification.
        </p>
      ) : null}

      {overrides.length === 0 ? (
        <p className="text-[10px] text-slate-500 dark:text-gdc-muted">
          All routes inherit stream classification defaults.
        </p>
      ) : (
        <div className="space-y-2">
          {overrides.map((override) => {
            const duplicate =
              override.routeDraftKey &&
              isDuplicateRouteClassificationOverride(
                overrides,
                override.routeDraftKey,
                override.key,
              )
            return (
              <div
                key={override.key}
                className="grid gap-2 rounded-md border border-slate-200/80 bg-white p-2 dark:border-gdc-border dark:bg-gdc-card sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                data-testid={`route-classification-override-row-${override.key}`}
              >
                <label className="grid gap-0.5 text-[10px]">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Route</span>
                  <select
                    value={override.routeDraftKey}
                    onChange={(e) => updateOverride(override.key, { routeDraftKey: e.target.value })}
                    className="h-8 rounded-md border border-slate-200/90 bg-white px-2 text-[11px] dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100"
                  >
                    <option value="">Select route…</option>
                    {routeDrafts.map((draft) => (
                      <option key={draft.key} value={draft.key}>
                        {routeLabels.get(draft.key) ?? draft.key}
                      </option>
                    ))}
                  </select>
                  {duplicate ? (
                    <span className="text-[10px] text-red-600 dark:text-red-300">
                      Duplicate classification override for this route.
                    </span>
                  ) : null}
                </label>
                <label className="grid gap-0.5 text-[10px]">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Classification floor</span>
                  <select
                    value={override.classificationLevel}
                    onChange={(e) =>
                      updateOverride(override.key, {
                        classificationLevel: normalizeWizardClassificationLevel(e.target.value),
                      })
                    }
                    className="h-8 rounded-md border border-slate-200/90 bg-white px-2 text-[11px] dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100"
                  >
                    {CLASSIFICATION_LEVELS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-end justify-end">
                  <button
                    type="button"
                    onClick={() => removeOverride(override.key)}
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200/90 px-2 text-[10px] font-semibold text-red-700 hover:bg-red-50 dark:border-gdc-border dark:text-red-300 dark:hover:bg-red-950/30"
                    data-testid={`route-classification-override-remove-${override.key}`}
                  >
                    <Trash2 className="h-3 w-3" aria-hidden />
                    Remove
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
