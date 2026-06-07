import { AlertTriangle, CheckCircle2, Clock, Send } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { logsExplorerPath } from '../../config/nav-paths'
import { formatCheckpointValueForConsole } from '../../api/streamRows'
import { StatusBadge } from '../shell/status-badge'
import type { StreamRuntimeStatus } from '../../api/streamRows'
import type { StreamRuntimeMetricsResponse } from '../../api/types/gdcApi'

function statusTone(s: StreamRuntimeStatus) {
  switch (s) {
    case 'RUNNING':
      return 'success' as const
    case 'DEGRADED':
      return 'warning' as const
    case 'ERROR':
      return 'error' as const
    case 'STOPPED':
      return 'neutral' as const
    case 'UNKNOWN':
      return 'neutral' as const
    default: {
      const _e: never = s
      return _e
    }
  }
}

function MiniSparkline({ values, className }: { values: readonly number[]; className?: string }) {
  const w = 44
  const h = 14
  const padX = 1
  const padY = 1
  const nums = values.length ? [...values] : [0]
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const range = max - min || 1
  const innerW = w - padX * 2
  const innerH = h - padY * 2
  const pts = nums.map((v, i) => {
    const x = padX + (i / Math.max(nums.length - 1, 1)) * innerW
    const y = padY + (1 - (v - min) / range) * innerH
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={cn('shrink-0 text-violet-600 dark:text-violet-400', className)} aria-hidden>
      <polyline fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" points={pts.join(' ')} />
    </svg>
  )
}

function DeliveryBar({ pct }: { pct: number }) {
  const tone =
    pct >= 99 ? 'bg-emerald-500' : pct >= 85 ? 'bg-amber-500' : pct <= 0 ? 'bg-slate-300 dark:bg-slate-600' : 'bg-red-500'
  return (
    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/90 dark:bg-gdc-elevated">
      <div className={cn('h-full rounded-full', tone)} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  )
}

function StatusTile({
  label,
  children,
  className,
  href,
  linkLabel,
}: {
  label: string
  children: React.ReactNode
  className?: string
  href?: string
  linkLabel?: string
}) {
  return (
    <div
      className={cn(
        'flex min-h-[6.5rem] flex-col rounded-lg border border-slate-200/70 bg-white/90 p-3 shadow-none dark:border-gdc-border/90 dark:bg-gdc-card',
        className,
      )}
    >
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">{label}</p>
      <div className="mt-1 flex-1">{children}</div>
      {href && linkLabel ? (
        <Link to={href} className="mt-1.5 text-[10px] font-semibold text-violet-700 hover:underline dark:text-violet-300">
          {linkLabel}
        </Link>
      ) : null}
    </div>
  )
}

export type StreamMonitoringStatusStripProps = {
  displayStatus: StreamRuntimeStatus
  backendStreamId: number | undefined
  hasRuntimeObsApi: boolean
  backendStatusLabel?: string | null
  healthScore?: number | null
  events1h: number | null
  eventsSparkline: readonly number[]
  deliveryPct: number | null
  deliveryLabel: string | null
  routesTotal: number | null
  routesOk: number | null
  routesErr: number | null
  showCheckpointObservability: boolean
  runtimeMetrics: StreamRuntimeMetricsResponse | null
  failedLastHour: number | null
  errorRate: number | null
  lastErrorAt: string | null
  onExpandObservability?: () => void
}

export function StreamMonitoringStatusStrip({
  displayStatus,
  backendStreamId,
  hasRuntimeObsApi,
  backendStatusLabel,
  healthScore,
  events1h,
  eventsSparkline,
  deliveryPct,
  deliveryLabel,
  routesTotal,
  routesOk,
  routesErr,
  showCheckpointObservability,
  runtimeMetrics,
  failedLastHour,
  errorRate,
  lastErrorAt,
  onExpandObservability,
}: StreamMonitoringStatusStripProps) {
  const checkpointValue = runtimeMetrics?.stream.last_checkpoint?.value ?? null
  const checkpointType = runtimeMetrics?.stream.last_checkpoint?.type ?? null

  const errorsHref =
    backendStreamId != null ? logsExplorerPath({ stream_id: backendStreamId, status: 'failed' }) : undefined

  return (
    <section aria-label="Stream monitoring status" data-testid="stream-monitoring-status-strip" className="grid grid-cols-2 gap-2 xl:grid-cols-4 xl:gap-3">
      <StatusTile label="Health">
        <div className="flex items-start justify-between gap-2">
          <div>
            <StatusBadge tone={statusTone(displayStatus)} className="font-bold uppercase">
              {displayStatus}
            </StatusBadge>
            <p className="mt-1.5 text-[11px] leading-snug text-slate-600 dark:text-gdc-muted">
              {hasRuntimeObsApi ? (
                <>Backend: {String(backendStatusLabel ?? '—')}</>
              ) : (
                'No runtime summary yet'
              )}
            </p>
          </div>
          {healthScore != null ? (
            <div className="text-right">
              <p className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">{healthScore}</p>
              <p className="text-[9px] font-medium uppercase tracking-wide text-slate-500">score</p>
            </div>
          ) : null}
        </div>
        {onExpandObservability ? (
          <button
            type="button"
            onClick={onExpandObservability}
            className="mt-1.5 text-left text-[10px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
          >
            Expand observability
          </button>
        ) : null}
      </StatusTile>

      <StatusTile label="Delivery">
        <p className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
          {deliveryPct != null ? `${deliveryPct.toFixed(2)}%` : '—'}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-600 dark:text-gdc-muted">
          {routesTotal != null ? `${routesTotal} routes` : '—'}
          {routesOk != null ? ` · ${routesOk} ok` : ''}
          {routesErr != null && routesErr > 0 ? ` · ${routesErr} err` : ''}
        </p>
        <p className="mt-0.5 text-[10px] text-slate-500 dark:text-gdc-muted">{deliveryLabel ?? '—'}</p>
        <DeliveryBar pct={deliveryPct ?? 0} />
        {events1h != null ? (
          <div className="mt-1 flex items-center justify-between text-emerald-600 dark:text-emerald-400">
            <span className="text-[10px] tabular-nums text-slate-500 dark:text-gdc-muted">{events1h.toLocaleString()} evt</span>
            <MiniSparkline values={eventsSparkline} />
          </div>
        ) : null}
      </StatusTile>

      <StatusTile label="Checkpoint">
        {showCheckpointObservability ? (
          checkpointValue != null || checkpointType ? (
            <>
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                <p className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">{String(checkpointType ?? '—')}</p>
              </div>
              <p className="mt-1 break-all font-mono text-[10px] leading-snug text-slate-700 dark:text-gdc-mutedStrong">
                {formatCheckpointValueForConsole((checkpointValue ?? {}) as Record<string, unknown>)}
              </p>
            </>
          ) : (
            <p className="text-[12px] text-slate-600 dark:text-gdc-muted">No checkpoint persisted yet</p>
          )
        ) : (
          <>
            <p className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Push ingest</p>
            <p className="mt-1 text-[11px] leading-snug text-slate-600 dark:text-gdc-muted">
              External systems POST to the receiver URL. Checkpoint is not used for cursor polling.
            </p>
          </>
        )}
      </StatusTile>

      <StatusTile label="Errors" href={errorsHref} linkLabel={errorsHref ? 'Open failed logs' : undefined}>
        <div className="flex items-start gap-2">
          {failedLastHour != null && failedLastHour > 0 ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
          )}
          <div>
            <p className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
              {failedLastHour != null ? failedLastHour.toLocaleString() : '—'}
              <span className="ml-1 text-[11px] font-medium text-slate-500 dark:text-gdc-muted">(1h)</span>
            </p>
            <p className="mt-0.5 text-[11px] text-slate-600 dark:text-gdc-muted">
              {errorRate != null ? `${errorRate.toFixed(1)}% error rate` : '—'}
            </p>
            {lastErrorAt ? (
              <p className="mt-0.5 text-[10px] text-slate-500 dark:text-gdc-muted">
                Last: {lastErrorAt.slice(0, 19).replace('T', ' ')}
              </p>
            ) : (
              <p className="mt-0.5 text-[10px] text-slate-500 dark:text-gdc-muted">No recent failures</p>
            )}
          </div>
        </div>
        <Send className="mt-1 h-3 w-3 text-slate-300 dark:text-gdc-muted" aria-hidden />
      </StatusTile>
    </section>
  )
}
