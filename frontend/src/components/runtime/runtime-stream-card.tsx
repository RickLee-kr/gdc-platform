import { memo } from 'react'
import type { OperationalStreamSnapshot } from '../../api/operationalSnapshot'
import { cn } from '../../lib/utils'
import { StatusBadge } from '../shell/status-badge'
import {
  formatEps,
  formatLatencyMs,
  formatPercent,
  formatShortTs,
  operationalHealthLabel,
  operationalHealthTone,
  streamErrorSummary,
} from './runtime-overview-helpers'

export type RuntimeStreamCardProps = {
  stream: OperationalStreamSnapshot
  selected: boolean
  onSelect: (streamId: number) => void
}

function RuntimeStreamCardInner({ stream, selected, onSelect }: RuntimeStreamCardProps) {
  const err = streamErrorSummary(stream)
  return (
    <button
      type="button"
      data-testid={`runtime-stream-card-${stream.stream_id}`}
      onClick={() => onSelect(stream.stream_id)}
      className={cn(
        'flex w-full flex-col gap-1.5 rounded-lg border px-2.5 py-2 text-left transition',
        selected
          ? 'border-violet-400 bg-violet-50/80 shadow-sm dark:border-violet-700 dark:bg-violet-950/30'
          : 'border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50/80 dark:border-gdc-border dark:bg-gdc-card dark:hover:bg-gdc-rowHover',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-[12px] font-semibold text-slate-900 dark:text-slate-50">{stream.stream_name}</p>
        <StatusBadge tone={operationalHealthTone(stream.health_status)} className="text-[10px]">
          {operationalHealthLabel(stream.health_status)}
        </StatusBadge>
      </div>
      <p className="text-[10px] text-slate-500 dark:text-gdc-muted">
        {stream.enabled ? 'Enabled' : 'Disabled'}
        {stream.status ? ` · ${stream.status}` : ''}
      </p>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] tabular-nums text-slate-700 dark:text-gdc-mutedStrong">
        <span>1m {formatEps(stream.eps_1m)}</span>
        <span>5m {formatEps(stream.eps_5m)}</span>
        <span>OK {formatPercent(stream.success_rate_5m)}</span>
        <span>Fail {formatPercent(stream.failure_rate_5m)}</span>
        <span>Lat {formatLatencyMs(stream.avg_latency_ms)}</span>
        <span>Lag {stream.checkpoint_lag_seconds != null ? `${stream.checkpoint_lag_seconds}s` : '—'}</span>
      </div>
      <p className="text-[10px] text-slate-600 dark:text-gdc-muted">
        Routes {stream.healthy_route_count}/{stream.route_count} OK
        {stream.failed_route_count > 0 ? ` · ${stream.failed_route_count} failed` : ''}
      </p>
      <p className="truncate text-[10px] text-slate-500 dark:text-gdc-muted">
        OK {formatShortTs(stream.last_success_at)} · Err {formatShortTs(stream.last_error_at)}
      </p>
      {err ? <p className="truncate text-[10px] font-medium text-red-800 dark:text-red-300/90">{err}</p> : null}
    </button>
  )
}

export function runtimeStreamCardPropsEqual(prev: RuntimeStreamCardProps, next: RuntimeStreamCardProps): boolean {
  return prev.selected === next.selected && prev.stream === next.stream && prev.onSelect === next.onSelect
}

export const RuntimeStreamCard = memo(RuntimeStreamCardInner, runtimeStreamCardPropsEqual)
