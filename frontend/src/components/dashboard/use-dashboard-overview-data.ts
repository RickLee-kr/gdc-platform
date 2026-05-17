import { useCallback, useEffect, useRef, useState } from 'react'
import { GDC_HEADER_REFRESH_EVENT } from '../layout/header-refresh-event'
import type { MetricsWindow } from '../../api/gdcRuntime'
import {
  fetchRuntimeAlertSummary,
  fetchRuntimeDashboardOutcomeTimeseries,
  fetchRuntimeDashboardSummary,
  fetchRuntimeLogsPage,
  fetchRuntimeSystemResources,
} from '../../api/gdcRuntime'
import { fetchRetriesSummary } from '../../api/gdcRuntimeAnalytics'
import { fetchHealthOverview } from '../../api/gdcRuntimeHealth'
import { fetchDestinationsList, type DestinationListItem } from '../../api/gdcDestinations'
import { fetchRetentionStatus } from '../../api/gdcRetention'
import { fetchStreamsList } from '../../api/gdcStreams'
import type {
  DashboardOutcomeTimeseriesResponse,
  DashboardSummaryResponse,
  HealthOverviewResponse,
  RetrySummaryResponse,
  RetentionStatusResponse,
  RuntimeAlertSummaryResponse,
  RuntimeLogsPageResponse,
  RuntimeSystemResourcesResponse,
  StreamRead,
} from '../../api/types/gdcApi'
import { shouldSuppressApiLoadError } from '../../auth/password-change-gate'
import { logDashboardClientMetric } from '../../telemetry/dashboardClientMetrics'
import { allSnapshotsMatch, createRuntimeSnapshotId } from '../../api/runtimeSnapshotSync'

export type DashboardOverviewBundle = {
  dashboard: DashboardSummaryResponse | null
  health: HealthOverviewResponse | null
  retries: RetrySummaryResponse | null
  alerts: RuntimeAlertSummaryResponse | null
  logsPage: RuntimeLogsPageResponse | null
  outcomeTs: DashboardOutcomeTimeseriesResponse | null
  systemResources: RuntimeSystemResourcesResponse | null
  retentionStatus: RetentionStatusResponse | null
  streams: StreamRead[]
  destinations: DestinationListItem[]
}

/** Wall-clock ceiling for the parallel dashboard bundle (ms); per-request timeouts also apply in ``api.ts``. */
const DASHBOARD_BUNDLE_DEADLINE_MS = 20_000

export function useDashboardOverviewData(window: MetricsWindow, refreshMs: number | null) {
  const [bundle, setBundle] = useState<DashboardOverviewBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const loadInFlightRef = useRef<Promise<void> | null>(null)
  const loadGenerationRef = useRef(0)

  const load = useCallback(async () => {
    if (loadInFlightRef.current != null) {
      logDashboardClientMetric('dashboard_poll_skipped', { reason: 'previous_poll_pending' })
      return
    }
    const token = ++loadGenerationRef.current
    const run = (async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const snapshot_id = createRuntimeSnapshotId()
        const [
          dashboard,
          health,
          retries,
          alerts,
          logsPage,
          outcomeTs,
          systemResources,
          retentionStatus,
          streamsList,
          destinationsList,
        ] = await Promise.race([
          Promise.all([
            fetchRuntimeDashboardSummary(800, window, { snapshot_id }),
            fetchHealthOverview({ window, worst_limit: 5, snapshot_id }),
            fetchRetriesSummary({ window, snapshot_id }),
            fetchRuntimeAlertSummary(window, 40),
            fetchRuntimeLogsPage({ limit: 30, window, snapshot_id }),
            fetchRuntimeDashboardOutcomeTimeseries(window, { snapshot_id }),
            fetchRuntimeSystemResources(),
            fetchRetentionStatus(),
            fetchStreamsList(),
            fetchDestinationsList(),
          ]),
          new Promise<never>((_, reject) => {
            globalThis.setTimeout(() => {
              reject(new Error('Operations dashboard request exceeded the 20s timeout. Check network or API latency and retry.'))
            }, DASHBOARD_BUNDLE_DEADLINE_MS)
          }),
        ])

        if (token !== loadGenerationRef.current) return
        if (!allSnapshotsMatch(snapshot_id, [dashboard, health, retries, logsPage, outcomeTs])) {
          logDashboardClientMetric('dashboard_snapshot_mismatch_discarded', { snapshot_id })
          return
        }

        setBundle({
          dashboard,
          health,
          retries,
          alerts,
          logsPage,
          outcomeTs,
          systemResources,
          retentionStatus,
          streams: streamsList ?? [],
          destinations: destinationsList,
        })
      } catch (err) {
        if (shouldSuppressApiLoadError(err)) {
          if (token !== loadGenerationRef.current) return
          setLoadError(null)
          setLoading(false)
          return
        }
        const timedOut =
          err instanceof Error &&
          (err.message.includes('20s timeout') ||
            err.name === 'AbortError' ||
            err.message.toLowerCase().includes('aborted'))
        if (timedOut) {
          logDashboardClientMetric('dashboard_fetch_timeout', { deadline_ms: DASHBOARD_BUNDLE_DEADLINE_MS })
        }
        if (import.meta.env.DEV) {
          console.error('[dashboard overview] load failed', err)
        }
        const msg = err instanceof Error ? err.message : 'Could not load the dashboard.'
        if (token !== loadGenerationRef.current) return
        setLoadError(msg)
        setBundle({
          dashboard: null,
          health: null,
          retries: null,
          alerts: null,
          logsPage: null,
          outcomeTs: null,
          systemResources: null,
          retentionStatus: null,
          streams: [],
          destinations: [],
        })
      } finally {
        if (token === loadGenerationRef.current) {
          setLoading(false)
        }
      }
    })()

    const guarded = run.finally(() => {
      if (loadInFlightRef.current === guarded) {
        loadInFlightRef.current = null
      }
    })
    loadInFlightRef.current = guarded
    await guarded
  }, [window])

  useEffect(() => {
    void load()
    return () => {
      loadGenerationRef.current += 1
      loadInFlightRef.current = null
    }
  }, [load])

  useEffect(() => {
    if (refreshMs == null || refreshMs <= 0) return
    const id = globalThis.setInterval(() => void load(), refreshMs)
    return () => globalThis.clearInterval(id)
  }, [refreshMs, load])

  useEffect(() => {
    const w = globalThis.window
    if (!w) return
    const onShellRefresh = () => void load()
    w.addEventListener(GDC_HEADER_REFRESH_EVENT, onShellRefresh)
    return () => w.removeEventListener(GDC_HEADER_REFRESH_EVENT, onShellRefresh)
  }, [load])

  return { bundle, loading, loadError, reload: load }
}
