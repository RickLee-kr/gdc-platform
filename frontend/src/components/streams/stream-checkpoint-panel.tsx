import { Loader2, RotateCcw, Save } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchStreamCheckpointManage,
  resetStreamCheckpointManage,
  updateStreamCheckpointManage,
  type StreamCheckpointManageResponse,
} from '../../api/gdcStreamConfiguration'
import { fetchStreamCheckpointHistory } from '../../api/gdcRuntime'
import { gdcUi } from '../../lib/gdc-ui-tokens'
import { usePlatformEnvironment } from '../../lib/use-platform-environment'
import { cn } from '../../lib/utils'
import { DangerousActionDialog } from '../ui/dangerous-action-dialog'

function CheckpointJsonEditor({
  label,
  value,
  onChange,
  testId,
  readOnly,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  testId?: string
  readOnly?: boolean
}) {
  return (
    <div>
      <label className={cn('mb-1 block', gdcUi.formLabel)}>{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        readOnly={readOnly}
        disabled={readOnly}
        className={cn(gdcUi.input, 'w-full font-mono text-[11px]', readOnly && 'cursor-not-allowed opacity-70')}
        data-testid={testId}
      />
    </div>
  )
}

function previewJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return String(value)
  }
}

export function StreamCheckpointPanel({ streamId, canOperate = true }: { streamId: number; canOperate?: boolean }) {
  const env = usePlatformEnvironment()
  const [data, setData] = useState<StreamCheckpointManageResponse | null>(null)
  const [history, setHistory] = useState<Array<{ log_id: number; created_at: string; checkpoint_after_preview?: string | null }>>([])
  const [legacyJson, setLegacyJson] = useState('')
  const [fetchJson, setFetchJson] = useState('')
  const [deliveryJson, setDeliveryJson] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)

  const reload = useCallback(async () => {
    const [ck, hist] = await Promise.all([
      fetchStreamCheckpointManage(streamId),
      fetchStreamCheckpointHistory(streamId, 20),
    ])
    setData(ck)
    setHistory(hist?.items ?? [])
    if (!ck) return

    if (ck.framework_enabled) {
      setFetchJson(JSON.stringify(ck.fetch_checkpoint ?? {}, null, 2))
      setDeliveryJson(JSON.stringify(ck.delivery_checkpoint ?? {}, null, 2))
      setLegacyJson('{}')
    } else {
      setLegacyJson(JSON.stringify(ck.legacy_checkpoint ?? ck.checkpoint_value ?? {}, null, 2))
      setFetchJson('{}')
      setDeliveryJson('{}')
    }
  }, [streamId])

  useEffect(() => {
    void reload()
  }, [reload])

  const pendingCheckpointValue = useMemo(() => {
    try {
      if (data?.framework_enabled) {
        const fetchCheckpoint = JSON.parse(fetchJson || '{}') as Record<string, unknown>
        const deliveryCheckpoint = JSON.parse(deliveryJson || '{}') as Record<string, unknown>
        return { ...fetchCheckpoint, delivery_checkpoint: deliveryCheckpoint }
      }
      return JSON.parse(legacyJson || '{}') as Record<string, unknown>
    } catch {
      return null
    }
  }, [data?.framework_enabled, fetchJson, deliveryJson, legacyJson])

  const previousCheckpointPreview = useMemo(() => {
    if (!data) return '{}'
    if (data.framework_enabled) {
      return previewJson({
        fetch_checkpoint: data.fetch_checkpoint ?? {},
        delivery_checkpoint: data.delivery_checkpoint ?? {},
      })
    }
    return previewJson(data.legacy_checkpoint ?? data.checkpoint_value ?? {})
  }, [data])

  const executeSave = async () => {
    if (!data || pendingCheckpointValue == null) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const updated = await updateStreamCheckpointManage(streamId, { checkpoint_value: pendingCheckpointValue })
      setData(updated)
      setMessage('Checkpoint updated.')
      setSaveOpen(false)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onReset = async () => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const updated = await resetStreamCheckpointManage(streamId, 'operator reset')
      setData(updated)
      setMessage('Checkpoint reset.')
      setResetOpen(false)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-4 dark:border-gdc-border dark:bg-gdc-card"
      data-testid="stream-checkpoint-panel"
    >
      <h3 className="mb-1 text-[13px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">
        Checkpoint Management
      </h3>

      {!data ? (
        <div className={cn('flex items-center gap-2 py-4 text-sm', gdcUi.textMuted)}>
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading checkpoint…
        </div>
      ) : (
        <div className={cn('space-y-3 text-[12px]', gdcUi.textTitle)}>
          <div className="grid gap-2 sm:grid-cols-2">
            <p>
              <span className="font-semibold">Mode:</span>{' '}
              {data.framework_enabled ? 'Fetch / Delivery (Framework)' : 'Single Checkpoint (Legacy)'}
            </p>
            <p>
              <span className="font-semibold">Type:</span> {data.checkpoint_type ?? 'Not configured'}
            </p>
            <p>
              <span className="font-semibold">Updated:</span>{' '}
              {data.updated_at ? new Date(data.updated_at).toLocaleString() : '—'}
            </p>
            <p>
              <span className="font-semibold">Last success:</span>{' '}
              {data.last_success_at ? new Date(data.last_success_at).toLocaleString() : '—'}
            </p>
            <p>
              <span className="font-semibold">Last failure:</span>{' '}
              {data.last_failure_at ? new Date(data.last_failure_at).toLocaleString() : '—'}
            </p>
            <p className="sm:col-span-2">
              <span className="font-semibold">Last collected event:</span>{' '}
              {data.last_collected_event_at ? new Date(data.last_collected_event_at).toLocaleString() : '—'}
            </p>
          </div>

          {data.framework_enabled ? (
            <div className="grid gap-3 lg:grid-cols-2">
              <CheckpointJsonEditor
                label="Fetch Checkpoint"
                value={fetchJson}
                onChange={setFetchJson}
                testId="checkpoint-fetch-json"
                readOnly={!canOperate}
              />
              <CheckpointJsonEditor
                label="Delivery Checkpoint"
                value={deliveryJson}
                onChange={setDeliveryJson}
                testId="checkpoint-delivery-json"
                readOnly={!canOperate}
              />
            </div>
          ) : (
            <CheckpointJsonEditor
              label="Single Checkpoint (Legacy)"
              value={legacyJson}
              onChange={setLegacyJson}
              testId="checkpoint-legacy-json"
              readOnly={!canOperate}
            />
          )}

          {canOperate ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                if (pendingCheckpointValue == null) {
                  setError('Checkpoint JSON is invalid.')
                  return
                }
                setSaveOpen(true)
              }}
              disabled={busy}
              className={cn(gdcUi.primaryBtn, 'inline-flex items-center gap-1')}
              data-testid="checkpoint-save-button"
            >
              <Save className="h-3.5 w-3.5" />
              Save checkpoint
            </button>
            <button
              type="button"
              onClick={() => setResetOpen(true)}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-rose-300 px-3 py-1.5 text-[12px] font-semibold text-rose-700 disabled:opacity-60 dark:border-rose-800 dark:text-rose-300"
              data-testid="checkpoint-reset-button"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </button>
          </div>
          ) : (
            <p className={cn('text-[11px]', gdcUi.textMuted)} data-testid="checkpoint-read-only-banner">
              Read-only: Viewer role cannot save or reset checkpoints.
            </p>
          )}

          {message ? <p className="text-emerald-700 dark:text-emerald-300">{message}</p> : null}
          {error ? <p className="text-rose-600 dark:text-rose-300">{error}</p> : null}

          {history.length > 0 ? (
            <details>
              <summary className="cursor-pointer font-semibold">Checkpoint history ({history.length})</summary>
              <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-[11px] text-slate-700 dark:text-slate-200">
                {history.map((item) => (
                  <li key={item.log_id} className="border-b border-slate-100 py-1 dark:border-gdc-border">
                    #{item.log_id} · {new Date(item.created_at).toLocaleString()}
                    {item.checkpoint_after_preview ? ` · ${item.checkpoint_after_preview}` : ''}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      )}

      <DangerousActionDialog
        open={saveOpen}
        title="Save checkpoint changes?"
        environmentLabel={env.label}
        description="Review previous and new checkpoint values before applying. This can change what the stream fetches next."
        impactItems={[
          `Stream #${streamId}`,
          `Previous: ${previousCheckpointPreview.slice(0, 180)}${previousCheckpointPreview.length > 180 ? '…' : ''}`,
          `New: ${previewJson(pendingCheckpointValue).slice(0, 180)}${previewJson(pendingCheckpointValue).length > 180 ? '…' : ''}`,
          'Action is audited as STREAM_CHECKPOINT_UPDATED.',
        ]}
        confirmLabel="Save checkpoint"
        confirmTone="warning"
        busy={busy}
        onCancel={() => {
          if (!busy) setSaveOpen(false)
        }}
        onConfirm={() => {
          if (busy) return
          void executeSave()
        }}
        testId="checkpoint-save-dialog"
      />

      <DangerousActionDialog
        open={resetOpen}
        title="Reset checkpoint?"
        environmentLabel={env.label}
        description="Clears the stream checkpoint position. The next poll may re-fetch previously collected data and can duplicate deliveries if destinations are not idempotent."
        impactItems={[
          `Stream #${streamId}`,
          `Current value: ${previousCheckpointPreview.slice(0, 180)}${previousCheckpointPreview.length > 180 ? '…' : ''}`,
          'Fetch and/or delivery checkpoint values will be cleared.',
          'Action is audited as STREAM_CHECKPOINT_RESET.',
        ]}
        typedConfirmPhrase="RESET"
        confirmLabel="Reset checkpoint"
        busy={busy}
        onCancel={() => {
          if (!busy) setResetOpen(false)
        }}
        onConfirm={() => {
          if (busy) return
          void onReset()
        }}
        testId="checkpoint-reset-dialog"
      />
    </section>
  )
}
