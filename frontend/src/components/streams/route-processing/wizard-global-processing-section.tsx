import { CheckCircle2, Layers, Scale, ShieldCheck, Wand2 } from 'lucide-react'
import { cn } from '../../../lib/utils'
import type { WizardDataProtectionState, WizardState } from '../wizard/wizard-state'
import { globalProtectionConfigured, globalTransformConfigured } from '../wizard/wizard-state'

type SharedCard = {
  key: 'transform' | 'protection' | 'classification' | 'policy'
  title: string
  description: string
  configured: boolean
  icon: typeof Wand2
}

function buildSharedCards(
  state: Pick<WizardState, 'mapping' | 'transformRules' | 'mappingMode' | 'fullEventJsonataExpression' | 'fullEventRegexConfigJson' | 'dataProtection'>,
): SharedCard[] {
  const transformOk = globalTransformConfigured(state)
  const protectionOk = globalProtectionConfigured(state.dataProtection)
  return [
    {
      key: 'transform',
      title: 'Transform',
      description: 'Mapping, transform rules, field operations.',
      configured: transformOk,
      icon: Wand2,
    },
    {
      key: 'protection',
      title: 'Data Protection',
      description: 'Schema drift policy, protection rules.',
      configured: protectionOk,
      icon: ShieldCheck,
    },
    {
      key: 'classification',
      title: 'Classification',
      description: 'Field classification, override level.',
      configured: true,
      icon: Layers,
    },
    {
      key: 'policy',
      title: 'Policy',
      description: 'Route policies, delivery behavior.',
      configured: true,
      icon: Scale,
    },
  ]
}

/** @deprecated Use WizardSharedProcessingSection */
export const WizardGlobalProcessingSection = WizardSharedProcessingSection

export function WizardSharedProcessingSection({
  state,
  editing,
  onEditToggle,
  children,
}: {
  state: Pick<
    WizardState,
    | 'mapping'
    | 'transformRules'
    | 'mappingMode'
    | 'fullEventJsonataExpression'
    | 'fullEventRegexConfigJson'
    | 'dataProtection'
  >
  editing: boolean
  onEditToggle: () => void
  children?: React.ReactNode
}) {
  const cards = buildSharedCards(state)

  return (
    <section className="space-y-3" data-testid="shared-processing-section">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-[13px] font-semibold text-slate-900 dark:text-slate-50">
            Shared Processing
            <span className="ml-1.5 font-normal text-slate-500 dark:text-gdc-muted">(Inherited by all routes)</span>
          </h4>
          <p className="mt-0.5 text-[11px] text-slate-600 dark:text-gdc-muted">
            Shared Processing is the default processing inherited by all routes.
          </p>
        </div>
        <button
          type="button"
          onClick={onEditToggle}
          className="inline-flex h-8 items-center rounded-md border border-violet-300/70 bg-violet-500/[0.07] px-3 text-[12px] font-semibold text-violet-800 hover:bg-violet-500/15 dark:border-violet-500/40 dark:text-violet-200"
          data-testid="shared-processing-edit-toggle"
        >
          {editing ? 'Close Shared Settings' : 'Edit Shared Settings'}
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon
          return (
            <article
              key={card.key}
              className="rounded-lg border border-slate-200/90 bg-white p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card"
              data-testid={`shared-processing-card-${card.key}`}
            >
              <div className="flex items-start gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-violet-500/10 text-violet-700 dark:text-violet-300">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">{card.title}</p>
                  <p className="mt-0.5 text-[10px] leading-snug text-slate-500 dark:text-gdc-muted">{card.description}</p>
                </div>
              </div>
              <p
                className={cn(
                  'mt-2 inline-flex items-center gap-1 text-[10px] font-semibold',
                  card.configured ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-gdc-muted',
                )}
              >
                {card.configured ? (
                  <>
                    <CheckCircle2 className="h-3 w-3" aria-hidden />
                    Configured
                  </>
                ) : (
                  'Not configured'
                )}
              </p>
            </article>
          )
        })}
      </div>

      <p className="rounded-md border border-violet-200/70 bg-violet-500/[0.06] px-3 py-2 text-[11px] text-violet-900 dark:border-violet-500/30 dark:text-violet-100">
        Each route is a destination-specific processing unit. Routes inherit Shared Processing unless overridden.
      </p>

      {editing ? (
        <div className="space-y-4 rounded-lg border border-slate-200/90 bg-slate-50/50 p-3 dark:border-gdc-border dark:bg-gdc-section/40" data-testid="shared-processing-editor">
          {children}
        </div>
      ) : null}
    </section>
  )
}

export function summarizeSharedProtection(dataProtection: WizardDataProtectionState): string {
  const intentCount = dataProtection.intents.filter((i) => i.detectedField.trim()).length
  if (intentCount > 0) return `${intentCount} protection rule${intentCount === 1 ? '' : 's'}`
  return 'Default schema drift policy'
}

/** @deprecated Use summarizeSharedProtection */
export const summarizeGlobalProtection = summarizeSharedProtection
