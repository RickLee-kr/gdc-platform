import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { GovernanceOperationsSummaryResponse } from '../../api/gdcGovernanceOperations'
import type { KpiCard } from '../../api/dashboardKpi'
import { NAV_PATH, logsExplorerPath } from '../../config/nav-paths'
import { OP_LABEL } from '../../lib/operator-vocabulary'
import {
  derivePlatformPosture,
  incidentHeadline,
  type OpsIncident,
  type PlatformPosture,
} from '../../lib/operations-incidents'
import { cn } from '../../lib/utils'

function postureStyles(posture: PlatformPosture): string {
  switch (posture) {
    case 'critical':
      return 'border-red-300/70 bg-red-500/[0.08] text-red-950 dark:border-red-500/35 dark:bg-red-500/10 dark:text-red-100'
    case 'degraded':
      return 'border-amber-300/70 bg-amber-500/[0.08] text-amber-950 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-100'
    default:
      return 'border-emerald-300/70 bg-emerald-500/[0.08] text-emerald-950 dark:border-emerald-500/35 dark:bg-emerald-500/10 dark:text-emerald-100'
  }
}

function chipTone(severity: OpsIncident['severity']): string {
  switch (severity) {
    case 'critical':
      return 'border-red-300/80 bg-red-50 text-red-900 dark:border-red-500/35 dark:bg-red-500/10 dark:text-red-100'
    case 'high':
      return 'border-amber-300/80 bg-amber-50 text-amber-950 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-100'
    default:
      return 'border-slate-200/80 bg-slate-50 text-slate-800 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-200'
  }
}

const tierCardClass =
  'rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 shadow-sm dark:border-gdc-border dark:bg-gdc-card'

export function OperationsOverallStatus({
  incidents,
  runningStreams,
  windowLabel,
  loading,
}: {
  incidents: OpsIncident[]
  runningStreams: number
  windowLabel: string
  loading: boolean
}) {
  const posture = derivePlatformPosture(incidents)
  const headline = incidentHeadline(incidents, windowLabel)

  return (
    <section
      aria-label="Overall status"
      data-testid="ops-incident-summary"
      className={cn(tierCardClass, postureStyles(posture), loading && 'opacity-80')}
    >
      <div className="flex min-w-0 items-start gap-2">
        {posture === 'healthy' ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wide opacity-80">{OP_LABEL.overallStatus}</p>
          <p className="mt-0.5 text-[13px] font-semibold leading-snug">{headline}</p>
          <p className="mt-1 text-[11px] opacity-80">{runningStreams} streams active</p>
        </div>
      </div>
    </section>
  )
}

export function OperationsActiveIssues({
  incidents,
  selectedId,
  onSelectIncident,
  incident,
  loading,
}: {
  incidents: OpsIncident[]
  selectedId: string | null
  onSelectIncident: (id: string) => void
  incident: OpsIncident | null
  loading: boolean
}) {
  const chips = incidents.slice(0, 4)

  return (
    <section aria-label="Active issues" data-testid="ops-why-panel" className={tierCardClass}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">{OP_LABEL.activeIssues}</p>
      {loading ? (
        <p className="mt-1.5 text-[11px] text-slate-500 dark:text-gdc-muted">Loading…</p>
      ) : chips.length > 0 ? (
        <>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {chips.map((inc) => (
              <button
                key={inc.id}
                type="button"
                onClick={() => onSelectIncident(inc.id)}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] font-semibold transition',
                  chipTone(inc.severity),
                  selectedId === inc.id && 'ring-2 ring-violet-500/50',
                )}
              >
                {inc.label}
              </button>
            ))}
          </div>
          {incident ? (
            <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-slate-700 dark:text-gdc-mutedStrong">
              {incident.whySummary}
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-1.5 text-[11px] text-slate-600 dark:text-gdc-muted">No active issues in this window.</p>
      )}
    </section>
  )
}

export function OperationsDeliveryHealth({
  kpiCards,
  loading,
}: {
  kpiCards: KpiCard[]
  loading: boolean
}) {
  const deliveryIssues = kpiCards.find((c) => c.label === OP_LABEL.deliveryIssues)
  const healthy = kpiCards.find((c) => c.label === 'Healthy streams')
  const retrying = kpiCards.find((c) => c.label === 'Retrying deliveries')

  return (
    <section aria-label="Delivery health" data-testid="ops-delivery-health" className={tierCardClass}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">{OP_LABEL.deliveryHealth}</p>
      {loading ? (
        <p className="mt-1.5 text-[11px] text-slate-500 dark:text-gdc-muted">Loading…</p>
      ) : (
        <dl className="mt-1.5 space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-[11px] text-slate-600 dark:text-gdc-muted">{OP_LABEL.deliveryIssues}</dt>
            <dd className="text-[13px] font-semibold tabular-nums text-red-700 dark:text-red-300">{deliveryIssues?.value ?? '—'}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-[11px] text-slate-600 dark:text-gdc-muted">Healthy streams</dt>
            <dd className="text-[13px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{healthy?.value ?? '—'}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-[11px] text-slate-600 dark:text-gdc-muted">Retrying</dt>
            <dd className="text-[13px] font-semibold tabular-nums text-amber-800 dark:text-amber-300">{retrying?.value ?? '—'}</dd>
          </div>
        </dl>
      )}
    </section>
  )
}

type ActionCard = { label: string; to: string; testId: string; priority: 'P0' | 'P1' | 'P2' }

function buildActionCards(incident: OpsIncident | null, govSummary: GovernanceOperationsSummaryResponse | null): ActionCard[] {
  const cards: ActionCard[] = []
  const govPending =
    (govSummary?.pending_approvals ?? 0) +
    (govSummary?.open_violations ?? 0) +
    (govSummary?.quarantined_events ?? 0) +
    (govSummary?.failed_replays ?? 0)

  if (govPending > 0) {
    cards.push({
      label: 'Governance actions',
      to: NAV_PATH.governanceOperations,
      testId: 'ops-action-governance',
      priority: 'P0',
    })
  }

  if (incident?.streamId != null) {
    cards.push({
      label: 'Delivery failures',
      to: logsExplorerPath({ stream_id: incident.streamId, status: 'failed' }),
      testId: 'ops-action-failures',
      priority: 'P0',
    })
    cards.push({
      label: 'Stream issue',
      to: `/streams?focus=${incident.streamId}&issue=open`,
      testId: 'ops-action-stream',
      priority: 'P1',
    })
    cards.push({
      label: 'Analytics',
      to: `${NAV_PATH.analytics}?stream_id=${incident.streamId}`,
      testId: 'ops-action-analytics',
      priority: 'P2',
    })
  } else if (incident?.kind === 'governance') {
    cards.push({
      label: 'Governance queue',
      to: NAV_PATH.governanceOperations,
      testId: 'ops-action-governance-queue',
      priority: 'P0',
    })
  } else {
    cards.push({
      label: 'Delivery records',
      to: NAV_PATH.logs,
      testId: 'ops-action-logs',
      priority: 'P1',
    })
    cards.push({
      label: 'All streams',
      to: NAV_PATH.streams,
      testId: 'ops-action-streams',
      priority: 'P2',
    })
  }

  return cards.slice(0, 3)
}

export function OperationsActionPanel({
  incident,
  govSummary,
  loading,
}: {
  incident: OpsIncident | null
  govSummary: GovernanceOperationsSummaryResponse | null
  loading: boolean
}) {
  const cards = buildActionCards(incident, govSummary)

  return (
    <section aria-label="Required action" data-testid="ops-action-panel" className={cn(tierCardClass, 'bg-slate-50/60 dark:bg-gdc-section/80')}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">{OP_LABEL.requiredAction}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {loading ? (
          <span className="text-[11px] text-slate-500 dark:text-gdc-muted">Loading…</span>
        ) : (
          cards.map((card) => (
            <Link
              key={card.testId}
              to={card.to}
              data-testid={card.testId}
              className="inline-flex rounded-md border border-violet-300 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-800 hover:bg-violet-100 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-200"
            >
              {card.label}
            </Link>
          ))
        )}
        {!loading && (govSummary?.pending_approvals ?? 0) + (govSummary?.open_violations ?? 0) > 3 ? (
          <Link
            to={NAV_PATH.governanceOperations}
            className="inline-flex rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:border-gdc-border dark:text-slate-200"
          >
            View all
          </Link>
        ) : null}
      </div>
    </section>
  )
}

/** @deprecated Use OperationsOverallStatus — kept for test compatibility */
export const OperationsIncidentSummary = OperationsOverallStatus

/** @deprecated Use OperationsActiveIssues */
export const OperationsWhyPanel = OperationsActiveIssues
