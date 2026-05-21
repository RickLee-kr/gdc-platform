import { AlertTriangle, Link2, RadioTower, Shield } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchStreamWebhookIngestObservability, type MetricsWindow } from '../../api/gdcRuntime'
import type { WebhookIngestObservabilityResponse } from '../../api/types/gdcApi'
import { logsExplorerPath } from '../../config/nav-paths'
import { cn } from '../../lib/utils'

function formatAuthMode(mode: string): string {
  const m = String(mode || 'no_auth').trim().toLowerCase()
  if (m === 'shared_secret_header') return 'Shared secret header'
  if (m === 'bearer_token') return 'Bearer token'
  if (m === 'no_auth') return 'No auth'
  return m.replace(/_/g, ' ')
}

function formatIngestOutcome(outcome: string): string {
  if (outcome === 'success') return 'Success'
  if (outcome === 'partial') return 'Partial success'
  if (outcome === 'failed') return 'Failed'
  return 'No pipeline run in window'
}

function formatTs(iso: string | null | undefined): string {
  if (!iso) return '—'
  return iso.slice(0, 19).replace('T', ' ')
}

type WebhookReceiverRuntimePanelProps = {
  streamId: number
  window?: MetricsWindow
}

export function WebhookReceiverRuntimePanel({ streamId, window = '1h' }: WebhookReceiverRuntimePanelProps) {
  const [data, setData] = useState<WebhookIngestObservabilityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void fetchStreamWebhookIngestObservability(streamId, window)
      .then((res) => {
        if (cancelled) return
        setData(res)
        if (res == null) setError('Webhook ingest observability unavailable.')
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load webhook ingest observability.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [streamId, window])

  const receiverDisabled = data != null && (!data.source_enabled || !data.stream_enabled)
  const logsHref = logsExplorerPath({ stream_id: streamId })

  return (
    <section
      aria-label="Webhook receiver ingest"
      data-testid="webhook-receiver-runtime-panel"
      className="rounded-xl border border-violet-200/70 bg-violet-500/[0.04] px-4 py-3 shadow-sm ring-1 ring-violet-200/40 dark:border-violet-500/25 dark:bg-violet-500/10 dark:ring-violet-500/20"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-900 dark:text-slate-100">
            <RadioTower className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" aria-hidden />
            Webhook ingest health
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-600 dark:text-gdc-muted">
            Push ingest — metrics from committed delivery logs ({window} window). Pre-auth rejections appear only when logged to delivery logs.
          </p>
        </div>
        <Link
          to={logsHref}
          className="shrink-0 text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
        >
          Open stream logs
        </Link>
      </div>

      {receiverDisabled ? (
        <p
          role="status"
          data-testid="webhook-receiver-disabled-banner"
          className="mt-3 flex items-start gap-2 rounded-md border border-amber-300/70 bg-amber-500/[0.08] px-2.5 py-2 text-[11px] font-medium text-amber-950 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-100"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Receiver disabled — enable the source and stream before accepting live POST traffic.
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 text-[11px] font-medium text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-2 rounded-lg border border-slate-200/80 bg-white/90 p-3 dark:border-gdc-border dark:bg-gdc-card">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Receiver</p>
          <dl className="space-y-1.5 text-[11px]">
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-medium text-slate-600 dark:text-gdc-muted">URL</dt>
              <dd className="min-w-0 break-all font-mono text-[10px] text-slate-800 dark:text-slate-200">
                {loading ? '…' : data?.receiver_path ?? '—'}
              </dd>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <dt className="inline-flex items-center gap-1 font-medium text-slate-600 dark:text-gdc-muted">
                <Shield className="h-3 w-3" aria-hidden />
                Auth mode
              </dt>
              <dd>{loading ? '…' : formatAuthMode(data?.webhook_auth_mode ?? 'no_auth')}</dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-medium text-slate-600 dark:text-gdc-muted">Recent ingest</dt>
              <dd>
                {loading ? (
                  '…'
                ) : (
                  <>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {formatIngestOutcome(data?.recent_ingest?.outcome ?? 'none')}
                    </span>
                    {data?.recent_ingest?.at ? (
                      <span className="text-slate-500 dark:text-gdc-muted"> · {formatTs(data.recent_ingest.at)}</span>
                    ) : null}
                  </>
                )}
              </dd>
            </div>
          </dl>
        </div>

        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-3"
          data-testid="webhook-ingest-metrics"
          aria-busy={loading}
        >
          {[
            { label: 'Ingest attempts', value: data?.ingest_attempts, testId: 'webhook-metric-ingest-attempts' },
            { label: 'Deliveries OK', value: data?.successful_deliveries, testId: 'webhook-metric-deliveries-ok' },
            { label: 'Deliveries failed', value: data?.failed_deliveries, testId: 'webhook-metric-deliveries-failed' },
            { label: 'Auth failures', value: data?.auth_failures, testId: 'webhook-metric-auth-failures' },
            { label: 'Malformed payload', value: data?.malformed_payload_count, testId: 'webhook-metric-malformed' },
          ].map((m) => (
            <div
              key={m.testId}
              data-testid={m.testId}
              className="rounded-lg border border-slate-200/80 bg-white/90 px-2.5 py-2 dark:border-gdc-border dark:bg-gdc-card"
            >
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">{m.label}</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                {loading ? '—' : (m.value ?? 0).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Recent webhook logs</p>
        {loading ? (
          <p className="mt-1 text-[11px] text-slate-600 dark:text-gdc-muted">Loading…</p>
        ) : data?.recent_logs?.length ? (
          <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto" data-testid="webhook-recent-logs">
            {data.recent_logs.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded border border-slate-100 bg-slate-50/60 px-2 py-1 text-[10px] dark:border-gdc-divider dark:bg-gdc-elevated/50"
              >
                <span className="shrink-0 font-mono text-slate-500 dark:text-gdc-muted">{formatTs(row.created_at)}</span>
                <span className="rounded bg-slate-200/80 px-1 font-mono dark:bg-gdc-elevated">{row.stage}</span>
                <span
                  className={cn(
                    'font-semibold',
                    row.level === 'ERROR' ? 'text-red-700 dark:text-red-300' : row.level === 'WARN' ? 'text-amber-800 dark:text-amber-200' : '',
                  )}
                >
                  {row.level}
                </span>
                <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-gdc-mutedStrong">{row.message}</span>
                {row.error_code ? (
                  <span className="font-mono text-[9px] text-slate-500 dark:text-gdc-muted">{row.error_code}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[11px] text-slate-600 dark:text-gdc-muted" data-testid="webhook-recent-logs-empty">
            No delivery log rows in this window yet.
          </p>
        )}
        <p className="mt-2 inline-flex items-center gap-1 text-[10px] text-slate-500 dark:text-gdc-muted">
          <Link2 className="h-3 w-3" aria-hidden />
          Route outcomes: use Delivery and Errors tabs below, or{' '}
          <Link to={logsHref} className="font-semibold text-violet-700 hover:underline dark:text-violet-300">
            Logs explorer
          </Link>
          .
        </p>
      </div>
    </section>
  )
}
