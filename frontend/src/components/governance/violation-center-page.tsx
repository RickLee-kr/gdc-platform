import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchGovernanceViolationDetail,
  fetchGovernanceViolations,
  type GovernanceViolationDetailResponse,
  type GovernanceViolationEntry,
  type ViolationSeverity,
  type ViolationStatus,
  type ViolationWindow,
} from '../../api/gdcGovernanceViolations'
import { fetchGovernancePolicies, type GovernancePolicyEntry } from '../../api/gdcGovernancePolicies'
import { NAV_PATH, logsExplorerPath } from '../../config/nav-paths'
import { governanceReadOnlyReason } from '../../lib/governance-rbac'
import { cn } from '../../lib/utils'
import { Link } from 'react-router-dom'
import { isOssReleaseMode } from '../../lib/feature-flags'
import { opTable, opTd, opTh, opThRow, opTr } from '../dashboard/widgets/operational-table-styles'
import { GovernanceInvestigationDrawer } from './governance-investigation-drawer'

const WINDOWS: readonly ViolationWindow[] = ['24h', '7d', '30d'] as const
const STATUSES: readonly ViolationStatus[] = ['OPEN', 'QUARANTINED', 'RELEASED', 'REPLAYED'] as const
const SEVERITIES: readonly ViolationSeverity[] = ['HIGH', 'MEDIUM', 'LOW'] as const

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function statusBadgeClass(status: ViolationStatus) {
  switch (status) {
    case 'QUARANTINED':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
    case 'RELEASED':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
    case 'REPLAYED':
      return 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200'
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
  }
}

function severityBadgeClass(severity: ViolationSeverity) {
  switch (severity) {
    case 'HIGH':
      return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'
    case 'MEDIUM':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
    default:
      return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
  }
}

function ViolationDetailDrawer({
  detail,
  loading,
  onClose,
}: {
  detail: GovernanceViolationDetailResponse | null
  loading: boolean
  onClose: () => void
}) {
  const v = detail?.violation

  return (
    <GovernanceInvestigationDrawer
      title="Violation investigation"
      testId="violation-detail-drawer"
      closeTestId="violation-detail-close"
      loading={loading}
      hasContent={Boolean(v && detail)}
      onClose={onClose}
      rootCauseStrip={v?.reason ?? null}
      rootCauseTestId="violation-root-cause-strip"
      whatHappenedTestId="violation-section-what-happened"
      whyTestId="violation-section-why"
      whatShouldIDoTestId="violation-section-what-should-i-do"
      whatHappened={
        v && detail ? (
          <>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{detail.policy_summary.policy_name}</p>
            {detail.policy_summary.rule_summary ? (
              <p className="text-[12px] text-slate-600 dark:text-gdc-muted">{detail.policy_summary.rule_summary}</p>
            ) : null}
            <p className="text-[13px] text-slate-800 dark:text-slate-200">{v.reason}</p>
            <p className="text-[12px] text-slate-500">
              {v.stream_name} · {formatTime(v.event_time)}
            </p>
          </>
        ) : null
      }
      why={
        v && detail ? (
          <>
            <p className="text-[13px] text-slate-800 dark:text-slate-200">
              Severity: <span className="font-medium">{v.severity}</span> · Status:{' '}
              <span className="font-medium">{v.status}</span>
            </p>
            {detail.policy_summary.rule_summary ? (
              <p className="text-[12px] text-slate-600 dark:text-gdc-muted">{detail.policy_summary.rule_summary}</p>
            ) : (
              <p className="text-[12px] text-slate-600 dark:text-gdc-muted">Policy rule matched during delivery.</p>
            )}
          </>
        ) : null
      }
      related={
        v && detail ? (
          <>
            {detail.related_quarantine ? (
              <div className="text-[12px]">
                <p className="font-medium text-slate-800 dark:text-slate-200">
                  Quarantine · #{detail.related_quarantine.quarantine_event_id}
                </p>
                <p className="text-slate-500">{detail.related_quarantine.quarantine_reason}</p>
              </div>
            ) : null}
            {detail.related_replays.length > 0 ? (
              <ul className="mt-2 space-y-0.5 text-[12px] text-slate-700 dark:text-gdc-muted">
                {detail.related_replays.map((r) => (
                  <li key={r.replay_event_id}>
                    Replay #{r.replay_event_id} · {r.status} · {r.event_count} events
                  </li>
                ))}
              </ul>
            ) : null}
            {!detail.related_quarantine && detail.related_replays.length === 0 ? (
              <p className="text-[12px] text-slate-500">No related quarantine or replay events.</p>
            ) : null}
          </>
        ) : null
      }
      whatShouldIDo={
        v && detail ? (
          <div className="flex flex-wrap gap-2">
            {detail.related_quarantine ? (
              <Link
                to={NAV_PATH.governanceQuarantine}
                className="rounded-md border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-900 hover:bg-violet-100 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-100"
                data-testid="violation-open-quarantine"
              >
                Release
              </Link>
            ) : null}
            {detail.related_replays.length > 0 ? (
              <Link
                to={NAV_PATH.governanceReplay}
                className="rounded-md border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-900 hover:bg-violet-100 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-100"
                data-testid="violation-open-replay"
              >
                Replay
              </Link>
            ) : null}
            {detail.policy_summary.policy_id != null ? (
              isOssReleaseMode() ? (
                <Link
                  to={NAV_PATH.governanceApprovals}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:text-slate-200 dark:hover:bg-gdc-rowHover"
                  data-testid="violation-open-policy"
                >
                  View details
                </Link>
              ) : (
                <Link
                  to={NAV_PATH.governanceDataProtection}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:text-slate-200 dark:hover:bg-gdc-rowHover"
                  data-testid="violation-open-policy"
                >
                  View details
                </Link>
              )
            ) : null}
            <Link
              to={logsExplorerPath({ stream_id: v.stream_id, stage: 'quarantine_event_created' })}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:text-slate-200 dark:hover:bg-gdc-rowHover"
              data-testid="violation-view-logs"
            >
              View details
            </Link>
          </div>
        ) : null
      }
    />
  )
}

export function ViolationCenterPage() {
  const readOnlyReason = governanceReadOnlyReason()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [violations, setViolations] = useState<GovernanceViolationEntry[]>([])
  const [policies, setPolicies] = useState<GovernancePolicyEntry[]>([])
  const [window, setWindow] = useState<ViolationWindow>('24h')
  const [policyId, setPolicyId] = useState<number | ''>('')
  const [status, setStatus] = useState<ViolationStatus | ''>('')
  const [severity, setSeverity] = useState<ViolationSeverity | ''>('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<GovernanceViolationDetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchGovernanceViolations({
        window,
        policy_id: policyId === '' ? undefined : policyId,
        status: status === '' ? undefined : status,
        severity: severity === '' ? undefined : severity,
      })
      setViolations(data?.violations ?? [])
      if (data == null) setError('Violation APIs unavailable.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [window, policyId, status, severity])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void fetchGovernancePolicies().then((data) => setPolicies(data?.policies ?? []))
  }, [])

  const openDetail = async (id: string) => {
    setSelectedId(id)
    setDetailLoading(true)
    setDetail(null)
    try {
      const d = await fetchGovernanceViolationDetail(id, window === '24h' ? '7d' : window)
      setDetail(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDetailLoading(false)
    }
  }

  const closeDetail = () => {
    setSelectedId(null)
    setDetail(null)
  }

  const policyOptions = useMemo(
    () => policies.map((p) => ({ id: p.id, name: p.name })),
    [policies],
  )

  return (
    <div className="space-y-4" data-testid="violation-center-page">
      <section className="rounded-xl border border-slate-200/90 bg-white p-4 dark:border-gdc-border dark:bg-gdc-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="inline-flex items-center gap-2 text-[15px] font-semibold text-slate-900 dark:text-slate-100">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden />
              Violation Center
            </p>
            <p className="mt-1 text-[12px] text-slate-500 dark:text-gdc-muted">
              Policy-centric violation feed from quarantine and response outcomes.
              {readOnlyReason ? ` ${readOnlyReason}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:text-slate-200 dark:hover:bg-gdc-rowHover"
            data-testid="violation-refresh"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} aria-hidden />
            Refresh
          </button>
        </div>

        <div
          className="mt-4 flex flex-wrap gap-2"
          data-testid="violation-filters"
        >
          <select
            value={window}
            onChange={(e) => setWindow(e.target.value as ViolationWindow)}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-gdc-border dark:bg-gdc-card"
            data-testid="violation-filter-window"
            aria-label="Time range"
          >
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
          <select
            value={policyId}
            onChange={(e) => setPolicyId(e.target.value === '' ? '' : Number(e.target.value))}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-gdc-border dark:bg-gdc-card"
            data-testid="violation-filter-policy"
            aria-label="Policy"
          >
            <option value="">All policies</option>
            {policyOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as ViolationSeverity | '')}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-gdc-border dark:bg-gdc-card"
            data-testid="violation-filter-severity"
            aria-label="Severity"
          >
            <option value="">All severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ViolationStatus | '')}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-gdc-border dark:bg-gdc-card"
            data-testid="violation-filter-status"
            aria-label="Status"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </section>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      {!loading && violations.length === 0 && !error ? (
        <div
          className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 p-8 text-center dark:border-gdc-border dark:bg-gdc-card/50"
          data-testid="violation-empty-state"
        >
          <p className="text-[13px] font-medium text-slate-700 dark:text-slate-200">No policy violations found</p>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-gdc-muted">
            Try a wider time range or adjust filters.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200/90 bg-white dark:border-gdc-border dark:bg-gdc-card">
          <table className={opTable} data-testid="violation-table">
            <thead>
              <tr className={opThRow}>
                <th className={opTh}>Policy</th>
                <th className={opTh}>Stream</th>
                <th className={opTh}>Severity</th>
                <th className={opTh}>Reason</th>
                <th className={opTh}>Status</th>
                <th className={opTh}>Time</th>
              </tr>
            </thead>
            <tbody>
              {loading && violations.length === 0 ? (
                <tr className={opTr}>
                  <td colSpan={6} className={cn(opTd, 'text-center text-slate-500')}>
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" aria-hidden />
                  </td>
                </tr>
              ) : (
                violations.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(opTr, 'cursor-pointer hover:bg-slate-50 dark:hover:bg-gdc-rowHover')}
                    onClick={() => void openDetail(row.id)}
                    data-testid={`violation-row-${row.id}`}
                  >
                    <td className={opTd}>
                      <span className="font-medium text-slate-900 dark:text-slate-100">{row.policy_name}</span>
                    </td>
                    <td className={opTd}>{row.stream_name}</td>
                    <td className={opTd}>
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                          severityBadgeClass(row.severity),
                        )}
                      >
                        {row.severity}
                      </span>
                    </td>
                    <td className={cn(opTd, 'max-w-xs truncate')} title={row.reason}>
                      {row.reason}
                    </td>
                    <td className={opTd}>
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                          statusBadgeClass(row.status),
                        )}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className={cn(opTd, 'whitespace-nowrap text-slate-500')}>{formatTime(row.event_time)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {selectedId ? (
        <ViolationDetailDrawer detail={detail} loading={detailLoading} onClose={closeDetail} />
      ) : null}
    </div>
  )
}
