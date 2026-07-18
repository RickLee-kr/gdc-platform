import { Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { fetchGovernancePolicies, type GovernancePolicyEntry } from '../../api/gdcGovernancePolicies'
import {
  bulkExecuteGovernanceReplay,
  executeGovernanceReplay,
  fetchGovernanceReplayDetail,
  fetchGovernanceReplayEvents,
  type GovernanceReplayDetailResponse,
  type GovernanceReplayEntry,
  type ReplayDisplayStatus,
  type ReplayWindow,
} from '../../api/gdcGovernanceReplay'
import { fetchStreamsList } from '../../api/gdcStreams'
import type { StreamRead } from '../../api/types/gdcApi'
import { NAV_PATH } from '../../config/nav-paths'
import { canExecuteReplay, governanceReadOnlyReason } from '../../lib/governance-rbac'
import { humanizeQuarantineReason } from '../../lib/humanize-quarantine-reason'
import { cn } from '../../lib/utils'
import { opTable, opTd, opTh, opThRow, opTr } from '../dashboard/widgets/operational-table-styles'
import { formatTimestampWithResolvedTimezone } from '../../lib/platform-timestamps'
import { usePlatformEnvironment } from '../../lib/use-platform-environment'
import { DangerousActionDialog } from '../ui/dangerous-action-dialog'
import { GovernanceInvestigationDrawer } from './governance-investigation-drawer'
import {
  REPLAY_SELECTION_SCOPE,
  buildReplayImpact,
  dedupeReplayIds,
  isReplayRetryable,
  pruneReplaySelection,
  type ReplayExecutionResultSummary,
} from './replay-center-helpers'

const WINDOWS: readonly ReplayWindow[] = ['24h', '7d', '30d'] as const
const STATUSES: readonly ReplayDisplayStatus[] = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'DISCARDED'] as const

function formatTime(iso: string | null | undefined) {
  return formatTimestampWithResolvedTimezone(iso)
}

function statusBadgeClass(status: ReplayDisplayStatus) {
  switch (status) {
    case 'PENDING':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
    case 'RUNNING':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'
    case 'COMPLETED':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
    case 'FAILED':
      return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'
    case 'DISCARDED':
      return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
  }
}

function ReplayDetailDrawer({
  detail,
  loading,
  actionLoading,
  readOnly,
  onClose,
  onExecute,
}: {
  detail: GovernanceReplayDetailResponse | null
  loading: boolean
  actionLoading: boolean
  readOnly: boolean
  onClose: () => void
  onExecute: () => void
}) {
  const entry = detail?.entry
  const strip = detail?.error_message ?? detail?.outcome ?? entry?.status ?? null

  return (
    <GovernanceInvestigationDrawer
      title="Replay investigation"
      testId="replay-detail-drawer"
      closeTestId="replay-detail-close"
      loading={loading}
      hasContent={Boolean(detail && entry)}
      onClose={onClose}
      rootCauseStrip={strip}
      rootCauseTestId="replay-root-cause-strip"
      whatHappenedTestId="replay-section-what-happened"
      whyTestId="replay-section-why"
      whatShouldIDoTestId="replay-section-what-should-i-do"
      whatHappened={
        detail && entry ? (
          <>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{detail.policy_summary.policy_name}</p>
            <p className="text-[12px] text-slate-600 dark:text-gdc-muted">{entry.stream_name}</p>
            <span
              className={cn('inline-flex rounded px-2 py-0.5 text-[11px] font-semibold', statusBadgeClass(entry.status))}
            >
              {entry.status}
            </span>
            <p className="text-[12px] text-slate-500">Replay #{entry.id} · {formatTime(entry.created_at)}</p>
          </>
        ) : null
      }
      why={
        detail && entry ? (
          <>
            <p className="text-[13px] text-slate-800 dark:text-slate-200">{detail.source.origin}</p>
            {detail.source.violation ? (
              <p className="text-[12px] text-slate-600 dark:text-gdc-muted">
                Violation triggered recovery · {detail.source.violation.reason}
              </p>
            ) : null}
            {detail.source.quarantine ? (
              <p className="text-[12px] text-slate-600 dark:text-gdc-muted">
                Quarantine #{detail.source.quarantine.quarantine_event_id} ·{' '}
                {humanizeQuarantineReason(detail.source.quarantine.quarantine_reason)}
              </p>
            ) : null}
            {detail.error_message ? (
              <p className="text-[12px] text-red-600 dark:text-red-400">{detail.error_message}</p>
            ) : null}
          </>
        ) : null
      }
      related={
        detail ? (
          <>
            <ul className="space-y-1.5 text-[12px] text-slate-700 dark:text-gdc-muted">
              {detail.timeline.map((step) => (
                <li key={step.step} data-testid={`replay-timeline-${step.step}`}>
                  <span className="font-medium text-slate-800 dark:text-slate-200">{step.label}</span>
                  {' · '}
                  {formatTime(step.event_time)}
                </li>
              ))}
            </ul>
            {detail.correlation_id ? (
              <p className="mt-2 text-[12px] text-slate-600 dark:text-gdc-muted">
                Correlation:{' '}
                <Link
                  to={`${NAV_PATH.governanceAudit}?correlation=${encodeURIComponent(detail.correlation_id)}`}
                  className="font-mono text-violet-700 hover:underline dark:text-violet-300"
                  data-testid="replay-audit-link"
                >
                  {detail.correlation_id}
                </Link>
              </p>
            ) : null}
            {detail.outcome ? (
              <p className="mt-2 text-[12px] font-medium text-slate-800 dark:text-slate-200">Outcome: {detail.outcome}</p>
            ) : (
              <p className="mt-2 text-[12px] text-slate-500">Pending delivery</p>
            )}
          </>
        ) : null
      }
      whatShouldIDo={
        detail && entry ? (
          <div className="flex flex-wrap gap-2">
            {!readOnly && detail.can_execute ? (
              <button
                type="button"
                disabled={actionLoading}
                onClick={onExecute}
                className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                data-testid="replay-action-execute"
              >
                Replay
              </button>
            ) : null}
            {detail.source.violation ? (
              <Link
                to={NAV_PATH.governanceViolations}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:text-slate-200 dark:hover:bg-gdc-rowHover"
              >
                View details
              </Link>
            ) : null}
            {detail.source.quarantine ? (
              <Link
                to={NAV_PATH.governanceQuarantine}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:text-slate-200 dark:hover:bg-gdc-rowHover"
              >
                View details
              </Link>
            ) : null}
          </div>
        ) : null
      }
    />
  )
}

function ReplaySection({
  title,
  subtitle,
  events,
  testId,
}: {
  title: string
  subtitle: string
  events: GovernanceReplayEntry[]
  testId: string
}) {
  if (events.length === 0) return null
  return (
    <section className="rounded-xl border border-slate-200/90 bg-white p-4 dark:border-gdc-border dark:bg-gdc-card" data-testid={testId}>
      <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{title}</p>
      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-gdc-muted">{subtitle}</p>
      <ul className="mt-2 space-y-1 text-[12px] text-slate-700 dark:text-gdc-muted">
        {events.slice(0, 5).map((e) => (
          <li key={e.id}>
            #{e.id} · {e.stream_name} · {e.status}
          </li>
        ))}
      </ul>
    </section>
  )
}

function ReplayCountBar({
  windowTotal,
  filteredTotal,
  loaded,
  selected,
  filtersActive,
}: {
  windowTotal: number
  filteredTotal: number
  loaded: number
  selected: number
  filtersActive: boolean
}) {
  return (
    <div
      className="mt-3 flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-slate-200/80 bg-slate-50/80 px-3 py-2 text-[11px] text-slate-700 dark:border-gdc-border dark:bg-gdc-card/60 dark:text-slate-200"
      data-testid="replay-count-bar"
      role="status"
      aria-label="Replay quantity summary"
    >
      <span data-testid="replay-count-total" title="All replay events in the selected time window, ignoring policy/stream/status filters">
        <span className="font-semibold text-slate-900 dark:text-slate-100">Total</span>
        <span className="text-slate-500 dark:text-gdc-muted"> (time window)</span>: {windowTotal}
      </span>
      <span
        data-testid="replay-count-filtered"
        title="Events matching the current filters (time window + policy/stream/status), before list limit"
      >
        <span className="font-semibold text-slate-900 dark:text-slate-100">Filtered</span>
        {filtersActive ? <span className="text-slate-500 dark:text-gdc-muted"> (current filters)</span> : null}:{' '}
        {filteredTotal}
      </span>
      <span data-testid="replay-count-loaded" title="Rows currently loaded in this list (API limit applied)">
        <span className="font-semibold text-slate-900 dark:text-slate-100">Loaded</span>: {loaded}
      </span>
      <span data-testid="replay-count-selected" title="Retryable rows selected for bulk execution">
        <span className="font-semibold text-slate-900 dark:text-slate-100">Selected</span>: {selected}
      </span>
    </div>
  )
}

export function ReplayCenterPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlStatusParam = searchParams.get('status')?.toUpperCase()

  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<GovernanceReplayEntry[]>([])
  const [windowTotal, setWindowTotal] = useState(0)
  const [filteredTotal, setFilteredTotal] = useState(0)
  const [queueCount, setQueueCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)
  const [recentCount, setRecentCount] = useState(0)
  const [window, setWindow] = useState<ReplayWindow>('24h')
  const [policyId, setPolicyId] = useState<number | ''>('')
  const [streamId, setStreamId] = useState<number | ''>('')
  const [status, setStatus] = useState<ReplayDisplayStatus | ''>(() => {
    if (urlStatusParam && STATUSES.includes(urlStatusParam as ReplayDisplayStatus)) {
      return urlStatusParam as ReplayDisplayStatus
    }
    return ''
  })
  const [policies, setPolicies] = useState<GovernancePolicyEntry[]>([])
  const [streams, setStreams] = useState<StreamRead[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [drawerId, setDrawerId] = useState<number | null>(null)
  const [detail, setDetail] = useState<GovernanceReplayDetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [executeConfirmIds, setExecuteConfirmIds] = useState<number[] | null>(null)
  const [executionResult, setExecutionResult] = useState<ReplayExecutionResultSummary | null>(null)
  const env = usePlatformEnvironment()

  const readOnly = !canExecuteReplay()
  const readOnlyReason = governanceReadOnlyReason()
  const filtersActive = policyId !== '' || streamId !== '' || status !== ''

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetchGovernanceReplayEvents({
        window,
        policy_id: policyId === '' ? undefined : policyId,
        stream_id: streamId === '' ? undefined : streamId,
        status: status === '' ? undefined : status,
      })
      const nextEvents = resp?.replay_events ?? []
      setEvents(nextEvents)
      setWindowTotal(resp?.window_total ?? 0)
      setFilteredTotal(resp?.filtered_total ?? resp?.total ?? nextEvents.length)
      setQueueCount(resp?.queue_count ?? 0)
      setFailedCount(resp?.failed_count ?? 0)
      setRecentCount(resp?.recent_count ?? 0)
      setSelectedIds((prev) => new Set(pruneReplaySelection(prev, nextEvents)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [window, policyId, streamId, status])

  useEffect(() => {
    void fetchGovernancePolicies().then((r) => setPolicies(r?.policies ?? []))
    void fetchStreamsList().then((r) => setStreams(r ?? []))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const updateStatusFilter = (next: ReplayDisplayStatus | '') => {
    setStatus(next)
    const params = new URLSearchParams(searchParams)
    if (next === '') params.delete('status')
    else params.set('status', next)
    setSearchParams(params, { replace: true })
  }

  const openDetail = async (id: number) => {
    setDrawerId(id)
    setDetailLoading(true)
    setDetail(null)
    try {
      const d = await fetchGovernanceReplayDetail(id, '30d')
      setDetail(d)
    } finally {
      setDetailLoading(false)
    }
  }

  const closeDetail = () => {
    setDrawerId(null)
    setDetail(null)
  }

  const toggleSelect = (id: number) => {
    if (actionLoading) return
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectLoaded = () => {
    if (actionLoading) return
    const retryable = events.filter(isReplayRetryable)
    const allSelected = retryable.length > 0 && retryable.every((e) => selectedIds.has(e.id))
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(retryable.map((e) => e.id)))
    }
  }

  const runExecute = async (ids: number[]) => {
    const uniqueIds = dedupeReplayIds(ids)
    if (readOnly || uniqueIds.length === 0 || actionLoading) return
    setActionLoading(true)
    setError(null)
    setExecutionResult(null)
    try {
      if (uniqueIds.length === 1) {
        const result = await executeGovernanceReplay(uniqueIds[0])
        const accepted = result.outcome === 'replayed' ? 1 : 0
        setExecutionResult({
          requested: 1,
          accepted,
          failed: accepted ? 0 : 1,
        })
        if (result.outcome !== 'replayed') {
          setError(result.message || 'Replay failed.')
        }
      } else {
        const result = await bulkExecuteGovernanceReplay(uniqueIds)
        setExecutionResult({
          requested: result.total,
          accepted: result.succeeded,
          failed: result.failed,
        })
        if (result.failed > 0) {
          setError(result.results.find((r) => r.outcome !== 'replayed')?.message ?? 'Some replays failed.')
        }
      }
      setSelectedIds(new Set())
      closeDetail()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setActionLoading(false)
    }
  }

  const queueEvents = useMemo(
    () => events.filter((e) => e.status === 'PENDING' || e.status === 'RUNNING'),
    [events],
  )
  const failedEvents = useMemo(() => events.filter((e) => e.status === 'FAILED'), [events])
  const recentEvents = useMemo(() => events.filter((e) => e.status === 'COMPLETED'), [events])
  const policyOptions = useMemo(() => policies.map((p) => ({ id: p.id, name: p.name })), [policies])
  const streamOptions = useMemo(() => streams.map((s) => ({ id: s.id, name: s.name })), [streams])
  const retryableLoaded = useMemo(() => events.filter(isReplayRetryable), [events])
  const retryableSelected = useMemo(
    () => pruneReplaySelection(selectedIds, events),
    [selectedIds, events],
  )
  const allLoadedSelected =
    retryableLoaded.length > 0 && retryableLoaded.every((e) => selectedIds.has(e.id))

  const confirmEntries = useMemo(() => {
    if (!executeConfirmIds?.length) return []
    const idSet = new Set(executeConfirmIds)
    return events.filter((e) => idSet.has(e.id))
  }, [executeConfirmIds, events])

  return (
    <div className="space-y-4" data-testid="replay-center-page">
      {readOnlyReason ? (
        <div
          role="status"
          data-testid="replay-read-only-banner"
          className="rounded-lg border border-amber-300/70 bg-amber-500/[0.08] px-4 py-3 text-[12px] text-amber-950 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-100"
        >
          <span className="font-semibold">Read-only view.</span> {readOnlyReason}
        </div>
      ) : null}

      <section className="rounded-xl border border-slate-200/90 bg-white p-4 dark:border-gdc-border dark:bg-gdc-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="inline-flex items-center gap-2 text-[15px] font-semibold text-slate-900 dark:text-slate-100">
              <RotateCcw className="h-5 w-5 text-violet-600 dark:text-violet-400" aria-hidden />
              Replay Operations
            </p>
            <p className="mt-1 text-[12px] text-slate-500 dark:text-gdc-muted">
              What is waiting? What failed? What succeeded? What should I retry?
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || actionLoading}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:text-slate-200 dark:hover:bg-gdc-rowHover disabled:opacity-50"
            data-testid="replay-refresh"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} aria-hidden />
            Refresh
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2" data-testid="replay-filters">
          <select
            value={window}
            onChange={(e) => setWindow(e.target.value as ReplayWindow)}
            disabled={actionLoading}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-gdc-border dark:bg-gdc-card disabled:opacity-50"
            data-testid="replay-filter-window"
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
            disabled={actionLoading}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-gdc-border dark:bg-gdc-card disabled:opacity-50"
            data-testid="replay-filter-policy"
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
            value={streamId}
            onChange={(e) => setStreamId(e.target.value === '' ? '' : Number(e.target.value))}
            disabled={actionLoading}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-gdc-border dark:bg-gdc-card disabled:opacity-50"
            data-testid="replay-filter-stream"
            aria-label="Stream"
          >
            <option value="">All streams</option>
            {streamOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => updateStatusFilter(e.target.value as ReplayDisplayStatus | '')}
            disabled={actionLoading}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-gdc-border dark:bg-gdc-card disabled:opacity-50"
            data-testid="replay-filter-status"
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

        <ReplayCountBar
          windowTotal={windowTotal}
          filteredTotal={filteredTotal}
          loaded={events.length}
          selected={retryableSelected.length}
          filtersActive={filtersActive}
        />

        {!readOnly && retryableSelected.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2" data-testid="replay-bulk-actions">
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => setExecuteConfirmIds(dedupeReplayIds(retryableSelected))}
              className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
              data-testid="replay-bulk-execute"
            >
              Execute Selected ({retryableSelected.length})
            </button>
          </div>
        ) : null}
      </section>

      <div className="grid gap-3 md:grid-cols-3">
        <ReplaySection
          title="Replay Queue"
          subtitle={`${queueCount} waiting`}
          events={queueEvents}
          testId="replay-section-queue"
        />
        <ReplaySection
          title="Failed Replay"
          subtitle={`${failedCount} failed`}
          events={failedEvents}
          testId="replay-section-failed"
        />
        <ReplaySection
          title="Recent Replay Activity"
          subtitle={`${recentCount} completed`}
          events={recentEvents}
          testId="replay-section-recent"
        />
      </div>

      {executionResult ? (
        <div
          className="rounded-xl border border-violet-200/80 bg-violet-50/60 px-4 py-3 text-[12px] text-violet-950 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-100"
          data-testid="replay-execution-result"
          role="status"
        >
          <p className="font-semibold">Last execution result</p>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            <span data-testid="replay-result-requested">Requested: {executionResult.requested}</span>
            <span data-testid="replay-result-accepted">Accepted: {executionResult.accepted}</span>
            <span data-testid="replay-result-failed">Failed: {executionResult.failed}</span>
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert" data-testid="replay-error">
          {error}
        </p>
      ) : null}

      {!loading && events.length === 0 && !error ? (
        <div
          className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 p-8 text-center dark:border-gdc-border dark:bg-gdc-card/50"
          data-testid="replay-empty-state"
        >
          <p className="text-[13px] font-medium text-slate-700 dark:text-slate-200">No replay events found</p>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-gdc-muted">Try a wider time range or adjust filters.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200/90 bg-white dark:border-gdc-border dark:bg-gdc-card">
          <table className={opTable} data-testid="replay-table">
            <thead>
              <tr className={opThRow}>
                {!readOnly ? (
                  <th className={opTh}>
                    <input
                      type="checkbox"
                      checked={allLoadedSelected}
                      disabled={actionLoading || retryableLoaded.length === 0}
                      onChange={toggleSelectLoaded}
                      aria-label="Select loaded retryable"
                      title="Select all retryable rows currently loaded (not the full filtered result)"
                      data-testid="replay-select-all"
                    />
                    <span className="sr-only">Select loaded</span>
                  </th>
                ) : null}
                <th className={opTh}>Replay ID</th>
                <th className={opTh}>Policy</th>
                <th className={opTh}>Stream</th>
                <th className={opTh}>Status</th>
                <th className={opTh}>Created At</th>
                <th className={opTh}>Completed At</th>
                <th className={opTh}>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className={opTr}>
                  <td className={opTd} colSpan={readOnly ? 7 : 8}>
                    <Loader2 className="inline h-4 w-4 animate-spin" aria-hidden /> Loading…
                  </td>
                </tr>
              ) : (
                events.map((entry) => (
                  <tr
                    key={entry.id}
                    className={cn(opTr, 'cursor-pointer hover:bg-slate-50 dark:hover:bg-gdc-rowHover')}
                    data-testid={`replay-row-${entry.id}`}
                    onClick={() => void openDetail(entry.id)}
                  >
                    {!readOnly ? (
                      <td className={opTd} onClick={(e) => e.stopPropagation()}>
                        {isReplayRetryable(entry) ? (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(entry.id)}
                            disabled={actionLoading}
                            onChange={() => toggleSelect(entry.id)}
                            aria-label={`Select replay ${entry.id}`}
                            data-testid={`replay-select-${entry.id}`}
                          />
                        ) : null}
                      </td>
                    ) : null}
                    <td className={opTd}>#{entry.id}</td>
                    <td className={opTd}>{entry.policy_name}</td>
                    <td className={opTd}>{entry.stream_name}</td>
                    <td className={opTd}>
                      <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold', statusBadgeClass(entry.status))}>
                        {entry.status}
                      </span>
                    </td>
                    <td className={opTd}>{formatTime(entry.created_at)}</td>
                    <td className={opTd}>{formatTime(entry.completed_at)}</td>
                    <td className={opTd}>{entry.outcome ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {!readOnly && retryableLoaded.length > 0 ? (
            <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500 dark:border-gdc-border dark:text-gdc-muted" data-testid="replay-select-scope-hint">
              Select loaded: selects retryable rows in this list only ({retryableLoaded.length} retryable of {events.length}{' '}
              loaded). Does not select the full filtered result ({filteredTotal}).
            </p>
          ) : null}
        </div>
      )}

      {drawerId != null ? (
        <ReplayDetailDrawer
          detail={detail}
          loading={detailLoading}
          actionLoading={actionLoading}
          readOnly={readOnly}
          onClose={closeDetail}
          onExecute={() => setExecuteConfirmIds(dedupeReplayIds([drawerId]))}
        />
      ) : null}

      <DangerousActionDialog
        open={executeConfirmIds != null && executeConfirmIds.length > 0}
        title={executeConfirmIds && executeConfirmIds.length > 1 ? 'Execute selected replays?' : 'Execute replay?'}
        environmentLabel={env.label}
        description="Selected replay events will be re-delivered to their destinations. Confirm the scope before continuing."
        impactItems={
          executeConfirmIds
            ? buildReplayImpact(confirmEntries, window, {
                selectedCount: dedupeReplayIds(executeConfirmIds).length,
                selectionScope: REPLAY_SELECTION_SCOPE,
              })
            : []
        }
        confirmLabel={executeConfirmIds && executeConfirmIds.length > 1 ? 'Execute selected' : 'Execute replay'}
        confirmTone="warning"
        busy={actionLoading}
        onCancel={() => {
          if (!actionLoading) setExecuteConfirmIds(null)
        }}
        onConfirm={() => {
          const ids = dedupeReplayIds(executeConfirmIds ?? [])
          if (!ids.length || actionLoading) return
          void runExecute(ids).finally(() => setExecuteConfirmIds(null))
        }}
        testId="replay-execute-confirm-dialog"
      />
    </div>
  )
}
