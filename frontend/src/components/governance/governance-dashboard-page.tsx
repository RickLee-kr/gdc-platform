import { Activity, Loader2, RefreshCw, Shield } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchGovernanceDashboardSummary,
  type GovernanceDashboardActivityEntry,
  type GovernanceDashboardSummaryResponse,
} from '../../api/gdcGovernanceDashboard'
import { NAV_PATH } from '../../config/nav-paths'
import { isOssReleaseMode } from '../../lib/feature-flags'
import { cn } from '../../lib/utils'

function formatCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0'
  return value.toLocaleString('en-US')
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

function KpiCard({
  label,
  value,
  testId,
  to,
}: {
  label: string
  value: number
  testId: string
  to?: string
}) {
  const body = (
    <dl className="rounded-lg border border-slate-100 bg-slate-50/60 p-3 dark:border-gdc-border dark:bg-gdc-rowHover/20">
      <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">{label}</dt>
      <dd className="mt-1 text-[22px] font-bold tabular-nums text-slate-900 dark:text-slate-100" data-testid={testId}>
        {formatCount(value)}
      </dd>
    </dl>
  )
  if (to) {
    return (
      <Link to={to} data-testid={`${testId}-link`} className="block transition-colors hover:opacity-90">
        {body}
      </Link>
    )
  }
  return body
}

function RiskBar({
  label,
  value,
  tone,
  testId,
}: {
  label: string
  value: number
  tone: 'critical' | 'high' | 'medium' | 'low'
  testId: string
}) {
  const toneClass = {
    critical: 'bg-red-500',
    high: 'bg-orange-500',
    medium: 'bg-amber-500',
    low: 'bg-emerald-500',
  }[tone]
  return (
    <div data-testid={testId}>
      <div className="mb-1 flex items-center justify-between text-[12px]">
        <span className="font-medium text-slate-700 dark:text-slate-200">{label}</span>
        <span className="tabular-nums text-slate-600 dark:text-gdc-mutedStrong">{formatCount(value)}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 dark:bg-gdc-rowHover">
        <div className={cn('h-2 rounded-full', toneClass)} style={{ width: `${Math.min(100, value * 8)}%` }} />
      </div>
    </div>
  )
}

function ActivityCard({ row }: { row: GovernanceDashboardActivityEntry }) {
  return (
    <div
      className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2 dark:border-gdc-border dark:bg-gdc-rowHover/30"
      data-testid={`dashboard-activity-${row.event_type}`}
    >
      <p className="text-[12px] font-medium text-slate-800 dark:text-slate-100">{row.event_label}</p>
      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-gdc-muted">
        {formatTime(row.event_time)}
        {row.policy_name ? ` · ${row.policy_name}` : ''}
        {row.stream_name ? ` · ${row.stream_name}` : ''}
      </p>
    </div>
  )
}

export function GovernanceDashboardPage() {
  const [summary, setSummary] = useState<GovernanceDashboardSummaryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSummary(await fetchGovernanceDashboardSummary())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load governance dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const isEmptyGovernance =
    !loading &&
    summary != null &&
    summary.active_policies === 0 &&
    summary.open_violations === 0 &&
    summary.quarantined_events === 0 &&
    (summary.recent_activity.length ?? 0) === 0

  const activePoliciesLink = isOssReleaseMode() ? NAV_PATH.governanceApprovals : NAV_PATH.governanceDataProtection

  return (
    <div className="space-y-6" data-testid="governance-dashboard-page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
            <Shield className="h-5 w-5 text-violet-600 dark:text-violet-400" aria-hidden />
            Executive Governance Dashboard
          </h1>
          <p className="mt-1 max-w-2xl text-[13px] text-slate-600 dark:text-gdc-mutedStrong">
            Strategic visibility into policy posture, risk, and compliance. Read-only — take action in Operations.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          data-testid="dashboard-refresh"
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-gdc-border dark:text-slate-200 dark:hover:bg-gdc-rowHover"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </button>
      </header>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
          {error}
        </p>
      ) : null}

      {isEmptyGovernance ? (
        <section
          className="rounded-xl border border-slate-200/90 bg-slate-50/60 px-4 py-4 dark:border-gdc-border dark:bg-gdc-rowHover/20"
          data-testid="governance-dashboard-empty-state"
        >
          <h2 className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">Governance workspace ready</h2>
          <p className="mt-1 max-w-2xl text-[13px] text-slate-600 dark:text-gdc-mutedStrong">
            No policies, violations, or quarantine events yet. As streams run, governance signals appear here and in{' '}
            <Link to={NAV_PATH.governanceOperations} className="font-medium text-violet-700 hover:underline dark:text-violet-300">
              Operations
            </Link>
            .
          </p>
        </section>
      ) : null}

      <section aria-label="Executive KPI" data-testid="dashboard-kpi-strip">
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <KpiCard label="Active Policies" value={summary?.active_policies ?? 0} testId="dashboard-kpi-active-policies" to={activePoliciesLink} />
          <KpiCard label="Policies In Review" value={summary?.policies_in_review ?? 0} testId="dashboard-kpi-review" to={NAV_PATH.governanceApprovals} />
          <KpiCard label="Open Violations" value={summary?.open_violations ?? 0} testId="dashboard-kpi-violations" to={NAV_PATH.governanceViolations} />
          <KpiCard label="Quarantined Events" value={summary?.quarantined_events ?? 0} testId="dashboard-kpi-quarantine" to={NAV_PATH.governanceQuarantine} />
          <KpiCard label="Failed Replays" value={summary?.failed_replays ?? 0} testId="dashboard-kpi-failed-replays" to={`${NAV_PATH.governanceReplay}?status=FAILED`} />
          <KpiCard label="Notification Failures" value={summary?.notification_failures ?? 0} testId="dashboard-kpi-notification-failures" to={NAV_PATH.governanceNotifications} />
        </dl>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200/90 bg-white p-4 dark:border-gdc-border dark:bg-gdc-card" data-testid="dashboard-risk-overview">
          <h2 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Operational Risk Overview</h2>
          <div className="mt-4 space-y-3">
            <RiskBar label="Critical" value={summary?.risk.critical ?? 0} tone="critical" testId="dashboard-risk-critical" />
            <RiskBar label="High" value={summary?.risk.high ?? 0} tone="high" testId="dashboard-risk-high" />
            <RiskBar label="Medium" value={summary?.risk.medium ?? 0} tone="medium" testId="dashboard-risk-medium" />
            <RiskBar label="Low" value={summary?.risk.low ?? 0} tone="low" testId="dashboard-risk-low" />
          </div>
        </section>

        <section className="rounded-xl border border-slate-200/90 bg-white p-4 dark:border-gdc-border dark:bg-gdc-card" data-testid="dashboard-policy-health">
          <h2 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Policy Health</h2>
          <dl className="mt-3 grid grid-cols-3 gap-3">
            {[
              { label: 'Healthy', value: summary?.policy_health.healthy ?? 0, testId: 'dashboard-health-healthy' },
              { label: 'Warning', value: summary?.policy_health.warning ?? 0, testId: 'dashboard-health-warning' },
              { label: 'Critical', value: summary?.policy_health.critical ?? 0, testId: 'dashboard-health-critical' },
            ].map((item) => (
              <div key={item.testId} className="rounded-lg border border-slate-100 bg-slate-50/60 p-3 dark:border-gdc-border dark:bg-gdc-rowHover/20">
                <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">{item.label}</dt>
                <dd className="mt-1 text-[18px] font-bold tabular-nums text-slate-900 dark:text-slate-100" data-testid={item.testId}>
                  {formatCount(item.value)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <section className="rounded-xl border border-slate-200/90 bg-white p-4 dark:border-gdc-border dark:bg-gdc-card" data-testid="dashboard-compliance-snapshot">
        <h2 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Compliance Snapshot</h2>
        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-gdc-muted">Last 24 hours</p>
        <dl className="mt-3 grid grid-cols-3 gap-3">
          {[
            { label: 'Violations', value: summary?.compliance_snapshot.violations_24h ?? 0, testId: 'dashboard-compliance-violations' },
            { label: 'Quarantines', value: summary?.compliance_snapshot.quarantines_24h ?? 0, testId: 'dashboard-compliance-quarantines' },
            { label: 'Replays', value: summary?.compliance_snapshot.replays_24h ?? 0, testId: 'dashboard-compliance-replays' },
          ].map((item) => (
            <div key={item.testId} className="rounded-lg border border-slate-100 bg-slate-50/60 p-3 dark:border-gdc-border dark:bg-gdc-rowHover/20">
              <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">{item.label}</dt>
              <dd className="mt-1 text-[18px] font-bold tabular-nums text-slate-900 dark:text-slate-100" data-testid={item.testId}>
                {formatCount(item.value)}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-xl border border-slate-200/90 bg-white p-4 dark:border-gdc-border dark:bg-gdc-card" data-testid="dashboard-recent-activity">
        <h2 className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-900 dark:text-slate-100">
          <Activity className="h-4 w-4 text-violet-600 dark:text-violet-400" aria-hidden />
          Recent Governance Activity
        </h2>
        {loading && !summary ? (
          <p className="mt-3 text-[12px] text-slate-500 dark:text-gdc-muted">Loading…</p>
        ) : (summary?.recent_activity.length ?? 0) === 0 ? (
          <p className="mt-3 text-[12px] text-slate-500 dark:text-gdc-muted" data-testid="dashboard-activity-empty">
            No recent governance activity
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {summary?.recent_activity.map((row) => (
              <ActivityCard key={`${row.event_type}-${row.event_time}-${row.policy_id ?? 'p'}`} row={row} />
            ))}
          </div>
        )}
      </section>

      <p className="text-[11px] text-slate-500 dark:text-gdc-muted">
        Need to approve, release, or replay? Go to{' '}
        <Link to={NAV_PATH.governanceOperations} className="font-medium text-violet-700 hover:underline dark:text-violet-300">
          Governance Operations
        </Link>
        .
      </p>
    </div>
  )
}
