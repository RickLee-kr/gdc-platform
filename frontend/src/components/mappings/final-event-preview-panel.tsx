import { Code2, LayoutGrid, Loader2, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cn } from '../../lib/utils'
import { opTable, opTd, opTh, opThRow, opTr } from '../dashboard/widgets/operational-table-styles'
import { PanelChrome } from '../streams/mapping-json-tree'
import type { MappingPreviewState } from '../../hooks/useMappingPreview'
import type { MappingValidationWarning } from '../../api/gdcRuntimePreview'

type PreviewStage = 'raw' | 'mapped' | 'enriched' | 'comparison'

type FinalEventPreviewPanelProps = {
  preview: MappingPreviewState
  rawSampleEvent: Record<string, unknown> | null
  eventCount: number
  sampleEventIndex: number
  onSampleIndexChange: (idx: number) => void
  onRefresh: () => void
  localWarnings: MappingValidationWarning[]
}

function jsonBlock(data: unknown): string {
  if (data === null || data === undefined) return '—'
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

export function FinalEventPreviewPanel({
  preview,
  rawSampleEvent,
  eventCount,
  sampleEventIndex,
  onSampleIndexChange,
  onRefresh,
  localWarnings,
}: FinalEventPreviewPanelProps) {
  const [stage, setStage] = useState<PreviewStage>('enriched')
  const [view, setView] = useState<'json' | 'table'>('json')

  const mappedEvent = preview.mapped?.mapped_events?.[sampleEventIndex] ?? null
  const finalEvent = preview.final?.final_events?.[sampleEventIndex] ?? null
  const allWarnings = useMemo(
    () => [...localWarnings, ...preview.validationWarnings],
    [localWarnings, preview.validationWarnings],
  )
  const displayObject = useMemo(() => {
    if (stage === 'raw') return rawSampleEvent
    if (stage === 'mapped') return mappedEvent
    return finalEvent
  }, [stage, rawSampleEvent, mappedEvent, finalEvent])

  const stageLabel: Record<PreviewStage, string> = {
    raw: 'Raw sample event',
    mapped: 'Mapped event',
    enriched: 'Enriched final event',
    comparison: 'Raw vs final',
  }

  return (
    <PanelChrome
      title="Final event preview"
      className="max-h-[min(72vh,780px)]"
      right={
        <div className="flex items-center gap-1">
          {preview.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-600" aria-hidden /> : null}
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200/90 px-2 text-[11px] font-medium hover:bg-slate-50 dark:border-gdc-border dark:hover:bg-gdc-rowHover"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Refresh
          </button>
        </div>
      }
    >
      <div className="space-y-2 p-2">
        <p className="text-[10px] text-slate-500 dark:text-gdc-muted">
          Previews use the runtime mapping and enrichment engines (read-only). Event {sampleEventIndex + 1} of{' '}
          {Math.max(eventCount, preview.mapped?.preview_event_count ?? 0, 1)}.
        </p>
        {eventCount > 1 ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[10px] font-semibold text-slate-600 dark:text-gdc-mutedStrong" htmlFor="sample-idx">
              Sample event
            </label>
            <select
              id="sample-idx"
              value={sampleEventIndex}
              onChange={(e) => onSampleIndexChange(Number(e.target.value))}
              className="h-7 rounded-md border border-slate-200/90 bg-white px-2 text-[11px] dark:border-gdc-border dark:bg-gdc-card"
            >
              {Array.from({ length: eventCount }, (_, i) => (
                <option key={i} value={i}>
                  Event {i + 1}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-1">
          {(['raw', 'mapped', 'enriched', 'comparison'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStage(s)}
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize',
                stage === s ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-gdc-elevated dark:text-gdc-muted',
              )}
            >
              {s === 'enriched' ? 'Final' : s}
            </button>
          ))}
        </div>

        {allWarnings.length > 0 ? (
          <ul className="max-h-24 space-y-1 overflow-auto rounded-md border border-amber-200/80 bg-amber-500/[0.06] p-2 text-[10px] dark:border-amber-500/30">
            {allWarnings.slice(0, 8).map((w, i) => (
              <li key={`${w.code}-${i}`} className={w.severity === 'error' ? 'text-red-800 dark:text-red-300' : 'text-amber-900 dark:text-amber-100'}>
                <span className="font-semibold">{w.code}: </span>
                {w.message}
              </li>
            ))}
            {allWarnings.length > 8 ? <li className="text-slate-500">+{allWarnings.length - 8} more</li> : null}
          </ul>
        ) : null}

        {preview.error ? (
          <p className="rounded-md border border-red-200/80 bg-red-500/[0.06] p-2 text-[11px] text-red-800 dark:text-red-200">{preview.error}</p>
        ) : null}

        <div className="flex rounded-md border border-slate-200/80 bg-slate-50/80 p-0.5 dark:border-gdc-border dark:bg-gdc-section">
          <button
            type="button"
            onClick={() => setView('json')}
            className={cn(
              'flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-[11px] font-semibold',
              view === 'json' ? 'bg-white shadow-sm dark:bg-gdc-card' : 'text-slate-500',
            )}
          >
            <Code2 className="h-3.5 w-3.5" aria-hidden />
            JSON
          </button>
          <button
            type="button"
            onClick={() => setView('table')}
            className={cn(
              'flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-[11px] font-semibold',
              view === 'table' ? 'bg-white shadow-sm dark:bg-gdc-card' : 'text-slate-500',
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
            Table
          </button>
        </div>

        {stage === 'comparison' ? (
          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <p className="mb-1 text-[10px] font-semibold text-slate-500">{stageLabel.raw}</p>
              <pre className="max-h-[36vh] overflow-auto rounded-md border border-slate-200/60 bg-slate-900 p-2 text-[10px] text-slate-200 dark:border-gdc-border">
                {jsonBlock(rawSampleEvent)}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-[10px] font-semibold text-slate-500">{stageLabel.enriched}</p>
              <pre className="max-h-[36vh] overflow-auto rounded-md border border-slate-200/60 bg-slate-950 p-2 text-[10px] text-emerald-100 dark:border-gdc-border">
                {jsonBlock(finalEvent)}
              </pre>
            </div>
          </div>
        ) : view === 'json' ? (
          <pre className="max-h-[40vh] overflow-auto rounded-md border border-slate-200/60 bg-slate-950 p-2 text-[10px] leading-relaxed text-emerald-100 dark:border-gdc-border">
            {jsonBlock(displayObject)}
          </pre>
        ) : (
          <div className="max-h-[40vh] overflow-auto rounded-md border border-slate-200/60 bg-white dark:border-gdc-border dark:bg-gdc-section">
            <table className={opTable}>
              <thead>
                <tr className={opThRow}>
                  <th className={opTh}>Field</th>
                  <th className={opTh}>Value</th>
                </tr>
              </thead>
              <tbody>
                {displayObject && typeof displayObject === 'object'
                  ? Object.entries(displayObject as Record<string, unknown>).map(([k, v]) => (
                      <tr key={k} className={opTr}>
                        <td className={cn(opTd, 'font-mono text-[10px] text-violet-800 dark:text-violet-200')}>{k}</td>
                        <td className={cn(opTd, 'max-w-[180px] truncate font-mono text-[10px]')}>{v === null ? 'null' : String(v)}</td>
                      </tr>
                    ))
                  : (
                      <tr className={opTr}>
                        <td colSpan={2} className={cn(opTd, 'text-slate-500')}>
                          No preview data for this stage yet.
                        </td>
                      </tr>
                    )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PanelChrome>
  )
}
