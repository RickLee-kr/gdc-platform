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
import { fetchConnectorsList, type ConnectorRead } from '../../api/gdcConnectors'
import { fetchDestinationsList, type DestinationListItem } from '../../api/gdcDestinations'
import { getOperationalSnapshot, type OperationalSnapshotResponse } from '../../api/operationalSnapshot'
import { fetchRetentionStatus } from '../../api/gdcRetention'
import { fetchStreamsList } from '../../api/gdcStreams'
import type {
  DashboardOutcomeTimeseriesResponse,
  DashboardSummaryResponse,
  RetrySummaryResponse,
  RetentionStatusResponse,
  RuntimeAlertSummaryResponse,
  RuntimeLogsPageResponse,
  RuntimeSystemResourcesResponse,
  StreamRead,
} from '../../api/types/gdcApi'
import { shouldSuppressApiLoadError } from '../../auth/password-change-gate'
import { useMountAbortController } from '../../hooks/use-mount-abort-signal'
import { isRequestAborted } from '../../lib/request-abort'
import { logDashboardClientMetric } from '../../telemetry/dashboardClientMetrics'

export type DashboardOverviewBundle = {
  dashboard: DashboardSummaryResponse | null
  retries: RetrySummaryResponse | null
  alerts: RuntimeAlertSummaryResponse | null
  logsPage: RuntimeLogsPageResponse | null
  outcomeTs: DashboardOutcomeTimeseriesResponse | null
  systemResources: RuntimeSystemResourcesResponse | null
  retentionStatus: RetentionStatusResponse | null
  streams: StreamRead[]
  destinations: DestinationListItem[]
  connectors: ConnectorRead[]
  operationalSnapshot: OperationalSnapshotResponse | null
}

const EMPTY_DASHBOARD_BUNDLE: DashboardOverviewBundle = {
  dashboard: null,
  retries: null,
  alerts: null,
  logsPage: null,
  outcomeTs: null,
  systemResources: null,
  retentionStatus: null,
  streams: [],
  destinations: [],
  connectors: [],
  operationalSnapshot: null,
}

/** Wall-clock ceiling for deferred dashboard bundle (ms). */
const DASHBOARD_BUNDLE_DEADLINE_MS = 20_000

export function useDashboardOverviewData(window: MetricsWindow, refreshMs: number | null) {
  const abortRef = useMountAbortController()
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
      const signal = abortRef.current?.signal
      const fetchOpts = { signal }
      setLoading(true)
      setLoadError(null)
      try {
        const operationalSnapshot = await getOperationalSnapshot()
        if (token !== loadGenerationRef.current) return
        if (operationalSnapshot == null) {
          setLoadError('Could not load operational snapshot.')
          setBundle(EMPTY_DASHBOARD_BUNDLE)
          return
        }

        setBundle({
          ...EMPTY_DASHBOARD_BUNDLE,
          operationalSnapshot,
        })
        setLoading(false)

        const deadline = new Promise<never>((_, reject) => {
          globalThis.setTimeout(() => {
            reject(new Error('Operations dashboard request exceeded the 20s timeout. Check network or API latency and retry.'))
          }, DASHBOARD_BUNDLE_DEADLINE_MS)
        })

        const deferredPromise = Promise.all([
          fetchRuntimeDashboardSummary(800, window, {}, fetchOpts),
          fetchRetriesSummary({ window }, fetchOpts),
          fetchRuntimeAlertSummary(window, 40, fetchOpts),
          fetchRuntimeLogsPage({ limit: 30, window }, fetchOpts),
          fetchRuntimeSystemResources(fetchOpts),
          fetchRetentionStatus(fetchOpts),
          fetchStreamsList(fetchOpts),
          fetchDestinationsList(fetchOpts),
          fetchConnectorsList(fetchOpts),
        ])

        const [
          dashboard,
          retries,
          alerts,
          logsPage,
          systemResources,
          retentionStatus,
          streamsList,
          destinationsList,
          connectorsList,
        ] = await Promise.race([deferredPromise, deadline])

        if (token !== loadGenerationRef.current) return

        setBundle({
          operationalSnapshot,
          dashboard: dashboard ?? null,
          retries: retries ?? null,
          alerts,
          logsPage: logsPage ?? null,
          outcomeTs: null,
          systemResources: systemResources ?? null,
          retentionStatus: retentionStatus ?? null,
          streams: streamsList ?? [],
          destinations: destinationsList ?? [],
          connectors: connectorsList ?? [],
        })

        void fetchRuntimeDashboardOutcomeTimeseries(window, {}, fetchOpts)
          .then((outcomeTs) => {
            if (token !== loadGenerationRef.current) return
            if (outcomeTs == null) return
            setBundle((prev) => (prev == null ? prev : { ...prev, outcomeTs }))
          })
          .catch((err) => {
            if (isRequestAborted(err)) return
            if (import.meta.env.DEV) {
              console.warn('[dashboard overview] outcome timeseries deferred load failed', err)
            }
          })
      } catch (err) {
        if (isRequestAborted(err)) return
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
        setBundle(EMPTY_DASHBOARD_BUNDLE)
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
  }, [window, abortRef])

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
