import { CheckCircle2, ExternalLink, Layers, Scale, ShieldCheck, Wand2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { NAV_PATH } from '../../../config/nav-paths'

type StreamSharedCard = {
  key: string
  title: string
  description: string
  href: string
  icon: typeof Wand2
}

const STREAM_SHARED_CARDS: StreamSharedCard[] = [
  {
    key: 'transform',
    title: 'Transform',
    description: 'Mapping, transform rules, field operations.',
    href: NAV_PATH.streams,
    icon: Wand2,
  },
  {
    key: 'protection',
    title: 'Data Protection',
    description: 'Schema drift policy, protection rules.',
    href: NAV_PATH.streams,
    icon: ShieldCheck,
  },
  {
    key: 'classification',
    title: 'Classification',
    description: 'Field classification, override level.',
    href: NAV_PATH.streams,
    icon: Layers,
  },
  {
    key: 'policy',
    title: 'Policy',
    description: 'Route policies, delivery behavior.',
    href: NAV_PATH.streams,
    icon: Scale,
  },
]

/** @deprecated Use StreamSharedProcessingSection */
export const StreamGlobalProcessingSection = StreamSharedProcessingSection

export function StreamSharedProcessingSection({ streamId }: { streamId: number }) {
  return (
    <section className="space-y-3" data-testid="stream-shared-processing-section">
      <div>
        <h4 className="text-[13px] font-semibold text-slate-900 dark:text-slate-50">
          Shared Processing
          <span className="ml-1.5 font-normal text-slate-500 dark:text-gdc-muted">(Inherited by all routes)</span>
        </h4>
        <p className="mt-0.5 text-[11px] text-slate-600 dark:text-gdc-muted">
          Shared Processing is the default processing inherited by all routes.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {STREAM_SHARED_CARDS.map((card) => {
          const Icon = card.icon
          return (
            <article
              key={card.key}
              className="rounded-lg border border-slate-200/90 bg-white p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card"
              data-testid={`stream-shared-processing-card-${card.key}`}
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
              <p className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-3 w-3" aria-hidden />
                Configured
              </p>
              <Link
                to={`${NAV_PATH.streams}/${streamId}#governance`}
                className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
              >
                Edit in Governance
                <ExternalLink className="h-3 w-3" aria-hidden />
              </Link>
            </article>
          )
        })}
      </div>

      <p className="rounded-md border border-violet-200/70 bg-violet-500/[0.06] px-3 py-2 text-[11px] text-violet-900 dark:border-violet-500/30 dark:text-violet-100">
        Each route is a destination-specific processing unit. Routes inherit Shared Processing unless overridden below.
      </p>
    </section>
  )
}
