import type { RouteHealthRow, StreamHealthSignal } from '../components/streams/stream-runtime-detail-model'
import type {
  RouteHealthItem,
  StreamHealthResponse,
  StreamRuntimeMetricsResponse,
  StreamRuntimeStatsResponse,
} from './types/gdcApi'

const FLAT_LATENCY_TREND = [0, 0, 0, 0, 0, 0, 0] as const

function safeNonNegInt(n: unknown): number {
  const x = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(x) || x < 0) return 0
  return Math.floor(x)
}

function safePercent(numer: unknown, denom: unknown): number {
  const a = safeNonNegInt(numer)
  const b = safeNonNegInt(denom)
  if (b <= 0) return 0
  const raw = (100 * a) / b
  if (!Number.isFinite(raw)) return 0
  return Math.min(100, Math.max(0, raw))
}

function safeText(v: unknown): string | null {
  const t = String(v ?? '').trim()
  return t.length > 0 ? t : null
}

function routeLabel(id: unknown): string {
  const rid = safeNonNegInt(id)
  return rid > 0 ? `Route #${rid}` : 'Route'
}

function destinationLabel(h: Pick<RouteHealthItem, 'destination_id'> & { destination_name?: unknown }): string {
  const byName = safeText(h.destination_name)
  if (byName) return byName
  const did = safeNonNegInt(h.destination_id)
  return did > 0 ? `Destination #${did}` : 'Destination'
}

/** Prefer destination name, fallback to stable IDs. */
export function formatRouteHealthDestination(
  h: Pick<RouteHealthItem, 'route_id' | 'destination_id'> & { destination_name?: unknown },
): string {
  return `${destinationLabel(h)} · ${routeLabel(h.route_id)}`
}

/** Type column: destination channel plus disabled hint when applicable. */
export function formatRouteHealthTypeLabel(
  h: Pick<RouteHealthItem, 'destination_type' | 'route_enabled' | 'destination_enabled'>,
): string {
  const base = String(h.destination_type ?? '').trim() || '—'
  if (h.route_enabled === false || h.destination_enabled === false) return `${base} · off`
  return base
}

function streamHealthTone(health: string | null | undefined): StreamHealthSignal['tone'] {
  const u = String(health ?? '').trim().toUpperCase()
  if (u === '') return 'neutral'
  if (u === 'HEALTHY') return 'ok'
  if (u === 'DEGRADED' || u === 'IDLE') return 'warn'
  if (u === 'UNHEALTHY') return 'err'
  return 'neutral'
}

function routeUiStatus(health: string | null | undefined): RouteHealthRow['status'] {
  const u = String(health ?? '').trim().toUpperCase()
  if (u === '') return 'Unknown'
  if (u === 'HEALTHY') return 'Healthy'
  if (u === 'UNHEALTHY') return 'Error'
  if (u === 'DEGRADED' || u === 'IDLE' || u === 'DISABLED') return 'Degraded'
  if (u === 'UNKNOWN') return 'Unknown'
  return 'Unknown'
}

function routeStatusFromSuccessFail(ok: number, bad: number, enabled: boolean): RouteHealthRow['status'] {
  if (!enabled) return 'Degraded'
  if (bad > 0 && ok === 0) return 'Error'
  if (bad > 0) return 'Degraded'
  if (ok > 0) return 'Healthy'
  return 'Unknown'
}

/** Maps GET /runtime/streams/{id}/metrics route_health (1h window, committed logs). */
export function routeHealthRowsFromMetrics(metrics: StreamRuntimeMetricsResponse | null): RouteHealthRow[] | null {
  if (!metrics?.route_health?.length) return null
  return metrics.route_health.map((h) => {
    const ok = safeNonNegInt(h.success_count)
    const bad = safeNonNegInt(h.failed_count)
    const attempted = ok + bad
    const deliveryPct = safePercent(ok, attempted)
    const lat = safeNonNegInt(h.avg_latency_ms)
    const trend = [lat, lat, lat, lat, lat, lat, lat] as const
    return {
      routeId: safeNonNegInt(h.route_id) || undefined,
      destination: `${String(h.destination_name).trim() || 'Destination'} · Route #${safeNonNegInt(h.route_id)}`,
      typeLabel: `${String(h.destination_type ?? '—')}${h.enabled ? '' : ' · off'}`,
      status: routeStatusFromSuccessFail(ok, bad, h.enabled),
      deliveryPct,
      latencyP95Ms: lat,
      latencyTrend: trend,
      failed1h: bad,
      lastError: safeText(h.last_error_message),
    }
  })
}

/** Maps GET /runtime/health/stream rows into the runtime detail route table shape. */
export function routeHealthRowsFromApi(health: StreamHealthResponse | null): RouteHealthRow[] | null {
  if (!health?.routes?.length) return null
  return health.routes.map((h) => {
    const ok = safeNonNegInt(h.success_count)
    const bad = safeNonNegInt(h.failure_count)
    const attempted = ok + bad
    const deliveryPct = safePercent(ok, attempted)

    return {
      routeId: safeNonNegInt(h.route_id) || undefined,
      destinationId: safeNonNegInt(h.destination_id) || undefined,
      destination: formatRouteHealthDestination(h),
      typeLabel: formatRouteHealthTypeLabel(h),
      status: routeUiStatus(h.health),
      deliveryPct,
      latencyP95Ms: 0,
      latencyTrend: FLAT_LATENCY_TREND,
      failed1h: bad,
      lastError: safeText(h.last_error_message) ?? safeText(h.last_error_code),
    }
  })
}

/** Overlays API-derived values onto demo stream health signal rows (same labels/order). */
export function mergeStreamHealthSignals(
  base: readonly StreamHealthSignal[],
  stats: StreamRuntimeStatsResponse | null,
  health: StreamHealthResponse | null,
  metrics: StreamRuntimeMetricsResponse | null = null,
): StreamHealthSignal[] {
  return base.map((sig) => {
    if (sig.label === 'Source Connectivity' && health) {
      const rawHealth = String(health.health ?? '').trim()
      const hv = rawHealth.length > 0 ? rawHealth : 'Unknown'
      const detailRaw = String(health.stream_status ?? '').trim()
      const detail = detailRaw.length > 0 ? detailRaw : undefined
      return {
        ...sig,
        value: hv,
        detail,
        tone: streamHealthTone(health.health),
        sparkline: undefined,
      }
    }
    if (sig.label === 'Polling' && metrics?.kpis) {
      const ev = safeNonNegInt(metrics.kpis.events_last_hour)
      const del = safeNonNegInt(metrics.kpis.delivered_last_hour)
      return {
        ...sig,
        value: `${ev.toLocaleString()} evt`,
        detail: `${del.toLocaleString()} delivered · 1h metrics`,
        tone: sig.tone,
      }
    }
    if (sig.label === 'Polling' && stats?.summary) {
      const s = stats.summary
      const completes = safeNonNegInt(s.run_complete)
      const logs = safeNonNegInt(s.total_logs)
      return {
        ...sig,
        value: `${completes} completes`,
        detail: `${logs} rows · runtime API data`,
        tone: sig.tone,
      }
    }
    if (sig.label === 'Rate Limit' && stats?.summary) {
      const s = stats.summary
      const src = safeNonNegInt(s.source_rate_limited)
      const dest = safeNonNegInt(s.destination_rate_limited)
      const rl = src + dest
      return {
        ...sig,
        value: rl > 0 ? `${rl} hits` : 'OK',
        detail: `src ${src} · dest ${dest}`,
        tone: rl > 0 ? 'warn' : 'ok',
      }
    }
    if (sig.label === 'Error Rate (1h)' && metrics?.kpis) {
      const er = metrics.kpis.error_rate
      const fails = safeNonNegInt(metrics.kpis.failed_last_hour)
      return {
        ...sig,
        value: `${er.toFixed(1)}%`,
        detail: `${fails} failed attempts · 1h metrics`,
        tone: er > 15 ? 'err' : er > 5 ? 'warn' : 'ok',
        sparkline: sig.sparkline,
      }
    }
    if (sig.label === 'Error Rate (1h)' && stats?.summary) {
      const s = stats.summary
      const succ = safeNonNegInt(s.route_send_success) + safeNonNegInt(s.route_retry_success)
      const fails = safeNonNegInt(s.route_send_failed) + safeNonNegInt(s.route_retry_failed)
      const denom = succ + fails
      const safePct = safePercent(fails, denom)
      return {
        ...sig,
        value: `${safePct.toFixed(2)}%`,
        detail: `${fails} failed / ${denom} attempts`,
        tone: safePct > 15 ? 'err' : safePct > 5 ? 'warn' : 'ok',
        sparkline: sig.sparkline,
      }
    }
    if (sig.label === 'Successive Failures' && health?.routes?.length) {
      const maxConsec = Math.max(
        0,
        ...health.routes.map((r) => safeNonNegInt(r.consecutive_failure_count)),
      )
      return {
        ...sig,
        value: String(maxConsec),
        detail: maxConsec > 0 ? 'Max streak · runtime API' : 'none',
        tone: maxConsec > 3 ? 'err' : maxConsec > 0 ? 'warn' : 'ok',
      }
    }
    return { ...sig }
  })
}

export type RuntimeDetailNumericOverlay = {
  events1h: number | null
  eventsPerMinApprox: number | null
  deliveryPct: number | null
  deliveryLabel: string | null
  routesTotal: number | null
  routesOk: number | null
  routesWarn: number | null
  routesErr: number | null
}

export function buildRuntimeDetailNumericOverlay(
  stats: StreamRuntimeStatsResponse | null,
  health: StreamHealthResponse | null,
  metrics: StreamRuntimeMetricsResponse | null = null,
): RuntimeDetailNumericOverlay {
  if (metrics?.kpis) {
    const k = metrics.kpis
    const events1h = safeNonNegInt(k.events_last_hour)
    const deliveryPct = k.delivery_success_rate
    const deliveryLabel = 'Last 1h · metrics API'
    const eventsPerMinApprox = events1h === 0 ? 0 : Math.max(1, Math.round(events1h / 60))
    const rh = metrics.route_health ?? []
    const routesTotal = rh.length
    let routesOk = 0
    let routesWarn = 0
    let routesErr = 0
    for (const r of rh) {
      const okc = safeNonNegInt(r.success_count)
      const bad = safeNonNegInt(r.failed_count)
      if (!r.enabled) {
        routesWarn += 1
        continue
      }
      if (bad > 0 && okc === 0) routesErr += 1
      else if (bad > 0) routesWarn += 1
      else if (okc > 0) routesOk += 1
      else routesWarn += 1
    }
    return {
      events1h,
      eventsPerMinApprox,
      deliveryPct,
      deliveryLabel,
      routesTotal,
      routesOk,
      routesWarn,
      routesErr,
    }
  }

  let deliveryPct: number | null = null
  let deliveryLabel: string | null = null
  if (stats?.summary) {
    const s = stats.summary
    const ok = safeNonNegInt(s.route_send_success) + safeNonNegInt(s.route_retry_success)
    const bad = safeNonNegInt(s.route_send_failed) + safeNonNegInt(s.route_retry_failed)
    const n = ok + bad
    if (n > 0) {
      deliveryPct = safePercent(ok, n)
    } else {
      deliveryPct = null
    }
    deliveryLabel = 'Runtime API window'
  }

  let events1h: number | null = null
  if (stats?.summary != null) {
    const tl = safeNonNegInt(stats.summary.total_logs)
    events1h = tl
  }

  let eventsPerMinApprox: number | null = null
  if (events1h != null) {
    eventsPerMinApprox = events1h === 0 ? 0 : Math.max(1, Math.round(events1h / 60))
  }

  let routesTotal: number | null = null
  let routesOk: number | null = null
  let routesWarn: number | null = null
  let routesErr: number | null = null
  if (health?.summary) {
    const u = health.summary
    routesTotal = safeNonNegInt(u.total_routes)
    routesOk = safeNonNegInt(u.healthy_routes)
    routesWarn = safeNonNegInt(u.degraded_routes) + safeNonNegInt(u.idle_routes)
    routesErr = safeNonNegInt(u.unhealthy_routes)
  } else if (stats?.routes?.length) {
    routesTotal = stats.routes.length
    let ok = 0
    let deg = 0
    let err = 0
    for (const r of stats.routes) {
      const failed = safeNonNegInt(r.counts.route_send_failed) + safeNonNegInt(r.counts.route_retry_failed)
      const okish = safeNonNegInt(r.counts.route_send_success) + safeNonNegInt(r.counts.route_retry_success)
      if (failed === 0 && okish > 0) ok += 1
      else if (failed > 0) err += 1
      else deg += 1
    }
    routesOk = ok
    routesWarn = deg
    routesErr = err
  }

  return {
    events1h,
    eventsPerMinApprox,
    deliveryPct,
    deliveryLabel,
    routesTotal,
    routesOk,
    routesWarn,
    routesErr,
  }
}
