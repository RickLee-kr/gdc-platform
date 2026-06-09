import { Link } from 'react-router-dom'
import { NAV_PATH } from '../../config/nav-paths'

type AiGatewayEmptyStateProps = {
  title: string
  description: string
  primaryLabel: string
  primaryTo: string
  secondaryLabel?: string
  secondaryTo?: string
  testId: string
}

export function AiGatewayEmptyState({
  title,
  description,
  primaryLabel,
  primaryTo,
  secondaryLabel,
  secondaryTo,
  testId,
}: AiGatewayEmptyStateProps) {
  return (
    <section
      data-testid={testId}
      className="rounded-xl border border-violet-200/80 bg-violet-50/40 px-4 py-6 dark:border-violet-500/30 dark:bg-violet-500/10"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
      <p className="mt-1 max-w-xl text-sm text-slate-600 dark:text-gdc-muted">{description}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          to={primaryTo}
          className="inline-flex items-center rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700"
        >
          {primaryLabel}
        </Link>
        {secondaryLabel && secondaryTo ? (
          <Link
            to={secondaryTo}
            className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
          >
            {secondaryLabel}
          </Link>
        ) : null}
      </div>
    </section>
  )
}

export function aiStreamsEmptyState() {
  return {
    title: 'No AI streams yet',
    description: 'Create a stream with an AI proxy source and link it to an AI provider to start routing traffic.',
    primaryLabel: 'Create stream',
    primaryTo: NAV_PATH.streams,
    secondaryLabel: 'Configure providers',
    secondaryTo: NAV_PATH.aiGatewayProviders,
  }
}

export function aiProvidersEmptyState() {
  return {
    title: 'No AI providers yet',
    description: 'Register an OpenAI, Claude, Gemini, or compatible provider endpoint before creating AI streams.',
    primaryLabel: 'Go to Streams setup',
    primaryTo: NAV_PATH.streams,
  }
}

export function aiTrafficEmptyState() {
  return {
    title: 'No AI traffic recorded yet',
    description: 'After AI streams are enabled and receiving requests, traffic metrics appear here.',
    primaryLabel: 'View AI streams',
    primaryTo: NAV_PATH.aiGatewayStreams,
    secondaryLabel: 'Configure providers',
    secondaryTo: NAV_PATH.aiGatewayProviders,
  }
}
