import type { HealthScore } from '../../../api/types/gdcApi'
import { cn } from '../../../lib/utils'
import { FailureRateIndicator } from './failure-rate-indicator'
import { HealthBadge } from './health-badge'
import { RetryPressureIndicator } from './retry-pressure-indicator'

export function HealthScoreCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      data-testid="health-score-card-skeleton"
      className={cn(
        'animate-pulse rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card',
        className,
      )}
      aria-busy
    >
      <div className="h-3 w-28 rounded bg-slate-200 dark:bg-gdc-elevated" />
      <div className="mt-3 h-8 w-16 rounded bg-slate-200 dark:bg-gdc-elevated" />
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="h-14 rounded bg-slate-200 dark:bg-gdc-elevated" />
        <div className="h-14 rounded bg-slate-200 dark:bg-gdc-elevated" />
      </div>
    </div>
  )
}

function formatTs(iso: string | null | undefined): string {
  if (iso == null || String(iso).trim() === '') return '—'
  const s = String(iso)
  return s.length >= 19 ? s.slice(0, 19).replace('T', ' ') : s
}

export function HealthScoreCard({
  score,
  className,
  dense,
}: {
  score: HealthScore
  className?: string
  dense?: boolean
}) {
  const m = score.metrics
  const attempts = m.failure_count + m.success_count
  const recentSuccessRatio = attempts > 0 ? m.success_count / attempts : null
  return (
    <div
      className={cn('rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card', className)}
      data-testid="health-score-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Health score</p>
          <p className="mt-0.5 font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">{score.score}</p>
        </div>
        <HealthBadge level={score.level} score={score.score} factors={score.factors} />
      </div>
      <div className={cn('mt-3 grid gap-3', dense ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2 lg:grid-cols-4')}>
        <FailureRateIndicator rate={m.failure_rate} />
        <RetryPressureIndicator retryEventCount={m.retry_event_count} retryRate={m.retry_rate} />
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Recent success ratio</p>
          <p className="mt-0.5 text-[12px] font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {recentSuccessRatio != null ? `${(recentSuccessRatio * 100).toFixed(1)}%` : '—'}
          </p>
          <p className="text-[10px] text-slate-500 dark:text-gdc-muted">{attempts ? `${m.success_count} ok / ${attempts} outcomes` : 'No outcomes'}</p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Latency p95</p>
          <p className="mt-0.5 text-[12px] font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {m.latency_ms_p95 != null ? `${Math.round(m.latency_ms_p95)} ms` : '—'}
          </p>
          {m.latency_ms_avg != null ? (
            <p className="text-[10px] text-slate-500 dark:text-gdc-muted">avg {Math.round(m.latency_ms_avg)} ms</p>
          ) : null}
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Last success</p>
          <p className="mt-0.5 font-mono text-[11px] text-slate-800 dark:text-slate-200">{formatTs(m.last_success_at)}</p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Last failure</p>
          <p className="mt-0.5 font-mono text-[11px] text-slate-800 dark:text-slate-200">{formatTs(m.last_failure_at)}</p>
        </div>
      </div>
    </div>
  )
}
