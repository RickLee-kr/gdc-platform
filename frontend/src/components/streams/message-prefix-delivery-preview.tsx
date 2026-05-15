import { useEffect, useMemo, useState } from 'react'
import {
  runDeliveryPrefixFormatPreview,
  type DeliveryPrefixFormatPreviewRequest,
} from '../../api/gdcRuntimePreview'

const PREVIEW_PANEL =
  'max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-md border border-slate-200/80 bg-slate-950/[0.03] p-2 font-mono text-[11px] leading-snug text-slate-800 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100'

export type MessagePrefixDeliveryPreviewProps = {
  request: DeliveryPrefixFormatPreviewRequest
}

export function MessagePrefixDeliveryPreview({ request }: MessagePrefixDeliveryPreviewProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resolvedPrefix, setResolvedPrefix] = useState('')
  const [finalPayload, setFinalPayload] = useState('')
  const [prefixEnabled, setPrefixEnabled] = useState(true)

  const signature = useMemo(() => JSON.stringify(request), [request])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError(null)
      void runDeliveryPrefixFormatPreview(request)
        .then((res) => {
          if (cancelled) return
          setResolvedPrefix(res.resolved_prefix)
          setFinalPayload(res.final_payload)
          setPrefixEnabled(res.message_prefix_enabled)
        })
        .catch((e: unknown) => {
          if (cancelled) return
          setError(e instanceof Error ? e.message : 'Preview failed')
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 280)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // `signature` is a stable serialization of `request` for debounced refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- request captured when signature changes
  }, [signature])

  return (
    <div className="mt-3 space-y-2 rounded-md border border-dashed border-slate-300/80 p-2 dark:border-gdc-borderStrong/80">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Preview</p>
      {loading ? <p className="text-[11px] text-slate-500 dark:text-gdc-muted">Updating preview…</p> : null}
      {error ? <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p> : null}
      {!prefixEnabled ? (
        <p className="text-[11px] font-medium text-slate-600 dark:text-gdc-mutedStrong">Raw JSON only</p>
      ) : (
        <div className="space-y-1">
          <p className="text-[10px] text-slate-500 dark:text-gdc-muted">Prefix</p>
          <div className={PREVIEW_PANEL}>{resolvedPrefix.trim().length ? resolvedPrefix : '(empty)'}</div>
        </div>
      )}
      <div className="space-y-1">
        <p className="text-[10px] text-slate-500 dark:text-gdc-muted">Final payload</p>
        <div className={PREVIEW_PANEL}>{finalPayload}</div>
      </div>
    </div>
  )
}
