import { Cpu } from 'lucide-react'
import { cn } from '../../../lib/utils'
import { RuntimeChartCard } from '../../shell/runtime-chart-card'
import type { DashboardSummaryResponse, RuntimeSystemResourcesResponse } from '../../../api/types/gdcApi'

export type OpsRuntimeEngineWidgetProps = {
  dashboard: DashboardSummaryResponse | null
  systemResources: RuntimeSystemResourcesResponse | null
  loading: boolean
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MB`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`
  return `${Math.round(n)} B`
}

function formatUptime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

export function OpsRuntimeEngineWidget({ dashboard, systemResources, loading }: OpsRuntimeEngineWidgetProps) {
  const d = dashboard
  const sys = systemResources
  const engine = d?.runtime_engine_status ?? '—'
  const workers = d?.active_worker_count

  return (
    <RuntimeChartCard
      title="Runtime engine & host"
      subtitle="Scheduler/engine posture from the dashboard summary API and live host sampling."
      actions={
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-gdc-muted">
          Read-only
        </span>
      }
    >
      <div className={cn('space-y-3', loading && 'opacity-80')} aria-busy={loading}>
        <div className="flex flex-wrap items-center gap-2">
          <Cpu className="h-4 w-4 text-violet-600 dark:text-violet-400" aria-hidden />
          <span className="rounded-full border border-slate-200/90 px-2 py-0.5 font-mono text-[11px] font-semibold uppercase text-slate-800 dark:border-gdc-divider dark:text-slate-100">
            {engine}
          </span>
          {workers != null ? (
            <span className="text-[11px] text-slate-600 dark:text-gdc-muted">
              Workers: <span className="font-mono font-semibold text-slate-900 dark:text-slate-50">{workers}</span>
            </span>
          ) : null}
        </div>
        <ul className="space-y-1 text-[11px] text-slate-600 dark:text-gdc-muted">
          <li className="flex justify-between gap-2">
            <span>Scheduler uptime</span>
            <span className="font-mono tabular-nums text-slate-900 dark:text-slate-50">
              {formatUptime(d?.scheduler_uptime_seconds ?? undefined)}
            </span>
          </li>
        </ul>

        {sys ? (
          <div className="rounded-md border border-slate-100 bg-slate-50/90 px-2 py-2 dark:border-gdc-border dark:bg-gdc-elevated">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
              Host snapshot
            </p>
            <ul className="grid gap-1 text-[11px] text-slate-700 dark:text-slate-200">
              <li className="flex justify-between gap-2 tabular-nums">
                <span>CPU</span>
                <span>{sys.cpu_percent.toFixed(1)}%</span>
              </li>
              <li className="flex justify-between gap-2 tabular-nums">
                <span>Memory</span>
                <span>
                  {sys.memory_percent.toFixed(1)}% ({formatBytes(sys.memory_used_bytes)} / {formatBytes(sys.memory_total_bytes)})
                </span>
              </li>
              <li className="flex justify-between gap-2 tabular-nums">
                <span>Disk</span>
                <span>
                  {sys.disk_percent.toFixed(1)}% ({formatBytes(sys.disk_used_bytes)} / {formatBytes(sys.disk_total_bytes)})
                </span>
              </li>
            </ul>
          </div>
        ) : !loading ? (
          <p className="text-[11px] text-slate-500 dark:text-gdc-muted">Host metrics unavailable for this session.</p>
        ) : null}
      </div>
    </RuntimeChartCard>
  )
}
