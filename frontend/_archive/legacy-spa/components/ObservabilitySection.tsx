import type { Dispatch, SetStateAction } from 'react'
import { useMemo, useState } from 'react'
import { JsonBlock, RowsTable, StatGrid } from '../observabilityUi'
import type { ApiState, AppSection, ObsApiKey } from '../runtimeTypes'
import { RUNTIME_MESSAGES } from '../utils/runtimeMessages'
import { buildTimelineCards, filterTimelineCards } from '../utils/runtimeTimeline'
import {
  buildObservabilityOperatorCards,
  formatLogsCleanupAtAGlance,
  isObservabilitySection,
} from '../utils/observabilityDashboard'
import { RuntimeMessage, RuntimeRequestStatus } from './runtime/RuntimeAlert'

export type ObservabilitySectionProps = {
  activeSection: AppSection
  obsApi: Record<ObsApiKey, ApiState>
  dashboard: {
    limit: string
    setLimit: Dispatch<SetStateAction<string>>
    onLoad: () => void
    summary: Record<string, unknown> | null
    problems: unknown[]
    rateLimited: unknown[]
    unhealthy: unknown[]
  }
  health: {
    limit: string
    setLimit: Dispatch<SetStateAction<string>>
    onLoad: () => void
    healthRec: Record<string, unknown> | null
    summary: Record<string, unknown> | null
    routes: unknown[]
  }
  stats: {
    limit: string
    setLimit: Dispatch<SetStateAction<string>>
    onLoad: () => void
    statsRec: Record<string, unknown> | null
    summary: Record<string, unknown> | null
    routes: unknown[]
    recentLogs: unknown[]
  }
  timeline: {
    limit: string
    setLimit: Dispatch<SetStateAction<string>>
    stage: string
    setStage: Dispatch<SetStateAction<string>>
    level: string
    setLevel: Dispatch<SetStateAction<string>>
    status: string
    setStatus: Dispatch<SetStateAction<string>>
    routeIdFilter: string
    setRouteIdFilter: Dispatch<SetStateAction<string>>
    destinationIdFilter: string
    setDestinationIdFilter: Dispatch<SetStateAction<string>>
    onLoad: () => void
    timelineRec: Record<string, unknown> | null
    items: unknown[]
  }
  logs: {
    search: {
      streamId: string
      setStreamId: Dispatch<SetStateAction<string>>
      routeId: string
      setRouteId: Dispatch<SetStateAction<string>>
      destinationId: string
      setDestinationId: Dispatch<SetStateAction<string>>
      stage: string
      setStage: Dispatch<SetStateAction<string>>
      level: string
      setLevel: Dispatch<SetStateAction<string>>
      status: string
      setStatus: Dispatch<SetStateAction<string>>
      errorCode: string
      setErrorCode: Dispatch<SetStateAction<string>>
      limit: string
      setLimit: Dispatch<SetStateAction<string>>
      onSearch: () => void
      searchRec: Record<string, unknown> | null
      rows: unknown[]
    }
    page: {
      limit: string
      setLimit: Dispatch<SetStateAction<string>>
      cursorAt: string
      setCursorAt: Dispatch<SetStateAction<string>>
      cursorId: string
      setCursorId: Dispatch<SetStateAction<string>>
      streamId: string
      setStreamId: Dispatch<SetStateAction<string>>
      routeId: string
      setRouteId: Dispatch<SetStateAction<string>>
      destinationId: string
      setDestinationId: Dispatch<SetStateAction<string>>
      stage: string
      setStage: Dispatch<SetStateAction<string>>
      level: string
      setLevel: Dispatch<SetStateAction<string>>
      status: string
      setStatus: Dispatch<SetStateAction<string>>
      errorCode: string
      setErrorCode: Dispatch<SetStateAction<string>>
      onLoadPage: () => void
      onNextPage: () => void
      pageRec: Record<string, unknown> | null
      hasNext: boolean
      nextAt: unknown
      nextId: unknown
      items: unknown[]
    }
    cleanup: {
      olderThanDays: string
      setOlderThanDays: Dispatch<SetStateAction<string>>
      dryRun: boolean
      setDryRun: Dispatch<SetStateAction<boolean>>
      onCleanup: () => void
      result: unknown
    }
  }
  failureTrend: {
    limit: string
    setLimit: Dispatch<SetStateAction<string>>
    streamId: string
    setStreamId: Dispatch<SetStateAction<string>>
    routeId: string
    setRouteId: Dispatch<SetStateAction<string>>
    destinationId: string
    setDestinationId: Dispatch<SetStateAction<string>>
    onLoad: () => void
    trendRec: Record<string, unknown> | null
    buckets: unknown[]
  }
}

export function ObservabilitySection(p: ObservabilitySectionProps) {
  const { obsApi } = p
  const [timelineLocalStage, setTimelineLocalStage] = useState('')
  const [timelineLocalLevelStatus, setTimelineLocalLevelStatus] = useState('')
  const [timelineLocalEntity, setTimelineLocalEntity] = useState('')

  const operatorCards = useMemo(
    () =>
      buildObservabilityOperatorCards({
        dashboardSummary: p.dashboard.summary,
        dashboardProblemsLen: p.dashboard.problems.length,
        dashboardRateLimitedLen: p.dashboard.rateLimited.length,
        dashboardUnhealthyLen: p.dashboard.unhealthy.length,
        healthRec: p.health.healthRec,
        healthSummary: p.health.summary,
        statsRec: p.stats.statsRec,
        statsRecentLogsLen: p.stats.recentLogs.length,
        statsSummary: p.stats.summary,
        timelineRec: p.timeline.timelineRec,
        timelineItemsLen: p.timeline.items.length,
        logSearchRec: p.logs.search.searchRec,
        logSearchRowsLen: p.logs.search.rows.length,
        logPageRec: p.logs.page.pageRec,
        logPageItemsLen: p.logs.page.items.length,
        trendRec: p.failureTrend.trendRec,
        trendBucketsLen: p.failureTrend.buckets.length,
      }),
    [
      p.dashboard.summary,
      p.dashboard.problems,
      p.dashboard.rateLimited,
      p.dashboard.unhealthy,
      p.health.healthRec,
      p.health.summary,
      p.stats.statsRec,
      p.stats.recentLogs,
      p.stats.summary,
      p.timeline.timelineRec,
      p.timeline.items,
      p.logs.search.searchRec,
      p.logs.search.rows,
      p.logs.page.pageRec,
      p.logs.page.items,
      p.failureTrend.trendRec,
      p.failureTrend.buckets,
    ],
  )

  const cleanupGlanceLine = formatLogsCleanupAtAGlance(p.logs.cleanup.result, p.logs.cleanup.dryRun)
  const timelineCards = useMemo(() => buildTimelineCards(p.timeline.items as unknown[]), [p.timeline.items])
  const filteredTimelineCards = useMemo(
    () =>
      filterTimelineCards(timelineCards, {
        stage: timelineLocalStage,
        levelStatus: timelineLocalLevelStatus,
        streamRouteDestination: timelineLocalEntity,
      }),
    [timelineCards, timelineLocalEntity, timelineLocalLevelStatus, timelineLocalStage],
  )

  const cleanupMatchedZero =
    p.logs.cleanup.result !== null &&
    typeof p.logs.cleanup.result === 'object' &&
    !Array.isArray(p.logs.cleanup.result) &&
    (p.logs.cleanup.result as Record<string, unknown>).matched_count === 0

  return (
    <>
      {isObservabilitySection(p.activeSection) && (
        <section
          className="panel obs-operator-overview panel-scroll"
          role="region"
          aria-label={RUNTIME_MESSAGES.observabilityGuideRegionLabel}
        >
          <RuntimeMessage tone="obs-hint" as="div" className="obs-investigation-guide">
            {RUNTIME_MESSAGES.observabilityInvestigationGuide}
          </RuntimeMessage>
          <div className="obs-dashboard-cards" role="list">
            {operatorCards.map((c) => (
              <article key={c.id} className="obs-dash-card" role="listitem">
                <h3 className="obs-dash-card-title">{c.title}</h3>
                <p className="obs-dash-card-value">{c.value}</p>
                {c.detail ? <p className="obs-dash-card-detail muted">{c.detail}</p> : null}
              </article>
            ))}
          </div>
          <div className="obs-cleanup-at-a-glance" aria-label={RUNTIME_MESSAGES.observabilityCleanupGlanceLabel}>
            <strong className="obs-cleanup-at-a-glance-label">Logs cleanup (last result)</strong>
            <p className="obs-cleanup-at-a-glance-body">
              {cleanupGlanceLine || RUNTIME_MESSAGES.observabilityCleanupNoRunYet}
            </p>
          </div>
        </section>
      )}

      {p.activeSection === 'dashboard' && (
        <section className="panel obs-panel panel-scroll">
          <h2>Dashboard summary</h2>
          <RuntimeMessage tone="obs-hint">GET /api/v1/runtime/dashboard/summary</RuntimeMessage>
          <div className="obs-controls">
            <label className="inline-field">
              limit
              <input value={p.dashboard.limit} onChange={(e) => p.dashboard.setLimit(e.target.value)} />
            </label>
            <button type="button" disabled={obsApi.dashboard.loading} onClick={p.dashboard.onLoad}>
              Load dashboard summary
            </button>
          </div>
          <RuntimeRequestStatus
            loading={obsApi.dashboard.loading}
            success={obsApi.dashboard.success}
            error={obsApi.dashboard.error}
          />
          {!obsApi.dashboard.loading && !obsApi.dashboard.error && !p.dashboard.summary && (
            <RuntimeMessage tone="obs-empty">No dashboard data loaded yet.</RuntimeMessage>
          )}
          <StatGrid title="summary (aggregate counts)" data={p.dashboard.summary} />
          <RowsTable title="recent_problem_routes" rows={p.dashboard.problems as unknown[]} />
          <RowsTable title="recent_rate_limited_routes" rows={p.dashboard.rateLimited as unknown[]} />
          <RowsTable title="recent_unhealthy_streams" rows={p.dashboard.unhealthy as unknown[]} />
        </section>
      )}

      {p.activeSection === 'health' && (
        <section className="panel obs-panel panel-scroll">
          <h2>Stream health</h2>
          <RuntimeMessage tone="obs-hint">
            {'GET /api/v1/runtime/health/stream/{stream_id} — uses stream_id above'}
          </RuntimeMessage>
          <div className="obs-controls">
            <label className="inline-field">
              limit
              <input value={p.health.limit} onChange={(e) => p.health.setLimit(e.target.value)} />
            </label>
            <button type="button" disabled={obsApi.health.loading} onClick={p.health.onLoad}>
              Load stream health
            </button>
          </div>
          <RuntimeRequestStatus
            loading={obsApi.health.loading}
            success={obsApi.health.success}
            error={obsApi.health.error}
          />
          {!obsApi.health.loading && !obsApi.health.error && !p.health.healthRec && (
            <RuntimeMessage tone="obs-empty">No stream status loaded yet.</RuntimeMessage>
          )}
          {p.health.healthRec && (
            <StatGrid
              title="stream"
              data={{
                stream_id: p.health.healthRec.stream_id as unknown as number,
                stream_status: String(p.health.healthRec.stream_status ?? ''),
                health: String(p.health.healthRec.health ?? ''),
                limit: p.health.healthRec.limit as unknown as number,
              }}
            />
          )}
          <StatGrid title="route summary counts" data={p.health.summary} />
          <RowsTable title="routes" rows={p.health.routes as unknown[]} />
        </section>
      )}

      {p.activeSection === 'stats' && (
        <section className="panel obs-panel panel-scroll">
          <h2>Stream stats</h2>
          <RuntimeMessage tone="obs-hint">
            {'GET /api/v1/runtime/stats/stream/{stream_id} — uses stream_id above'}
          </RuntimeMessage>
          <div className="obs-controls">
            <label className="inline-field">
              limit
              <input value={p.stats.limit} onChange={(e) => p.stats.setLimit(e.target.value)} />
            </label>
            <button type="button" disabled={obsApi.stats.loading} onClick={p.stats.onLoad}>
              Load stream stats
            </button>
          </div>
          <RuntimeRequestStatus
            loading={obsApi.stats.loading}
            success={obsApi.stats.success}
            error={obsApi.stats.error}
          />
          {!obsApi.stats.loading && !obsApi.stats.error && !p.stats.statsRec && (
            <RuntimeMessage tone="obs-empty">No stream statistics loaded yet.</RuntimeMessage>
          )}
          {p.stats.statsRec && (
            <StatGrid
              title="stream"
              data={{
                stream_id: p.stats.statsRec.stream_id as unknown as number,
                stream_status: String(p.stats.statsRec.stream_status ?? ''),
              }}
            />
          )}
          <JsonBlock title="checkpoint" value={p.stats.statsRec?.checkpoint ?? null} />
          <StatGrid title="summary (stage counts)" data={p.stats.summary} />
          <JsonBlock title="last_seen" value={p.stats.statsRec?.last_seen ?? null} />
          <RowsTable title="routes" rows={p.stats.routes as unknown[]} />
          {p.stats.statsRec && p.stats.recentLogs.length === 0 && (
            <RuntimeMessage tone="obs-empty">{RUNTIME_MESSAGES.observabilityEmptyStatsRecentLogs}</RuntimeMessage>
          )}
          <RowsTable title="recent_logs" rows={p.stats.recentLogs as unknown[]} />
        </section>
      )}

      {p.activeSection === 'timeline' && (
        <section className="panel obs-panel panel-scroll">
          <h2>Timeline</h2>
          <RuntimeMessage tone="obs-hint">
            {'GET /api/v1/runtime/timeline/stream/{stream_id} — uses stream_id above'}
          </RuntimeMessage>
          <div className="obs-controls obs-controls-grid">
            <label className="inline-field">
              limit
              <input value={p.timeline.limit} onChange={(e) => p.timeline.setLimit(e.target.value)} />
            </label>
            <label className="inline-field">
              stage
              <input value={p.timeline.stage} onChange={(e) => p.timeline.setStage(e.target.value)} />
            </label>
            <label className="inline-field">
              level
              <input value={p.timeline.level} onChange={(e) => p.timeline.setLevel(e.target.value)} />
            </label>
            <label className="inline-field">
              status
              <input value={p.timeline.status} onChange={(e) => p.timeline.setStatus(e.target.value)} />
            </label>
            <label className="inline-field">
              timeline route_id
              <input value={p.timeline.routeIdFilter} onChange={(e) => p.timeline.setRouteIdFilter(e.target.value)} />
            </label>
            <label className="inline-field">
              timeline destination_id
              <input value={p.timeline.destinationIdFilter} onChange={(e) => p.timeline.setDestinationIdFilter(e.target.value)} />
            </label>
            <button type="button" disabled={obsApi.timeline.loading} onClick={p.timeline.onLoad}>
              Load timeline
            </button>
          </div>
          <section className="obs-timeline-guidance" aria-label="Timeline operator guidance">
            <ul className="obs-timeline-guidance-list">
              <li>{RUNTIME_MESSAGES.timelineOperatorGuidanceDeliveryLogs}</li>
              <li>{RUNTIME_MESSAGES.timelineOperatorGuidanceRunFailed}</li>
              <li>{RUNTIME_MESSAGES.timelineOperatorGuidanceCheckpoint}</li>
              <li>{RUNTIME_MESSAGES.timelineOperatorGuidanceCrossCheck}</li>
            </ul>
          </section>
          <div className="obs-controls obs-controls-grid">
            <label className="inline-field">
              {RUNTIME_MESSAGES.timelineLocalFilterStageLabel}
              <input value={timelineLocalStage} onChange={(e) => setTimelineLocalStage(e.target.value)} />
            </label>
            <label className="inline-field">
              {RUNTIME_MESSAGES.timelineLocalFilterLevelStatusLabel}
              <input value={timelineLocalLevelStatus} onChange={(e) => setTimelineLocalLevelStatus(e.target.value)} />
            </label>
            <label className="inline-field">
              {RUNTIME_MESSAGES.timelineLocalFilterEntityLabel}
              <input value={timelineLocalEntity} onChange={(e) => setTimelineLocalEntity(e.target.value)} />
            </label>
            <button
              type="button"
              onClick={() => {
                setTimelineLocalStage('')
                setTimelineLocalLevelStatus('')
                setTimelineLocalEntity('')
              }}
            >
              {RUNTIME_MESSAGES.timelineLocalFilterClear}
            </button>
          </div>
          <RuntimeRequestStatus
            loading={obsApi.timeline.loading}
            success={obsApi.timeline.success}
            error={obsApi.timeline.error}
          />
          {!obsApi.timeline.loading && !obsApi.timeline.error && !p.timeline.timelineRec && (
            <RuntimeMessage tone="obs-empty">No timeline loaded yet.</RuntimeMessage>
          )}
          {p.timeline.timelineRec && (
            <StatGrid
              title="timeline meta"
              data={{
                stream_id: p.timeline.timelineRec.stream_id as unknown as number,
                total: p.timeline.timelineRec.total as unknown as number,
              }}
            />
          )}
          {p.timeline.timelineRec && p.timeline.items.length === 0 && (
            <RuntimeMessage tone="obs-empty">{RUNTIME_MESSAGES.observabilityEmptyTimelineDetailed}</RuntimeMessage>
          )}
          {p.timeline.timelineRec && timelineCards.length > 0 && filteredTimelineCards.length === 0 && (
            <RuntimeMessage tone="obs-empty">{RUNTIME_MESSAGES.timelineEmptyFiltered}</RuntimeMessage>
          )}
          {filteredTimelineCards.length > 0 && (
            <section className="obs-timeline-cards" aria-label="Timeline execution cards">
              {filteredTimelineCards.map((row) => (
                <article key={row.id} className="obs-timeline-card">
                  <header className="obs-timeline-card-header">
                    <p className="obs-timeline-ts">{row.timestamp}</p>
                    <div className="obs-timeline-badges">
                      <span className="obs-badge obs-badge-stage">{row.stage}</span>
                      <span className="obs-badge obs-badge-level">{row.level}</span>
                      <span className="obs-badge obs-badge-status">{row.status}</span>
                    </div>
                  </header>
                  <p className="obs-timeline-message">{row.message}</p>
                  <p className="obs-timeline-ids">
                    {row.streamId && <span>stream_id={row.streamId}</span>}
                    {row.routeId && <span>route_id={row.routeId}</span>}
                    {row.destinationId && <span>destination_id={row.destinationId}</span>}
                  </p>
                  <p className="obs-timeline-meta">
                    {row.errorCode && <span>error_code={row.errorCode}</span>}
                    {row.httpStatus && <span>http_status={row.httpStatus}</span>}
                    {row.retryCount && <span>retry_count={row.retryCount}</span>}
                  </p>
                  {row.payloadSample && (
                    <details>
                      <summary>payload_sample</summary>
                      <pre className="obs-json">{row.payloadSample}</pre>
                    </details>
                  )}
                </article>
              ))}
            </section>
          )}
          <RowsTable title="items (API order)" rows={p.timeline.items as unknown[]} />
        </section>
      )}

      {p.activeSection === 'logs' && (
        <section className="panel obs-panel panel-scroll">
          <div className="logs-read-zone">
            <h2>Logs — search</h2>
            <RuntimeMessage tone="obs-hint">GET /api/v1/runtime/logs/search</RuntimeMessage>
            <div className="obs-controls obs-controls-grid">
              <label className="inline-field">
                search stream_id
                <input value={p.logs.search.streamId} onChange={(e) => p.logs.search.setStreamId(e.target.value)} />
              </label>
              <label className="inline-field">
                search route_id
                <input value={p.logs.search.routeId} onChange={(e) => p.logs.search.setRouteId(e.target.value)} />
              </label>
              <label className="inline-field">
                search destination_id
                <input value={p.logs.search.destinationId} onChange={(e) => p.logs.search.setDestinationId(e.target.value)} />
              </label>
              <label className="inline-field">
                stage
                <input value={p.logs.search.stage} onChange={(e) => p.logs.search.setStage(e.target.value)} />
              </label>
              <label className="inline-field">
                level
                <input value={p.logs.search.level} onChange={(e) => p.logs.search.setLevel(e.target.value)} />
              </label>
              <label className="inline-field">
                status
                <input value={p.logs.search.status} onChange={(e) => p.logs.search.setStatus(e.target.value)} />
              </label>
              <label className="inline-field">
                error_code
                <input value={p.logs.search.errorCode} onChange={(e) => p.logs.search.setErrorCode(e.target.value)} />
              </label>
              <label className="inline-field">
                search limit
                <input value={p.logs.search.limit} onChange={(e) => p.logs.search.setLimit(e.target.value)} />
              </label>
              <button type="button" disabled={obsApi.logsSearch.loading} onClick={p.logs.search.onSearch}>
                Search logs
              </button>
            </div>
            <RuntimeRequestStatus
              loading={obsApi.logsSearch.loading}
              success={obsApi.logsSearch.success}
              error={obsApi.logsSearch.error}
            />
            {!obsApi.logsSearch.loading && !obsApi.logsSearch.error && !p.logs.search.searchRec && (
              <RuntimeMessage tone="obs-empty">No log search results yet.</RuntimeMessage>
            )}
            {p.logs.search.searchRec && (
              <StatGrid
                title="search meta"
                data={{
                  total_returned: p.logs.search.searchRec.total_returned as unknown as number,
                }}
              />
            )}
            <JsonBlock title="filters (echo)" value={p.logs.search.searchRec?.filters ?? null} />
            {p.logs.search.searchRec && p.logs.search.rows.length === 0 && (
              <RuntimeMessage tone="obs-empty">{RUNTIME_MESSAGES.observabilityEmptyLogsSearchDetailed}</RuntimeMessage>
            )}
            <RowsTable title="logs" rows={p.logs.search.rows as unknown[]} />
          </div>

          <hr className="obs-divider" />

          <div className="logs-read-zone">
            <h2>Logs — page (cursor)</h2>
            <RuntimeMessage tone="obs-hint">GET /api/v1/runtime/logs/page</RuntimeMessage>
            <div className="obs-controls obs-controls-grid">
              <label className="inline-field">
                page limit
                <input value={p.logs.page.limit} onChange={(e) => p.logs.page.setLimit(e.target.value)} />
              </label>
              <label className="inline-field">
                cursor_created_at
                <input
                  value={p.logs.page.cursorAt}
                  onChange={(e) => p.logs.page.setCursorAt(e.target.value)}
                  placeholder="ISO datetime"
                />
              </label>
              <label className="inline-field">
                cursor_id
                <input value={p.logs.page.cursorId} onChange={(e) => p.logs.page.setCursorId(e.target.value)} />
              </label>
              <label className="inline-field">
                page stream_id
                <input value={p.logs.page.streamId} onChange={(e) => p.logs.page.setStreamId(e.target.value)} />
              </label>
              <label className="inline-field">
                page route_id
                <input value={p.logs.page.routeId} onChange={(e) => p.logs.page.setRouteId(e.target.value)} />
              </label>
              <label className="inline-field">
                page destination_id
                <input value={p.logs.page.destinationId} onChange={(e) => p.logs.page.setDestinationId(e.target.value)} />
              </label>
              <label className="inline-field">
                stage
                <input value={p.logs.page.stage} onChange={(e) => p.logs.page.setStage(e.target.value)} />
              </label>
              <label className="inline-field">
                level
                <input value={p.logs.page.level} onChange={(e) => p.logs.page.setLevel(e.target.value)} />
              </label>
              <label className="inline-field">
                status
                <input value={p.logs.page.status} onChange={(e) => p.logs.page.setStatus(e.target.value)} />
              </label>
              <label className="inline-field">
                error_code
                <input value={p.logs.page.errorCode} onChange={(e) => p.logs.page.setErrorCode(e.target.value)} />
              </label>
              <button type="button" disabled={obsApi.logsPage.loading} onClick={p.logs.page.onLoadPage}>
                Load log page
              </button>
              <button
                type="button"
                disabled={obsApi.logsPage.loading || !p.logs.page.hasNext}
                onClick={p.logs.page.onNextPage}
              >
                Load next page (uses response cursor)
              </button>
            </div>
            <RuntimeRequestStatus
              loading={obsApi.logsPage.loading}
              success={obsApi.logsPage.success}
              error={obsApi.logsPage.error}
            />
            <RuntimeMessage tone="obs-hint">
              current cursor: {p.logs.page.cursorAt.trim() || '—'} / {p.logs.page.cursorId.trim() || '—'}
            </RuntimeMessage>
            {!obsApi.logsPage.loading && !obsApi.logsPage.error && !p.logs.page.pageRec && (
              <RuntimeMessage tone="obs-empty">No page results yet.</RuntimeMessage>
            )}
            {p.logs.page.pageRec && (
              <StatGrid
                title="page meta"
                data={{
                  total_returned: p.logs.page.pageRec.total_returned as unknown as number,
                  has_next: p.logs.page.hasNext,
                  next_cursor_created_at:
                    p.logs.page.nextAt === undefined || p.logs.page.nextAt === null ? '—' : String(p.logs.page.nextAt),
                  next_cursor_id: p.logs.page.nextId === undefined || p.logs.page.nextId === null ? '—' : String(p.logs.page.nextId),
                }}
              />
            )}
            {p.logs.page.pageRec && p.logs.page.items.length === 0 && (
              <RuntimeMessage tone="obs-empty">{RUNTIME_MESSAGES.observabilityEmptyLogsPageDetailed}</RuntimeMessage>
            )}
            <RowsTable title="items" rows={p.logs.page.items as unknown[]} />
          </div>

          <hr className="obs-divider" />

          <div className="logs-cleanup-zone">
            <h2>Logs — cleanup</h2>
            <RuntimeMessage tone="obs-hint">
              POST /api/v1/runtime/logs/cleanup — destructive when dry_run is off; separate from read/search above.
            </RuntimeMessage>
            <div className="obs-controls">
              <label className="inline-field">
                older_than_days
                <input value={p.logs.cleanup.olderThanDays} onChange={(e) => p.logs.cleanup.setOlderThanDays(e.target.value)} />
              </label>
              <label className="inline-field checkbox-field">
                <input type="checkbox" checked={p.logs.cleanup.dryRun} onChange={(e) => p.logs.cleanup.setDryRun(e.target.checked)} />
                {p.logs.cleanup.dryRun
                  ? 'dry_run ON (safe mode, no delete)'
                  : 'dry_run OFF (destructive mode, deletes rows)'}
              </label>
              <button type="button" className="danger" disabled={obsApi.logsCleanup.loading} onClick={p.logs.cleanup.onCleanup}>
                {p.logs.cleanup.dryRun ? 'Run logs cleanup (dry-run)' : 'Run logs cleanup (DESTRUCTIVE)'}
              </button>
            </div>
            <RuntimeRequestStatus
              loading={obsApi.logsCleanup.loading}
              success={obsApi.logsCleanup.success}
              error={obsApi.logsCleanup.error}
            />
            <JsonBlock title="cleanup response" value={p.logs.cleanup.result} />
            {cleanupMatchedZero && (
              <RuntimeMessage tone="obs-empty">{RUNTIME_MESSAGES.observabilityEmptyCleanupNoCandidates}</RuntimeMessage>
            )}
          </div>
        </section>
      )}

      {p.activeSection === 'failureTrend' && (
        <section className="panel obs-panel panel-scroll">
          <h2>Failure trend</h2>
          <RuntimeMessage tone="obs-hint">GET /api/v1/runtime/failures/trend</RuntimeMessage>
          <div className="obs-controls obs-controls-grid">
            <label className="inline-field">
              limit
              <input value={p.failureTrend.limit} onChange={(e) => p.failureTrend.setLimit(e.target.value)} />
            </label>
            <label className="inline-field">
              trend stream_id
              <input value={p.failureTrend.streamId} onChange={(e) => p.failureTrend.setStreamId(e.target.value)} />
            </label>
            <label className="inline-field">
              trend route_id
              <input value={p.failureTrend.routeId} onChange={(e) => p.failureTrend.setRouteId(e.target.value)} />
            </label>
            <label className="inline-field">
              trend destination_id
              <input value={p.failureTrend.destinationId} onChange={(e) => p.failureTrend.setDestinationId(e.target.value)} />
            </label>
            <button type="button" disabled={obsApi.failureTrend.loading} onClick={p.failureTrend.onLoad}>
              Load failure trend
            </button>
          </div>
          <RuntimeRequestStatus
            loading={obsApi.failureTrend.loading}
            success={obsApi.failureTrend.success}
            error={obsApi.failureTrend.error}
          />
          {!obsApi.failureTrend.loading && !obsApi.failureTrend.error && !p.failureTrend.trendRec && (
            <RuntimeMessage tone="obs-empty">No failure trend results yet.</RuntimeMessage>
          )}
          {p.failureTrend.trendRec && (
            <StatGrid title="totals" data={{ total: p.failureTrend.trendRec.total as unknown as number }} />
          )}
          {p.failureTrend.trendRec && p.failureTrend.buckets.length === 0 && (
            <RuntimeMessage tone="obs-empty">{RUNTIME_MESSAGES.observabilityEmptyFailureTrendDetailed}</RuntimeMessage>
          )}
          <RowsTable title="buckets" rows={p.failureTrend.buckets as unknown[]} />
        </section>
      )}
    </>
  )
}
