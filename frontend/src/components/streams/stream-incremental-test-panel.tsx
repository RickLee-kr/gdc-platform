import { Loader2, Play } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  fetchStreamCheckpointManage,
  runStreamIncrementalTest,
  type StreamIncrementalTestResponse,
  type StreamSampleDataResponse,
} from '../../api/gdcStreamConfiguration'
import { gdcUi } from '../../lib/gdc-ui-tokens'
import { cn } from '../../lib/utils'

export function StreamIncrementalTestPanel({
  streamId,
  initialSample,
  canOperate = true,
}: {
  streamId: number
  initialSample: StreamSampleDataResponse | null
  canOperate?: boolean
}) {
  const [checkpointJson, setCheckpointJson] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<StreamIncrementalTestResponse | null>(null)
  const [currentCheckpoint, setCurrentCheckpoint] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const ck = await fetchStreamCheckpointManage(streamId)
      if (cancelled || !ck?.checkpoint_value) return
      setCurrentCheckpoint(JSON.stringify(ck.checkpoint_value, null, 2))
      setCheckpointJson(JSON.stringify(ck.checkpoint_value, null, 2))
    })()
    return () => {
      cancelled = true
    }
  }, [streamId])

  const onRun = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      let checkpoint_override: Record<string, unknown> | undefined
      if (checkpointJson.trim()) {
        checkpoint_override = JSON.parse(checkpointJson) as Record<string, unknown>
      }
      const res = await runStreamIncrementalTest(streamId, { checkpoint_override })
      setResult(res)
      if (!res.checkpoint_unchanged) {
        setError('Warning: production checkpoint may have changed — contact an administrator.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [checkpointJson, streamId])

  const savedIncremental = initialSample?.incremental_test_result

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-4 dark:border-gdc-border dark:bg-gdc-card"
      data-testid="stream-incremental-test-panel"
    >
      <h3 className="mb-1 text-[13px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">
        Incremental Test
      </h3>
      <p className={cn('mb-3 text-[11px]', gdcUi.textMuted)}>
        Test mode never advances the production checkpoint.
      </p>

      {currentCheckpoint ? (
        <details className="mb-3">
          <summary className={cn('cursor-pointer text-[12px] font-semibold', gdcUi.textTitle)}>
            Current checkpoint
          </summary>
          <pre className="mt-1 max-h-32 overflow-auto rounded bg-slate-950/90 p-2 text-[10px] text-slate-100">
            {currentCheckpoint}
          </pre>
        </details>
      ) : null}

      <label className={cn('mb-1 block', gdcUi.formLabel)}>Checkpoint override (JSON)</label>
      <textarea
        value={checkpointJson}
        onChange={(e) => setCheckpointJson(e.target.value)}
        rows={4}
        className={cn(gdcUi.input, 'mb-3 w-full font-mono text-[11px]')}
        data-testid="incremental-test-checkpoint-input"
      />

      {canOperate ? (
      <button
        type="button"
        onClick={() => void onRun()}
        disabled={busy}
        className={cn(gdcUi.primaryBtn, 'inline-flex items-center gap-1.5')}
        data-testid="incremental-test-run-button"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        Run incremental test
      </button>
      ) : (
        <p className={cn('text-[11px]', gdcUi.textMuted)} data-testid="incremental-test-read-only-banner">
          Read-only: Viewer role cannot run incremental tests.
        </p>
      )}

      {error ? <p className="mt-2 text-[12px] text-rose-600 dark:text-rose-300">{error}</p> : null}

      {savedIncremental && !result ? (
        <div className="mt-3 rounded border border-slate-100 p-2 text-[11px] text-slate-800 dark:border-gdc-border dark:text-gdc-foreground">
          <p className="font-semibold">Last saved test result</p>
          <pre className="mt-1 max-h-32 overflow-auto text-[10px] text-slate-800 dark:text-slate-100">
            {JSON.stringify(savedIncremental, null, 2)}
          </pre>
        </div>
      ) : null}

      {result ? (
        <div className={cn('mt-3 space-y-2 text-[12px]', gdcUi.textTitle)} data-testid="incremental-test-result">
          <p className={result.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}>
            {result.message} {result.http_status != null ? `(HTTP ${result.http_status})` : ''}
          </p>
          <p>Checkpoint unchanged: {result.checkpoint_unchanged ? 'Yes' : 'No'}</p>
          {result.preview_events.length > 0 ? (
            <details>
              <summary className="cursor-pointer font-semibold">Event preview ({result.preview_events.length})</summary>
              <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-950/90 p-2 text-[10px] text-slate-100">
                {JSON.stringify(result.preview_events, null, 2)}
              </pre>
            </details>
          ) : null}
          {result.next_checkpoint_preview ? (
            <details>
              <summary className="cursor-pointer font-semibold">Next checkpoint (preview only)</summary>
              <pre className="mt-1 max-h-32 overflow-auto rounded bg-slate-950/90 p-2 text-[10px] text-slate-100">
                {JSON.stringify(result.next_checkpoint_preview, null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
