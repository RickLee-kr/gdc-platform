import type { Dispatch, SetStateAction } from 'react'
import { JsonBlock, RowsTable, StatGrid } from '../observabilityUi'
import type { ApiState, AppSection, ObsApiKey } from '../runtimeTypes'

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

  return (
    <>
      {p.activeSection === 'dashboard' && (
        <section className="panel obs-panel panel-scroll">
          <h2>Dashboard summary</h2>
          <p className="muted obs-hint">GET /api/v1/runtime/dashboard/summary</p>
          <div className="obs-controls">
            <label className="inline-field">
              limit
              <input value={p.dashboard.limit} onChange={(e) => p.dashboard.setLimit(e.target.value)} />
            </label>
            <button type="button" disabled={obsApi.dashboard.loading} onClick={p.dashboard.onLoad}>
              Load dashboard summary
            </button>
          </div>
          <div className="status">
            {obsApi.dashboard.loading && <span className="loading">로딩 중...</span>}
            {obsApi.dashboard.success && <span className="success">{obsApi.dashboard.success}</span>}
            {obsApi.dashboard.error && <pre className="error">{obsApi.dashboard.error}</pre>}
          </div>
          {!obsApi.dashboard.loading && !obsApi.dashboard.error && !p.dashboard.summary && (
            <p className="muted obs-empty">아직 로드된 대시보드 데이터가 없습니다.</p>
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
          <p className="muted obs-hint">
            {'GET /api/v1/runtime/health/stream/{stream_id} — uses stream_id above'}
          </p>
          <div className="obs-controls">
            <label className="inline-field">
              limit
              <input value={p.health.limit} onChange={(e) => p.health.setLimit(e.target.value)} />
            </label>
            <button type="button" disabled={obsApi.health.loading} onClick={p.health.onLoad}>
              Load stream health
            </button>
          </div>
          <div className="status">
            {obsApi.health.loading && <span className="loading">로딩 중...</span>}
            {obsApi.health.success && <span className="success">{obsApi.health.success}</span>}
            {obsApi.health.error && <pre className="error">{obsApi.health.error}</pre>}
          </div>
          {!obsApi.health.loading && !obsApi.health.error && !p.health.healthRec && (
            <p className="muted obs-empty">아직 로드된 스트림 상태가 없습니다.</p>
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
          <p className="muted obs-hint">
            {'GET /api/v1/runtime/stats/stream/{stream_id} — uses stream_id above'}
          </p>
          <div className="obs-controls">
            <label className="inline-field">
              limit
              <input value={p.stats.limit} onChange={(e) => p.stats.setLimit(e.target.value)} />
            </label>
            <button type="button" disabled={obsApi.stats.loading} onClick={p.stats.onLoad}>
              Load stream stats
            </button>
          </div>
          <div className="status">
            {obsApi.stats.loading && <span className="loading">로딩 중...</span>}
            {obsApi.stats.success && <span className="success">{obsApi.stats.success}</span>}
            {obsApi.stats.error && <pre className="error">{obsApi.stats.error}</pre>}
          </div>
          {!obsApi.stats.loading && !obsApi.stats.error && !p.stats.statsRec && (
            <p className="muted obs-empty">아직 로드된 스트림 통계가 없습니다.</p>
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
          <RowsTable title="recent_logs" rows={p.stats.recentLogs as unknown[]} />
        </section>
      )}

      {p.activeSection === 'timeline' && (
        <section className="panel obs-panel panel-scroll">
          <h2>Timeline</h2>
          <p className="muted obs-hint">
            {'GET /api/v1/runtime/timeline/stream/{stream_id} — uses stream_id above'}
          </p>
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
          <div className="status">
            {obsApi.timeline.loading && <span className="loading">로딩 중...</span>}
            {obsApi.timeline.success && <span className="success">{obsApi.timeline.success}</span>}
            {obsApi.timeline.error && <pre className="error">{obsApi.timeline.error}</pre>}
          </div>
          {!obsApi.timeline.loading && !obsApi.timeline.error && !p.timeline.timelineRec && (
            <p className="muted obs-empty">아직 로드된 타임라인이 없습니다.</p>
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
          <RowsTable title="items (API order)" rows={p.timeline.items as unknown[]} />
        </section>
      )}

      {p.activeSection === 'logs' && (
        <section className="panel obs-panel panel-scroll">
          <div className="logs-read-zone">
            <h2>Logs — search</h2>
            <p className="muted obs-hint">GET /api/v1/runtime/logs/search</p>
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
            <div className="status">
              {obsApi.logsSearch.loading && <span className="loading">로딩 중...</span>}
              {obsApi.logsSearch.success && <span className="success">{obsApi.logsSearch.success}</span>}
              {obsApi.logsSearch.error && <pre className="error">{obsApi.logsSearch.error}</pre>}
            </div>
            {!obsApi.logsSearch.loading && !obsApi.logsSearch.error && !p.logs.search.searchRec && (
              <p className="muted obs-empty">아직 로그 검색 결과가 없습니다.</p>
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
            <RowsTable title="logs" rows={p.logs.search.rows as unknown[]} />
          </div>

          <hr className="obs-divider" />

          <div className="logs-read-zone">
            <h2>Logs — page (cursor)</h2>
            <p className="muted obs-hint">GET /api/v1/runtime/logs/page</p>
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
            <div className="status">
              {obsApi.logsPage.loading && <span className="loading">로딩 중...</span>}
              {obsApi.logsPage.success && <span className="success">{obsApi.logsPage.success}</span>}
              {obsApi.logsPage.error && <pre className="error">{obsApi.logsPage.error}</pre>}
            </div>
            <p className="muted obs-hint">
              current cursor: {p.logs.page.cursorAt.trim() || '—'} / {p.logs.page.cursorId.trim() || '—'}
            </p>
            {!obsApi.logsPage.loading && !obsApi.logsPage.error && !p.logs.page.pageRec && (
              <p className="muted obs-empty">아직 페이지 조회 결과가 없습니다.</p>
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
            <RowsTable title="items" rows={p.logs.page.items as unknown[]} />
          </div>

          <hr className="obs-divider" />

          <div className="logs-cleanup-zone">
            <h2>Logs — cleanup</h2>
            <p className="muted obs-hint">
              POST /api/v1/runtime/logs/cleanup — destructive when dry_run is off; separate from read/search above.
            </p>
            <div className="obs-controls">
              <label className="inline-field">
                older_than_days
                <input value={p.logs.cleanup.olderThanDays} onChange={(e) => p.logs.cleanup.setOlderThanDays(e.target.value)} />
              </label>
              <label className="inline-field checkbox-field">
                <input type="checkbox" checked={p.logs.cleanup.dryRun} onChange={(e) => p.logs.cleanup.setDryRun(e.target.checked)} />
                dry_run (recommended first)
              </label>
              <button type="button" className="danger" disabled={obsApi.logsCleanup.loading} onClick={p.logs.cleanup.onCleanup}>
                Run logs cleanup
              </button>
            </div>
            <div className="status">
              {obsApi.logsCleanup.loading && <span className="loading">로딩 중...</span>}
              {obsApi.logsCleanup.success && <span className="success">{obsApi.logsCleanup.success}</span>}
              {obsApi.logsCleanup.error && <pre className="error">{obsApi.logsCleanup.error}</pre>}
            </div>
            <JsonBlock title="cleanup response" value={p.logs.cleanup.result} />
          </div>
        </section>
      )}

      {p.activeSection === 'failureTrend' && (
        <section className="panel obs-panel panel-scroll">
          <h2>Failure trend</h2>
          <p className="muted obs-hint">GET /api/v1/runtime/failures/trend</p>
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
          <div className="status">
            {obsApi.failureTrend.loading && <span className="loading">로딩 중...</span>}
            {obsApi.failureTrend.success && <span className="success">{obsApi.failureTrend.success}</span>}
            {obsApi.failureTrend.error && <pre className="error">{obsApi.failureTrend.error}</pre>}
          </div>
          {!obsApi.failureTrend.loading && !obsApi.failureTrend.error && !p.failureTrend.trendRec && (
            <p className="muted obs-empty">아직 failure trend 결과가 없습니다.</p>
          )}
          {p.failureTrend.trendRec && (
            <StatGrid title="totals" data={{ total: p.failureTrend.trendRec.total as unknown as number }} />
          )}
          <RowsTable title="buckets" rows={p.failureTrend.buckets as unknown[]} />
        </section>
      )}
    </>
  )
}
