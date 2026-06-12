import { AlertTriangle, Loader2, RefreshCw, Zap } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchGovernanceOperationsQueue,
  fetchGovernanceOperationsSummary,
  type GovernanceOperationsActionRequiredItem,
  type GovernanceOperationsApprovalQueueItem,
  type GovernanceOperationsNotificationQueueItem,
  type GovernanceOperationsQuarantineQueueItem,
  type GovernanceOperationsReplayQueueItem,
  type GovernanceOperationsSummaryResponse,
  type GovernanceOperationsViolationQueueItem,
} from '../../api/gdcGovernanceOperations'
import { NAV_PATH } from '../../config/nav-paths'
import {
  canApprovePolicy,
  canDiscardQuarantine,
  canExecuteReplay,
  canReleaseQuarantine,
  canViewGovernanceOperations,
  governanceReadOnlyReason,
} from '../../lib/governance-rbac'
import { cn } from '../../lib/utils'
import { GovernanceActionQueuePanel } from './governance-action-queue-panel'

function formatCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0'
  return value.toLocaleString('en-US')
}

const QUEUE_LINKS: readonly {
  key: keyof GovernanceOperationsSummaryResponse
  label: string
  testId: string
  to: string
}[] = [
  { key: 'pending_approvals', label: 'Pending Approvals', testId: 'ops-queue-approvals', to: NAV_PATH.governanceApprovals },
  { key: 'open_violations', label: 'Open Violations', testId: 'ops-queue-violations', to: NAV_PATH.governanceViolations },
  { key: 'quarantined_events', label: 'Quarantined Events', testId: 'ops-queue-quarantine', to: NAV_PATH.governanceQuarantine },
  { key: 'failed_replays', label: 'Failed Replays', testId: 'ops-queue-failed-replays', to: `${NAV_PATH.governanceReplay}?status=FAILED` },
  { key: 'failed_notifications', label: 'Failed Notifications', testId: 'ops-queue-notifications', to: NAV_PATH.governanceNotifications },
]

function priorityClass(priority: string): string {
  switch (priority) {
    case 'critical':
      return 'border-red-200 bg-red-50/70 dark:border-red-500/30 dark:bg-red-500/10'
    case 'high':
      return 'border-orange-200 bg-orange-50/70 dark:border-orange-500/30 dark:bg-orange-500/10'
    default:
      return 'border-amber-200 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-500/10'
  }
}

function ActionButton({
  label,
  to,
  testId,
  disabled,
}: {
  label: string
  to: string
  testId: string
  disabled?: boolean
}) {
  if (disabled) {
    return (
      <span
        data-testid={testId}
        className="inline-flex rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-400 dark:border-gdc-border"
      >
        {label}
      </span>
    )
  }
  return (
    <Link
      to={to}
      data-testid={testId}
      className="inline-flex rounded-md border border-violet-300 bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-800 hover:bg-violet-100 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-200"
    >
      {label}
    </Link>
  )
}

function ActionRequiredCard({ item }: { item: GovernanceOperationsActionRequiredItem }) {
  return (
    <div
      className={cn('rounded-lg border p-3', priorityClass(item.priority))}
      data-testid={`ops-action-required-${item.category}`}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div>
          <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{item.label}</p>
          <p className="mt-0.5 text-[11px] text-slate-600 dark:text-gdc-mutedStrong">{item.recommended_action}</p>
        </div>
      </div>
    </div>
  )
}

function ApprovalCard({ item, readOnly }: { item: GovernanceOperationsApprovalQueueItem; readOnly: boolean }) {
  const to = `${NAV_PATH.governanceApprovals}?policy=${item.policy_id}`
  return (
    <div className="rounded-lg border border-slate-100 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card" data-testid={`ops-approval-${item.policy_id}`}>
      <p className="text-[13px] font-medium text-slate-900 dark:text-slate-100">{item.policy_name}</p>
      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-gdc-muted">
        {item.requester ? `Requested by ${item.requester}` : 'Awaiting review'}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <ActionButton label="Approve" to={to} testId={`ops-approve-${item.policy_id}`} disabled={readOnly || !canApprovePolicy()} />
        <ActionButton label="Reject" to={to} testId={`ops-reject-${item.policy_id}`} disabled={readOnly || !canApprovePolicy()} />
      </div>
    </div>
  )
}

function ViolationCard({ item }: { item: GovernanceOperationsViolationQueueItem }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card" data-testid={`ops-violation-${item.violation_id}`}>
      <p className="text-[13px] font-medium text-slate-900 dark:text-slate-100">{item.policy_name ?? 'Unknown policy'}</p>
      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-gdc-muted">
        {item.stream_name ?? '—'} · {item.severity} · {item.status}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <ActionButton label="Investigate" to={NAV_PATH.governanceViolations} testId={`ops-investigate-${item.violation_id}`} />
        <ActionButton label="Open Detail" to={`${NAV_PATH.governanceViolations}?id=${encodeURIComponent(item.violation_id)}`} testId={`ops-violation-detail-${item.violation_id}`} />
      </div>
    </div>
  )
}

function QuarantineCard({ item, readOnly }: { item: GovernanceOperationsQuarantineQueueItem; readOnly: boolean }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card" data-testid={`ops-quarantine-${item.quarantine_id}`}>
      <p className="text-[13px] font-medium text-slate-900 dark:text-slate-100">{item.stream_name ?? 'Stream'}</p>
      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-gdc-muted">{item.quarantine_reason ?? item.status}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <ActionButton label="Release" to={NAV_PATH.governanceQuarantine} testId={`ops-release-${item.quarantine_id}`} disabled={readOnly || !canReleaseQuarantine()} />
        <ActionButton label="Discard" to={NAV_PATH.governanceQuarantine} testId={`ops-discard-${item.quarantine_id}`} disabled={readOnly || !canDiscardQuarantine()} />
        <ActionButton label="Replay" to={NAV_PATH.governanceReplay} testId={`ops-quarantine-replay-${item.quarantine_id}`} disabled={readOnly || !canExecuteReplay()} />
      </div>
    </div>
  )
}

function ReplayCard({ item, readOnly }: { item: GovernanceOperationsReplayQueueItem; readOnly: boolean }) {
  const isFailed = item.status === 'FAILED'
  return (
    <div className="rounded-lg border border-slate-100 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card" data-testid={`ops-replay-${item.replay_id}`}>
      <p className="text-[13px] font-medium text-slate-900 dark:text-slate-100">{item.stream_name ?? 'Stream'}</p>
      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-gdc-muted">{item.status}{item.outcome ? ` · ${item.outcome}` : ''}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <ActionButton label="Execute" to={`${NAV_PATH.governanceReplay}?id=${item.replay_id}`} testId={`ops-replay-execute-${item.replay_id}`} disabled={readOnly || !canExecuteReplay()} />
        {isFailed ? (
          <ActionButton label="Retry" to={`${NAV_PATH.governanceReplay}?id=${item.replay_id}&retry=1`} testId={`ops-replay-retry-${item.replay_id}`} disabled={readOnly || !canExecuteReplay()} />
        ) : null}
      </div>
    </div>
  )
}

function NotificationCard({ item }: { item: GovernanceOperationsNotificationQueueItem }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card" data-testid={`ops-notification-${item.notification_id}`}>
      <p className="text-[13px] font-medium text-slate-900 dark:text-slate-100">{item.event_type.replace(/_/g, ' ')}</p>
      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-gdc-muted">{item.severity} · {item.status}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <ActionButton label="View Failure" to={NAV_PATH.governanceNotifications} testId={`ops-notification-view-${item.notification_id}`} />
        <ActionButton label="Retry Delivery" to={NAV_PATH.governanceNotifications} testId={`ops-notification-retry-${item.notification_id}`} />
      </div>
    </div>
  )
}

export function OperationsCenterPage() {
  const readOnlyReason = governanceReadOnlyReason()
  const readOnly = Boolean(readOnlyReason)
  const [summary, setSummary] = useState<GovernanceOperationsSummaryResponse | null>(null)
  const [queue, setQueue] = useState<Awaited<ReturnType<typeof fetchGovernanceOperationsQueue>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [summaryResp, queueResp] = await Promise.all([
        fetchGovernanceOperationsSummary(),
        fetchGovernanceOperationsQueue(),
      ])
      setSummary(summaryResp)
      setQueue(queueResp)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load operations data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (!canViewGovernanceOperations()) {
    return (
      <section
        className="rounded-xl border border-amber-300/70 bg-amber-500/[0.06] p-6 text-sm text-amber-950 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-100"
        data-testid="operations-unauthorized"
        role="alert"
      >
        <h2 className="text-base font-semibold">Governance Operations unavailable</h2>
        <p className="mt-2">Governance Operations requires Governance Operator role or higher. Use the Executive Dashboard for read-only visibility.</p>
        <Link to={NAV_PATH.governance} className="mt-3 inline-block text-[13px] font-medium text-violet-700 hover:underline dark:text-violet-300">
          Go to Dashboard
        </Link>
      </section>
    )
  }

  return (
    <div className="space-y-6" data-testid="operations-center-page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
            <Zap className="h-5 w-5 text-violet-600 dark:text-violet-400" aria-hidden />
            Operational Governance Center
          </h1>
          <p className="mt-1 text-[12px] text-slate-600 dark:text-gdc-mutedStrong">Review the action queue first, then work through detail cards below.</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          data-testid="ops-refresh"
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200 dark:hover:bg-gdc-rowHover"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </button>
      </header>

      {readOnlyReason ? (
        <div className="rounded-lg border border-amber-300/70 bg-amber-500/[0.08] px-4 py-3 text-[12px] text-amber-950 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-100" data-testid="ops-read-only-banner">
          <span className="font-semibold">Read-only view.</span> {readOnlyReason}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <section
        className="rounded-xl border border-slate-200/90 bg-white p-4 dark:border-gdc-border dark:bg-gdc-card"
        aria-label="Action Queue"
        data-testid="ops-action-queue"
      >
        <h2 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Action Queue</h2>
        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-gdc-muted">Start here — sorted by priority.</p>
        <div className="mt-3">
          <GovernanceActionQueuePanel
            queue={queue}
            readOnly={readOnly}
            canApprove={canApprovePolicy()}
            canRelease={canReleaseQuarantine()}
            canReplay={canExecuteReplay()}
            testId="gov-action-queue-panel"
          />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200/90 bg-slate-50/40 p-4 dark:border-gdc-border dark:bg-gdc-rowHover/10" data-testid="ops-detail-cards">
        <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Violations · Replay · Quarantine · Audit</h2>

        <section aria-label="Queue summary" data-testid="ops-queue-summary" className="mb-4">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {QUEUE_LINKS.map((item) => (
              <Link
                key={item.testId}
                to={item.to}
                data-testid={item.testId}
                className="rounded-lg border border-slate-100 bg-white p-2.5 transition-colors hover:border-violet-300/70 dark:border-gdc-border dark:bg-gdc-card dark:hover:border-violet-500/30"
              >
                <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">{item.label}</dt>
                <dd className="mt-0.5 text-[18px] font-bold tabular-nums text-slate-900 dark:text-slate-100" data-testid={`${item.testId}-value`}>
                  {formatCount(summary?.[item.key] ?? 0)}
                </dd>
              </Link>
            ))}
          </dl>
        </section>

        <section className="mb-4 rounded-lg border border-slate-100 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card" data-testid="ops-action-required">
          <h3 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Attention signals</h3>
          {(queue?.action_required.length ?? 0) === 0 ? (
            <p className="mt-2 text-[11px] text-slate-500 dark:text-gdc-muted" data-testid="ops-action-required-empty">
              No attention signals
            </p>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {queue?.action_required.map((item) => <ActionRequiredCard key={`${item.category}-${item.priority}`} item={item} />)}
            </div>
          )}
        </section>

      <div className="grid gap-3 xl:grid-cols-2">
        <section className="rounded-lg border border-slate-100 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card" data-testid="ops-pending-approvals">
          <h3 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Pending Approvals</h3>
          {(queue?.pending_approvals.length ?? 0) === 0 ? (
            <p className="mt-3 text-[12px] text-slate-500 dark:text-gdc-muted">No pending approvals</p>
          ) : (
            <div className="mt-3 space-y-2">
              {queue?.pending_approvals.map((item) => <ApprovalCard key={item.policy_id} item={item} readOnly={readOnly} />)}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-slate-100 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card" data-testid="ops-violation-actions">
          <h3 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Violations</h3>
          {(queue?.violations.length ?? 0) === 0 ? (
            <p className="mt-3 text-[12px] text-slate-500 dark:text-gdc-muted">No open violations in queue</p>
          ) : (
            <div className="mt-3 space-y-2">
              {queue?.violations.map((item) => <ViolationCard key={item.violation_id} item={item} />)}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-slate-100 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card" data-testid="ops-quarantine-actions">
          <h3 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Quarantine</h3>
          {(queue?.quarantine.length ?? 0) === 0 ? (
            <p className="mt-3 text-[12px] text-slate-500 dark:text-gdc-muted">No quarantined events in queue</p>
          ) : (
            <div className="mt-3 space-y-2">
              {queue?.quarantine.map((item) => <QuarantineCard key={item.quarantine_id} item={item} readOnly={readOnly} />)}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-slate-100 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card" data-testid="ops-replay-actions">
          <h3 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Replay</h3>
          {(queue?.replays.length ?? 0) === 0 ? (
            <p className="mt-3 text-[12px] text-slate-500 dark:text-gdc-muted">No replay jobs in queue</p>
          ) : (
            <div className="mt-3 space-y-2">
              {queue?.replays.map((item) => <ReplayCard key={item.replay_id} item={item} readOnly={readOnly} />)}
            </div>
          )}
        </section>
      </div>

      <section className="rounded-lg border border-slate-100 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card" data-testid="ops-notification-actions">
        <h3 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Notifications</h3>
        {(queue?.notifications.length ?? 0) === 0 ? (
          <p className="mt-3 text-[12px] text-slate-500 dark:text-gdc-muted">No failed notifications</p>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {queue?.notifications.map((item) => <NotificationCard key={item.notification_id} item={item} />)}
          </div>
        )}
      </section>
      </section>
    </div>
  )
}
