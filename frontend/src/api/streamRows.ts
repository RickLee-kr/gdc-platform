import type {
  MappingUIConfigResponse,
  RecentDeliveryLogItem,
  StreamHealthResponse,
  StreamRead,
  StreamRuntimeStatsResponse,
} from './types/gdcApi'
import { normalizeGdcStreamSourceType } from '../utils/sourceTypePresentation'

/** Maps to Stream.status / runtime-derived operational badge. */
export type StreamRuntimeStatus = 'RUNNING' | 'DEGRADED' | 'ERROR' | 'STOPPED' | 'UNKNOWN'

/** Streams console table + selected panel row shape (API-backed; never demo-filled). */
export type StreamConsoleRow = {
  id: string
  name: string
  connectorName: string
  sourceTypeLabel: string
  status: StreamRuntimeStatus
  /** False until runtime stats/health fetch completed for this row. */
  runtimeStatsAttempted: boolean
  /** True when either stats or health API returned a body for this stream. */
  hasRuntimeApiSnapshot: boolean
  events1h: number
  eventsTrend: readonly number[]
  lastCheckpointDisplay: string
  lastCheckpointRelative: string
  routesTotal: number
  routesOk: number
  routesDegraded: number
  routesError: number
  deliveryPct: number
  latencyP95Ms: number
  latencyTrend: readonly number[]
  lastActivityRelative: string
  lastActivityWarn?: boolean
  streamType: string
  /** Underscore stream/source type for presentation (e.g. HTTP_API_POLLING). */
  streamTypeKey: string
  pollingIntervalSec: number
  createdAt: string
  createdBy: string
  sourceMethod: 'GET' | 'POST'
  sourceUrl: string
  authType: string
  timeoutSec: number
  rateLimitLabel: string
  checkpointValue: string
  checkpointUpdatedAt: string
  checkpointLagLabel: string
  recentErrors: ReadonlyArray<{ message: string; relativeAt: string }>
}

const flatSpark = [0, 0, 0, 0, 0, 0, 0] as const

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

/** Maps backend stream_status strings to UI row/badge status; unknown → UNKNOWN (neutral elsewhere). */
export function mapBackendStreamStatus(s: string | null | undefined): StreamRuntimeStatus {
  if (s == null || String(s).trim() === '') return 'UNKNOWN'
  const u = String(s).trim().toUpperCase()
  if (u === 'RUNNING') return 'RUNNING'
  if (u === 'ERROR') return 'ERROR'
  if (u === 'RATE_LIMITED_SOURCE' || u === 'RATE_LIMITED_DESTINATION') return 'DEGRADED'
  if (u === 'PAUSED' || u === 'STOPPED' || u === 'IDLE') return 'STOPPED'
  if (u === 'UNKNOWN') return 'UNKNOWN'
  return 'UNKNOWN'
}

function formatShortTs(iso: string | null | undefined): string {
  if (iso == null || String(iso).trim() === '') return '—'
  return String(iso).slice(0, 19).replace('T', ' ')
}

function formatRateLimitJson(r: Record<string, unknown> | null | undefined): string {
  if (!r || typeof r !== 'object') return '—'
  const pm = r.per_minute
  const burst = r.burst
  if (typeof pm === 'number') return `${pm}/min · burst ${typeof burst === 'number' ? burst : '—'}`
  return '—'
}

function recentErrorsFromRuntimeLogs(logs: RecentDeliveryLogItem[] | undefined): StreamConsoleRow['recentErrors'] {
  if (!logs?.length) return []
  const out: Array<{ message: string; relativeAt: string }> = []
  for (let i = logs.length - 1; i >= 0 && out.length < 5; i -= 1) {
    const log = logs[i]!
    const level = String(log.level ?? '').toUpperCase()
    const stage = String(log.stage ?? '').toLowerCase()
    if (level === 'ERROR' || stage.includes('failed') || stage.includes('failure')) {
      out.push({
        message: log.message || log.stage || 'Delivery event',
        relativeAt: formatShortTs(log.created_at),
      })
    }
  }
  return out
}

/** Prefer persisted stream entity fields over placeholders before runtime enrichment. */
export function mergeStreamReadIntoRow(s: StreamRead, row: StreamConsoleRow): StreamConsoleRow {
  const cfg = (s.config_json ?? {}) as Record<string, unknown>
  const methodRaw = String(cfg.http_method ?? cfg.method ?? 'GET').toUpperCase()
  const base = String(cfg.base_url ?? '').trim()
  const path = String(cfg.endpoint_path ?? cfg.endpoint ?? '').trim()
  const url = `${base}${path}`.trim()

  const polling =
    typeof s.polling_interval === 'number' && Number.isFinite(s.polling_interval)
      ? s.polling_interval
      : row.pollingIntervalSec

  const stLabel = String(s.stream_type ?? row.streamType).replace(/_/g, ' ')

  return {
    ...row,
    streamType: stLabel || row.streamType,
    streamTypeKey: normalizeGdcStreamSourceType(s.stream_type ?? row.streamTypeKey),
    pollingIntervalSec: polling,
    sourceMethod: methodRaw === 'POST' ? 'POST' : 'GET',
    sourceUrl: url || row.sourceUrl,
    timeoutSec:
      typeof cfg.timeout_sec === 'number' && Number.isFinite(cfg.timeout_sec) ? Number(cfg.timeout_sec) : row.timeoutSec,
    authType: cfg.auth_type != null ? String(cfg.auth_type) : row.authType,
    rateLimitLabel: formatRateLimitJson(s.rate_limit_json ?? undefined),
  }
}

/** Merge masked Source payload from mapping-ui config into display row. */
export function mergeMappingUiIntoRow(row: StreamConsoleRow, cfg: MappingUIConfigResponse): StreamConsoleRow {
  const sc = cfg.source_config ?? {}
  const methodRaw = String(sc.http_method ?? row.sourceMethod).toUpperCase()
  const base = String(sc.base_url ?? '')
  const path = String(sc.endpoint_path ?? '')
  const url = `${base}${path}`.trim()

  const sourceLabel = cfg.source_type ? cfg.source_type.replace(/_/g, ' ') : row.sourceTypeLabel

  return {
    ...row,
    sourceTypeLabel: sourceLabel,
    streamTypeKey: normalizeGdcStreamSourceType(cfg.source_type ?? row.streamTypeKey),
    sourceMethod: methodRaw === 'POST' ? 'POST' : 'GET',
    sourceUrl: url || row.sourceUrl,
    timeoutSec:
      typeof sc.timeout_sec === 'number' && Number.isFinite(sc.timeout_sec) ? Number(sc.timeout_sec) : row.timeoutSec,
    routesTotal: Math.max(row.routesTotal, cfg.routes?.length ?? 0),
  }
}

export function mergeConnectorLabelIntoRow(row: StreamConsoleRow, connectorName: string | null | undefined): StreamConsoleRow {
  const n = (connectorName ?? '').trim()
  if (!n) return row
  return { ...row, connectorName: n }
}

/** Prefer readable remote-file and S3 checkpoint lines; other checkpoints use compact JSON (legacy truncation). */
export function formatCheckpointValueForConsole(value: Record<string, unknown> | null | undefined): string {
  if (!value || typeof value !== 'object') return '—'
  const lse = value.last_success_event
  const lseObj = lse && typeof lse === 'object' && !Array.isArray(lse) ? (lse as Record<string, unknown>) : null
  const isS3ish = Boolean(lseObj && 's3_key' in lseObj) || value.last_processed_etag != null
  const isRemoteish =
    Boolean(lseObj && ('gdc_remote_path' in lseObj || 'remote_path' in lseObj)) ||
    value.last_processed_file != null ||
    (value.last_processed_mtime != null && !isS3ish)

  if (isRemoteish && !isS3ish) {
    const fp = value.last_processed_file ?? value.last_processed_key
    const lines: string[] = []
    if (fp != null) lines.push(`last_processed_file: ${String(fp)}`)
    const mt = value.last_processed_mtime ?? value.last_processed_last_modified
    if (mt != null) lines.push(`last_processed_mtime: ${String(mt)}`)
    if (value.last_processed_size != null) lines.push(`last_processed_size: ${String(value.last_processed_size)}`)
    if (value.last_processed_offset != null) lines.push(`last_processed_offset: ${String(value.last_processed_offset)}`)
    if (value.last_processed_hash != null) lines.push(`last_processed_hash: ${String(value.last_processed_hash)}`)
    if (lines.length) {
      const full = JSON.stringify(value)
      const tail = full.length > 320 ? `\n… full_checkpoint_json truncated (${full.length} chars)` : `\n${full}`
      return lines.join('\n') + tail
    }
  }

  if (isS3ish && !isRemoteish) {
    const lines: string[] = []
    if (value.last_processed_key != null) lines.push(`last_processed_key: ${String(value.last_processed_key)}`)
    const lm = value.last_processed_last_modified
    if (lm != null) lines.push(`last_processed_last_modified: ${String(lm)}`)
    if (value.last_processed_etag != null) lines.push(`last_processed_etag: ${String(value.last_processed_etag)}`)
    if (lines.length) {
      const full = JSON.stringify(value)
      const tail = full.length > 320 ? `\n… full_checkpoint_json truncated (${full.length} chars)` : `\n${full}`
      return lines.join('\n') + tail
    }
  }

  const json = JSON.stringify(value)
  return json.length > 160 ? `${json.slice(0, 160)}…` : json
}

function baseRowFromStreamRead(s: StreamRead): StreamConsoleRow {
  const sid = String(s.id)
  const displayName = (s.name ?? '').trim() || `Stream ${s.id}`
  const stk = normalizeGdcStreamSourceType(s.stream_type)
  return {
    id: sid,
    name: displayName,
    connectorName: s.connector_id != null ? `Connector #${s.connector_id}` : '—',
    sourceTypeLabel: s.source_id != null ? `Source #${s.source_id}` : '—',
    status: mapBackendStreamStatus(s.status),
    runtimeStatsAttempted: false,
    hasRuntimeApiSnapshot: false,
    events1h: 0,
    eventsTrend: flatSpark,
    lastCheckpointDisplay: '—',
    lastCheckpointRelative: '—',
    routesTotal: 0,
    routesOk: 0,
    routesDegraded: 0,
    routesError: 0,
    deliveryPct: 0,
    latencyP95Ms: 0,
    latencyTrend: flatSpark,
    lastActivityRelative: '—',
    streamType: stk.replace(/_/g, ' '),
    streamTypeKey: stk,
    pollingIntervalSec: 60,
    createdAt: s.created_at?.slice(0, 19)?.replace('T', ' ') ?? '—',
    createdBy: '—',
    sourceMethod: 'GET',
    sourceUrl: '—',
    authType: '—',
    timeoutSec: 30,
    rateLimitLabel: '—',
    checkpointValue: '—',
    checkpointUpdatedAt: '—',
    checkpointLagLabel: '—',
    recentErrors: [],
  }
}

export function enrichStreamRowWithRuntime(
  base: StreamConsoleRow,
  stats: StreamRuntimeStatsResponse | null,
  health: StreamHealthResponse | null,
): StreamConsoleRow {
  let row: StreamConsoleRow = {
    ...base,
    runtimeStatsAttempted: true,
    hasRuntimeApiSnapshot: Boolean(stats ?? health),
  }

  if (stats) {
    const sum = stats.summary
    const sendSuccess = safeNonNegInt(sum?.route_send_success)
    const sendFailed = safeNonNegInt(sum?.route_send_failed)
    const retrySuccess = safeNonNegInt(sum?.route_retry_success)
    const retryFailed = safeNonNegInt(sum?.route_retry_failed)
    const attempted = sendSuccess + sendFailed + retrySuccess + retryFailed
    const delivered = sendSuccess + retrySuccess
    const deliveryPct = safePercent(delivered, attempted)
    const events1h = safeNonNegInt(sum?.total_logs)
    row = {
      ...row,
      events1h,
      eventsTrend: events1h > 0 ? [events1h, events1h, events1h, events1h, events1h, events1h, events1h] : [...flatSpark],
      deliveryPct,
      status: mapBackendStreamStatus(stats.stream_status),
      latencyP95Ms: 0,
      latencyTrend: [...flatSpark],
    }

    const ls = stats.last_seen
    if (ls) {
      const ts = ls.success_at ?? ls.failure_at ?? ls.rate_limited_at
      if (ts) {
        row.lastActivityRelative = formatShortTs(ts)
        row.lastActivityWarn = Boolean(ls.failure_at && !ls.success_at)
      }
    }

    if (stats.checkpoint) {
      const rawVal = (stats.checkpoint.value ?? {}) as Record<string, unknown>
      row.checkpointValue = formatCheckpointValueForConsole(rawVal)
      row.lastCheckpointDisplay = String(stats.checkpoint.type ?? 'checkpoint')
      row.lastCheckpointRelative = 'stored'
      row.checkpointLagLabel = 'see Runtime inspector'
    }

    const logErrors = recentErrorsFromRuntimeLogs(stats.recent_logs ?? [])
    if (logErrors.length) row = { ...row, recentErrors: logErrors }

    if (stats.routes?.length) {
      row.routesTotal = Math.max(row.routesTotal, stats.routes.length)
      let ok = 0
      let deg = 0
      let err = 0
      for (const r of stats.routes) {
        const failed = safeNonNegInt(r.counts?.route_send_failed) + safeNonNegInt(r.counts?.route_retry_failed)
        const okish = safeNonNegInt(r.counts?.route_send_success) + safeNonNegInt(r.counts?.route_retry_success)
        if (failed === 0 && okish > 0) ok += 1
        else if (failed > 0) err += 1
        else deg += 1
      }
      row.routesOk = ok
      row.routesDegraded = deg
      row.routesError = err
    }
  }

  if (health?.summary) {
    const h = health.summary
    const ht = safeNonNegInt(h.total_routes)
    row.routesTotal = ht > 0 ? Math.max(row.routesTotal, ht) : row.routesTotal
    row.routesOk = safeNonNegInt(h.healthy_routes)
    row.routesDegraded = safeNonNegInt(h.degraded_routes) + safeNonNegInt(h.idle_routes)
    row.routesError = safeNonNegInt(h.unhealthy_routes)
    if (health.stream_status) row.status = mapBackendStreamStatus(health.stream_status)
  }

  return row
}

export function streamReadToConsoleRow(s: StreamRead): StreamConsoleRow {
  return mergeStreamReadIntoRow(s, baseRowFromStreamRead(s))
}
