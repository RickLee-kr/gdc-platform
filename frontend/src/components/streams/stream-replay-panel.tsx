import { Loader2, RotateCcw } from 'lucide-react'
import { useCallback, useState } from 'react'
import { runStreamOperationalReplay, type StreamReplayMode, type StreamReplayResponse } from '../../api/gdcStreamConfiguration'
import { gdcUi } from '../../lib/gdc-ui-tokens'
import { usePlatformEnvironment } from '../../lib/use-platform-environment'
import { cn } from '../../lib/utils'
import { DangerousActionDialog } from '../ui/dangerous-action-dialog'

export function StreamReplayPanel({ streamId, canOperate = true }: { streamId: number; canOperate?: boolean }) {
  const env = usePlatformEnvironment()
  const [mode, setMode] = useState<StreamReplayMode>('time_range')
  const [dryRun, setDryRun] = useState(true)
  const [applyDedup, setApplyDedup] = useState(true)
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [lastNMinutes, setLastNMinutes] = useState('60')
  const [deliveryLogId, setDeliveryLogId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<StreamReplayResponse | null>(null)
  const [liveConfirmOpen, setLiveConfirmOpen] = useState(false)

  const executeRun = useCallback(async () => {
    setBusy(true)
    setError(null)
    setLiveConfirmOpen(false)
    try {
      const payload: Parameters<typeof runStreamOperationalReplay>[1] = {
        mode,
        dry_run: dryRun,
        apply_dedup: applyDedup,
      }
      if (mode === 'time_range') {
        if (!startTime || !endTime) throw new Error('Start and end time are required for time range replay.')
        payload.start_time = new Date(startTime).toISOString()
        payload.end_time = new Date(endTime).toISOString()
      }
      if (mode === 'last_n_minutes') {
        payload.last_n_minutes = Number(lastNMinutes) || 60
      }
      if (mode === 'delivery_log') {
        const id = Number(deliveryLogId)
        if (!Number.isFinite(id)) throw new Error('Delivery log id is required.')
        payload.delivery_log_id = id
      }
      const res = await runStreamOperationalReplay(streamId, payload)
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [applyDedup, deliveryLogId, dryRun, endTime, lastNMinutes, mode, startTime, streamId])

  const onRunClick = useCallback(() => {
    if (!canOperate || busy) return
    if (!dryRun) {
      setLiveConfirmOpen(true)
      return
    }
    void executeRun()
  }, [busy, canOperate, dryRun, executeRun])

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-4 dark:border-gdc-border dark:bg-gdc-card"
      data-testid="stream-replay-panel"
    >
      <h3 className="mb-1 text-[13px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">Replay</h3>
      <p className={cn('mb-3 text-[11px]', gdcUi.textMuted)}>
        Dry run previews delivery without sending to destinations. Production checkpoint is never advanced.
      </p>

      {!canOperate ? (
        <p className={cn('mb-3 text-[11px]', gdcUi.textMuted)} data-testid="replay-read-only-banner">
          Read-only: Viewer role cannot run operational replay.
        </p>
      ) : null}

      <label className={cn('mb-1 block', gdcUi.formLabel)}>Mode</label>
      <select
        value={mode}
        onChange={(e) => setMode(e.target.value as StreamReplayMode)}
        className={cn(
          gdcUi.select,
          'mb-3 w-full text-[12px] dark:[color-scheme:dark] [&_option]:bg-gdc-card [&_option]:text-gdc-foreground',
        )}
        data-testid="replay-mode-select"
      >
        <option value="time_range">Time range</option>
        <option value="last_n_minutes">Last N minutes</option>
        <option value="checkpoint_preview">Checkpoint preview run</option>
        <option value="delivery_log">Specific delivery log</option>
        <option value="failed_events">Failed events only</option>
      </select>

      {mode === 'time_range' ? (
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <input
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className={cn(gdcUi.input, 'text-[12px]')}
            aria-label="Replay start time"
          />
          <input
            type="datetime-local"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className={cn(gdcUi.input, 'text-[12px]')}
            aria-label="Replay end time"
          />
        </div>
      ) : null}

      {mode === 'last_n_minutes' ? (
        <input
          type="number"
          value={lastNMinutes}
          onChange={(e) => setLastNMinutes(e.target.value)}
          className={cn(gdcUi.input, 'mb-3 w-full text-[12px]')}
          placeholder="Minutes"
        />
      ) : null}

      {mode === 'delivery_log' ? (
        <input
          type="number"
          value={deliveryLogId}
          onChange={(e) => setDeliveryLogId(e.target.value)}
          className={cn(gdcUi.input, 'mb-3 w-full text-[12px]')}
          placeholder="Delivery log id"
        />
      ) : null}

      <label className={cn('mb-3 flex items-center gap-2 text-[12px]', gdcUi.textTitle)}>
        <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} data-testid="replay-dry-run" />
        Dry run (no destination send)
      </label>

      <label className={cn('mb-1 flex items-center gap-2 text-[12px]', gdcUi.textTitle)}>
        <input
          type="checkbox"
          checked={applyDedup}
          onChange={(e) => setApplyDedup(e.target.checked)}
          data-testid="replay-apply-dedup"
        />
        Apply deduplication
      </label>
      <p className={cn('mb-3 text-[11px]', gdcUi.textMuted)}>Skip events already delivered when replaying.</p>

      {canOperate ? (
      <button
        type="button"
        onClick={onRunClick}
        disabled={busy}
        className={cn(gdcUi.secondaryBtn, 'inline-flex items-center gap-1.5 disabled:opacity-60')}
        data-testid="replay-run-button"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
        {dryRun ? 'Preview replay' : 'Run replay'}
      </button>
      ) : null}

      {error ? <p className="mt-2 text-[12px] text-rose-600 dark:text-rose-300">{error}</p> : null}

      {result ? (
        <div
          className={cn('mt-3 rounded border border-slate-100 p-2 text-[12px] dark:border-gdc-border', gdcUi.textTitle)}
          data-testid="replay-result"
        >
          <p>
            <span className="font-semibold">Outcome:</span> {result.outcome}
          </p>
          <p>{result.message}</p>
          {result.event_count != null ? <p>Events: {result.event_count}</p> : null}
          <p>Checkpoint unchanged: {result.checkpoint_unchanged ? 'Yes' : 'No'}</p>
        </div>
      ) : null}

      <DangerousActionDialog
        open={liveConfirmOpen}
        title="Run live replay?"
        environmentLabel={env.label}
        description="Events will be sent to destinations. Checkpoint is not advanced."
        impactItems={[
          `Stream #${streamId}`,
          `Mode: ${mode}`,
          applyDedup ? 'Deduplication enabled' : 'Deduplication disabled',
        ]}
        confirmLabel="Run live replay"
        confirmTone="warning"
        busy={busy}
        onCancel={() => setLiveConfirmOpen(false)}
        onConfirm={() => void executeRun()}
        testId="replay-live-confirm-dialog"
      />
    </section>
  )
}
