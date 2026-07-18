import { Loader2, Save } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  fetchStreamDeduplication,
  saveStreamDeduplication,
  type StreamDeduplicationConfig,
  type StreamDeduplicationStatus,
  type StreamDedupRuntimeSummary,
} from '../../api/gdcStreamConfiguration'
import { gdcUi } from '../../lib/gdc-ui-tokens'
import { cn } from '../../lib/utils'

const KEY_FIELDS = ['event_id', 'stellar_uuid', 'id', 'custom_jsonpath'] as const

function formatDedupHandling(value: string | null | undefined): string {
  if (value === 'keep_latest') return 'Keep latest'
  if (value === 'keep_first') return 'Keep first'
  if (value === 'skip_duplicate') return 'Skip duplicate'
  return value?.trim() || '—'
}

function formatDedupScope(value: string | null | undefined): string {
  if (value === 'checkpoint_window') return 'Checkpoint window'
  if (value === 'last_n_hours') return 'Last N hours'
  if (value === 'current_run') return 'Current run only'
  return value?.trim() || '—'
}

function formatRuntimeAt(value: string | null | undefined): string {
  if (!value?.trim()) return '—'
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return value
  return new Date(parsed).toLocaleString()
}

function asCount(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return String(Number(value))
  return '—'
}

function hasRuntimeStats(summary: StreamDedupRuntimeSummary | null | undefined): boolean {
  if (!summary) return false
  return (
    summary.total_events != null ||
    summary.inserted != null ||
    summary.duplicate_events != null ||
    Boolean(summary.recorded_at?.trim()) ||
    Boolean(summary.dedup_scope?.trim()) ||
    Boolean(summary.duplicate_handling?.trim())
  )
}

function DedupRuntimeStatsBlock({
  summary,
  degraded,
  fallbackDuplicateCount,
}: {
  summary: StreamDedupRuntimeSummary | null | undefined
  degraded: boolean
  fallbackDuplicateCount: number
}) {
  const showStats = hasRuntimeStats(summary)
  const duplicateCount =
    summary?.duplicate_events != null ? summary.duplicate_events : degraded ? null : fallbackDuplicateCount

  return (
    <div className="mt-4 border-t border-slate-100 pt-3 dark:border-gdc-border" data-testid="dedup-runtime-stats">
      <h4 className={cn('mb-1 text-[12px] font-semibold', gdcUi.textTitle)}>Recent runtime</h4>
      <p className={cn('mb-2 text-[11px]', gdcUi.textMuted)}>
        Last dedup counters from delivery logs (read-only).
      </p>

      {degraded ? (
        <p className="mb-2 text-[12px] text-amber-700 dark:text-amber-300" data-testid="dedup-runtime-degraded">
          Stats lookup degraded (timeout or query pressure). Configuration can still be edited.
        </p>
      ) : null}

      {!showStats && !degraded ? (
        <p className={cn('text-[12px]', gdcUi.textMuted)} data-testid="dedup-runtime-empty">
          No recent dedup runtime stats for this stream.
        </p>
      ) : null}

      {showStats ? (
        <dl className="grid grid-cols-1 gap-1.5 text-[12px] sm:grid-cols-2" data-testid="dedup-runtime-stats-grid">
          <div>
            <dt className={gdcUi.textMuted}>Last run</dt>
            <dd className={gdcUi.textTitle}>{formatRuntimeAt(summary?.recorded_at)}</dd>
          </div>
          <div>
            <dt className={gdcUi.textMuted}>Input events</dt>
            <dd className={gdcUi.textTitle}>{asCount(summary?.total_events)}</dd>
          </div>
          <div>
            <dt className={gdcUi.textMuted}>Duplicates skipped</dt>
            <dd className={gdcUi.textTitle}>{asCount(duplicateCount)}</dd>
          </div>
          <div>
            <dt className={gdcUi.textMuted}>Forwarded</dt>
            <dd className={gdcUi.textTitle}>{asCount(summary?.inserted)}</dd>
          </div>
          <div>
            <dt className={gdcUi.textMuted}>Applied scope</dt>
            <dd className={gdcUi.textTitle}>{formatDedupScope(summary?.dedup_scope)}</dd>
          </div>
          <div>
            <dt className={gdcUi.textMuted}>Duplicate handling</dt>
            <dd className={gdcUi.textTitle}>{formatDedupHandling(summary?.duplicate_handling)}</dd>
          </div>
        </dl>
      ) : null}
    </div>
  )
}

export function StreamDedupPanel({ streamId, canOperate = true }: { streamId: number; canOperate?: boolean }) {
  const [config, setConfig] = useState<StreamDeduplicationStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const row = await fetchStreamDeduplication(streamId)
      if (row) setConfig(row)
      else
        setConfig({
          enabled: false,
          key_field: 'event_id',
          custom_jsonpath: null,
          duplicate_handling: 'skip_duplicate',
          scope: 'current_run',
          window_hours: null,
          last_runtime_duplicate_count: 0,
          last_runtime_dedup_summary: null,
          last_runtime_stats_degraded: false,
        })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setConfig((prev) =>
        prev ?? {
          enabled: false,
          key_field: 'event_id',
          custom_jsonpath: null,
          duplicate_handling: 'skip_duplicate',
          scope: 'current_run',
          window_hours: null,
          last_runtime_duplicate_count: 0,
          last_runtime_dedup_summary: null,
          last_runtime_stats_degraded: false,
        },
      )
    }
  }, [streamId])

  useEffect(() => {
    void reload()
  }, [reload])

  const patch = (partial: Partial<StreamDeduplicationConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...partial } : prev))
  }

  const onSave = async () => {
    if (!config) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const payload: StreamDeduplicationConfig = {
        enabled: config.enabled,
        key_field: config.key_field,
        custom_jsonpath: config.custom_jsonpath,
        duplicate_handling: config.duplicate_handling,
        scope: config.scope,
        window_hours: config.window_hours,
      }
      await saveStreamDeduplication(streamId, payload)
      await reload()
      setMessage('Deduplication settings saved.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!config) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-gdc-border dark:bg-gdc-card">
        <Loader2 className="h-4 w-4 animate-spin text-slate-500 dark:text-gdc-muted" />
      </section>
    )
  }

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-4 dark:border-gdc-border dark:bg-gdc-card"
      data-testid="stream-dedup-panel"
    >
      <h3 className="mb-1 text-[13px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">
        Deduplication
      </h3>
      <p className={cn('mb-3 text-[11px]', gdcUi.textMuted)}>
        Configure per-stream dedup policy. Runtime uses event_id by default when enabled.
      </p>

      <label className={cn('mb-3 flex items-center gap-2 text-[12px]', gdcUi.textTitle)}>
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => patch({ enabled: e.target.checked })}
          disabled={!canOperate}
          data-testid="dedup-enabled"
        />
        Enable deduplication
      </label>

      <label className={cn('mb-1 block', gdcUi.formLabel)}>Dedup key field</label>
      <select
        value={config.key_field}
        onChange={(e) => patch({ key_field: e.target.value })}
        disabled={!canOperate}
        className={cn(
          gdcUi.select,
          'mb-3 w-full text-[12px] dark:[color-scheme:dark] [&_option]:bg-gdc-card [&_option]:text-gdc-foreground',
        )}
      >
        {KEY_FIELDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>

      {config.key_field === 'custom_jsonpath' ? (
        <>
          <label className={cn('mb-1 block', gdcUi.formLabel)}>Custom JSONPath</label>
          <input
            type="text"
            value={config.custom_jsonpath ?? ''}
            onChange={(e) => patch({ custom_jsonpath: e.target.value || null })}
            placeholder="$.event_id"
            className={cn(gdcUi.input, 'mb-3 w-full font-mono text-[12px]')}
            data-testid="dedup-custom-jsonpath"
          />
        </>
      ) : null}

      <label className={cn('mb-1 block', gdcUi.formLabel)}>Duplicate handling</label>
      <select
        value={config.duplicate_handling}
        onChange={(e) => patch({ duplicate_handling: e.target.value as StreamDeduplicationConfig['duplicate_handling'] })}
        className={cn(
          gdcUi.select,
          'mb-3 w-full text-[12px] dark:[color-scheme:dark] [&_option]:bg-gdc-card [&_option]:text-gdc-foreground',
        )}
      >
        <option value="skip_duplicate">Skip duplicate</option>
        <option value="keep_latest">Keep latest</option>
        <option value="keep_first">Keep first</option>
      </select>

      <label className={cn('mb-1 block', gdcUi.formLabel)}>Dedup scope</label>
      <select
        value={config.scope}
        onChange={(e) => patch({ scope: e.target.value as StreamDeduplicationConfig['scope'] })}
        className={cn(
          gdcUi.select,
          'mb-3 w-full text-[12px] dark:[color-scheme:dark] [&_option]:bg-gdc-card [&_option]:text-gdc-foreground',
        )}
      >
        <option value="current_run">Current run only</option>
        <option value="checkpoint_window">Checkpoint window</option>
        <option value="last_n_hours">Last N hours</option>
      </select>

      {config.scope === 'last_n_hours' ? (
        <>
          <label className={cn('mb-1 block', gdcUi.formLabel)}>Window (hours)</label>
          <input
            type="number"
            min={1}
            value={config.window_hours ?? 24}
            onChange={(e) => patch({ window_hours: Number(e.target.value) || 24 })}
            className={cn(gdcUi.input, 'mb-3 w-full text-[12px]')}
          />
        </>
      ) : null}

      <button
        type="button"
        onClick={() => void onSave()}
        disabled={busy || !canOperate}
        className={cn(gdcUi.primaryBtn, 'inline-flex items-center gap-1.5')}
        data-testid="dedup-save-button"
        title={canOperate ? undefined : 'Viewer role cannot change deduplication.'}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        Save deduplication
      </button>

      {!canOperate ? (
        <p className={cn('mt-2 text-[11px]', gdcUi.textMuted)} data-testid="dedup-read-only-banner">
          Read-only: Viewer role cannot save deduplication settings.
        </p>
      ) : null}

      {message ? <p className="mt-2 text-[12px] text-emerald-700 dark:text-emerald-300">{message}</p> : null}
      {error ? <p className="mt-2 text-[12px] text-rose-600 dark:text-rose-300">{error}</p> : null}

      <DedupRuntimeStatsBlock
        summary={config.last_runtime_dedup_summary}
        degraded={Boolean(config.last_runtime_stats_degraded)}
        fallbackDuplicateCount={config.last_runtime_duplicate_count ?? 0}
      />
    </section>
  )
}
