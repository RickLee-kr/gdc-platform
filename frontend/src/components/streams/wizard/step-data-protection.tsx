import { Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { cn } from '../../../lib/utils'
import {
  collectWizardDetectedFieldCandidates,
  inferWizardSensitivityClass,
  sensitivityClassLabel,
  suggestLikelySensitiveFields,
} from './wizard-data-protection-fields'
import { buildDataProtectionPersistPreview } from './wizard-data-protection-persist'
import {
  newWizardDataProtectionIntentKey,
  type WizardDataProtectionIntent,
  type WizardDataProtectionState,
  type WizardDeliveryBehavior,
  type WizardProtectionAction,
  type WizardState,
} from './wizard-state'

export type StepDataProtectionProps = {
  state: WizardState
  onChange: (patch: Partial<WizardDataProtectionState>) => void
}

const PROTECTION_ACTIONS: ReadonlyArray<{ value: WizardProtectionAction; label: string }> = [
  { value: 'audit', label: 'Audit only' },
  { value: 'mask_partial', label: 'Mask (partial)' },
  { value: 'mask_full', label: 'Mask (full)' },
  { value: 'tokenize', label: 'Tokenize' },
  { value: 'hash', label: 'Hash' },
]

const DELIVERY_BEHAVIORS: ReadonlyArray<{ value: WizardDeliveryBehavior; label: string }> = [
  { value: 'continue', label: 'Continue delivery' },
  { value: 'quarantine', label: 'Quarantine' },
  { value: 'block', label: 'Block delivery' },
]

function defaultIntent(): WizardDataProtectionIntent {
  return {
    key: newWizardDataProtectionIntentKey(),
    detectedField: '',
    protectionAction: 'mask_partial',
    deliveryBehavior: 'continue',
  }
}

export function StepDataProtection({ state, onChange }: StepDataProtectionProps) {
  const candidates = useMemo(() => collectWizardDetectedFieldCandidates(state), [state])
  const likelySensitive = useMemo(() => suggestLikelySensitiveFields(candidates), [candidates])
  const preview = useMemo(() => buildDataProtectionPersistPreview(state.dataProtection), [state.dataProtection])

  const updateIntent = (key: string, patch: Partial<WizardDataProtectionIntent>) => {
    onChange({
      intents: state.dataProtection.intents.map((intent) =>
        intent.key === key ? { ...intent, ...patch } : intent,
      ),
    })
  }

  const removeIntent = (key: string) => {
    onChange({
      intents: state.dataProtection.intents.filter((intent) => intent.key !== key),
    })
  }

  const addIntent = (fieldPath?: string) => {
    const next = defaultIntent()
    if (fieldPath) next.detectedField = fieldPath
    onChange({
      intents: [...state.dataProtection.intents, next],
    })
  }

  return (
    <div className="space-y-4" data-testid="wizard-step-data-protection">
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-700 dark:text-violet-300">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 space-y-1">
          <h3 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">Data Protection</h3>
          <p className="max-w-3xl text-[13px] leading-relaxed text-slate-600 dark:text-gdc-muted">
            Define how sensitive fields are detected, protected, and delivered. This step captures your intent only —
            rules are saved when you deploy the stream.
          </p>
        </div>
      </header>

      {candidates.length === 0 ? (
        <section className="rounded-xl border border-amber-200/80 bg-amber-500/[0.06] p-4 dark:border-amber-500/35 dark:bg-amber-500/10">
          <p className="text-[12px] font-semibold text-amber-900 dark:text-amber-100">No sample fields yet</p>
          <p className="mt-1 text-[11px] leading-relaxed text-amber-800/90 dark:text-amber-100/90">
            Complete Sample and Transform first so detected fields appear here. You can still continue without data
            protection rules.
          </p>
        </section>
      ) : null}

      {likelySensitive.length > 0 && state.dataProtection.intents.length === 0 ? (
        <section
          className="rounded-xl border border-violet-200/70 bg-violet-500/[0.05] p-4 dark:border-violet-500/30 dark:bg-violet-500/10"
          data-testid="data-protection-suggestions"
        >
          <p className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Likely sensitive fields</p>
          <p className="mt-1 text-[11px] text-slate-600 dark:text-gdc-muted">
            Based on your sample and transform output. Add protection intent for any field you want governed at delivery.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {likelySensitive.slice(0, 8).map((path) => (
              <button
                key={path}
                type="button"
                onClick={() => addIntent(path)}
                className="rounded-md border border-violet-300/70 bg-white px-2.5 py-1 font-mono text-[11px] font-semibold text-violet-800 hover:bg-violet-50 dark:border-violet-500/40 dark:bg-gdc-card dark:text-violet-200 dark:hover:bg-violet-500/10"
              >
                {path}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Protection intent</p>
            <p className="mt-0.5 text-[11px] text-slate-600 dark:text-gdc-muted">
              Each row: detected field → protection action → delivery behavior.
            </p>
          </div>
          <button
            type="button"
            onClick={() => addIntent()}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200/90 bg-white px-2.5 text-[11px] font-semibold text-violet-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-violet-300"
            data-testid="data-protection-add-row"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add field
          </button>
        </div>

        {state.dataProtection.intents.length === 0 ? (
          <p className="mt-4 text-[12px] text-slate-600 dark:text-gdc-muted">
            No protection rules configured. Delivery will proceed without stream-scoped data protection intent.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {state.dataProtection.intents.map((intent) => {
              const sensitivityClass = intent.detectedField.trim()
                ? inferWizardSensitivityClass(intent.detectedField)
                : null
              return (
                <div
                  key={intent.key}
                  className="grid gap-3 rounded-lg border border-slate-200/90 p-3 dark:border-gdc-border md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
                  data-testid={`data-protection-row-${intent.key}`}
                >
                  <label className="grid gap-1 text-[11px]">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">Detected field</span>
                    <input
                      list="wizard-detected-field-candidates"
                      value={intent.detectedField}
                      onChange={(e) => updateIntent(intent.key, { detectedField: e.target.value })}
                      placeholder="$.user.email"
                      className="h-9 rounded-md border border-slate-200/90 bg-white px-2 font-mono text-[12px] dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100"
                    />
                  </label>
                  <label className="grid gap-1 text-[11px]">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">Protection action</span>
                    <select
                      value={intent.protectionAction}
                      onChange={(e) =>
                        updateIntent(intent.key, {
                          protectionAction: e.target.value as WizardProtectionAction,
                        })
                      }
                      className="h-9 rounded-md border border-slate-200/90 bg-white px-2 text-[12px] dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100"
                    >
                      {PROTECTION_ACTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-[11px]">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">Delivery behavior</span>
                    <select
                      value={intent.deliveryBehavior}
                      onChange={(e) =>
                        updateIntent(intent.key, {
                          deliveryBehavior: e.target.value as WizardDeliveryBehavior,
                        })
                      }
                      className="h-9 rounded-md border border-slate-200/90 bg-white px-2 text-[12px] dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100"
                    >
                      {DELIVERY_BEHAVIORS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex items-end justify-end">
                    <button
                      type="button"
                      onClick={() => removeIntent(intent.key)}
                      className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-200/90 px-2 text-[11px] font-semibold text-red-700 hover:bg-red-50 dark:border-gdc-border dark:text-red-300 dark:hover:bg-red-500/10"
                      aria-label="Remove protection intent"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      Remove
                    </button>
                  </div>
                  {sensitivityClass ? (
                    <p className="text-[10px] text-slate-500 dark:text-gdc-muted md:col-span-4">
                      Category: {sensitivityClassLabel(sensitivityClass)}
                    </p>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}

        <datalist id="wizard-detected-field-candidates">
          {candidates.map((path) => (
            <option key={path} value={path} />
          ))}
        </datalist>
      </section>

      {preview.warnings.length > 0 ? (
        <section
          className={cn(
            'rounded-xl border p-4',
            preview.enforcementIncomplete
              ? 'border-amber-200/80 bg-amber-500/[0.06] dark:border-amber-500/35 dark:bg-amber-500/10'
              : 'border-slate-200/90 bg-slate-50/80 dark:border-gdc-border dark:bg-gdc-section',
          )}
          data-testid="data-protection-deploy-preview"
        >
          <p className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Deploy note</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] text-slate-700 dark:text-gdc-mutedStrong">
            {preview.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
