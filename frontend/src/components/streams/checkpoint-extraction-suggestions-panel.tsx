import { useMemo } from 'react'
import {
  analyzeCheckpointExtractionSuggestions,
  type CheckpointFieldType,
} from './checkpoint-extraction-suggestions'

export type CheckpointExtractionApplyHandlers = {
  onApplyEventArrayPath?: (path: string) => void
  onApplyCheckpointExtraction?: (patch: {
    checkpointType: CheckpointFieldType
    extractionPathRelative: string
    extractionPathAbsolute: string
  }) => void
  onApplySortRecommendation?: (patch: {
    sortLabel: string
    tieBreakerLabel: string | null
    primaryFieldName: string
    tieBreakerFieldName: string | null
  }) => void
}

type CheckpointExtractionSuggestionsPanelProps = {
  parsedJson: unknown | null
  applyHandlers?: CheckpointExtractionApplyHandlers
  className?: string
}

function fieldNameFromSortLabel(sortLabel: string | null): string | null {
  if (!sortLabel) return null
  return sortLabel.replace(/\s+ASC$/i, '').trim() || null
}

export function CheckpointExtractionSuggestionsPanel({
  parsedJson,
  applyHandlers,
  className,
}: CheckpointExtractionSuggestionsPanelProps) {
  const suggestions = useMemo(() => analyzeCheckpointExtractionSuggestions(parsedJson), [parsedJson])

  if (parsedJson === null || parsedJson === undefined) return null

  const primaryField = fieldNameFromSortLabel(suggestions.suggestedSort)
  const tieField = fieldNameFromSortLabel(suggestions.suggestedTieBreaker)

  return (
    <section
      data-testid="checkpoint-extraction-suggestions-panel"
      className={`rounded-lg border border-violet-200/80 bg-violet-50/50 p-3 text-[11px] leading-relaxed text-violet-950 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-100 ${className ?? ''}`}
    >
      <h4 className="text-[12px] font-semibold text-violet-900 dark:text-violet-50">Checkpoint Extraction Suggestions</h4>
      <p className="mt-1 text-[10px] text-violet-800/90 dark:text-violet-100/80">
        Detected candidates from this API Test / JSON Preview sample. Review before applying — nothing is configured automatically.
      </p>

      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        <div>
          <dt className="font-semibold">Suggested checkpoint type</dt>
          <dd>{suggestions.suggestedCheckpointTypeLabel}</dd>
        </div>
        <div>
          <dt className="font-semibold">Suggested extraction path</dt>
          <dd className="font-mono text-[10px]">
            {suggestions.suggestedExtractionPathAbsolute ?? suggestions.suggestedExtractionPathRelative ?? '—'}
          </dd>
          {suggestions.suggestedExtractionPathRelative &&
          suggestions.suggestedExtractionPathRelative !== suggestions.suggestedExtractionPathAbsolute ? (
            <dd className="mt-0.5 font-mono text-[10px] text-violet-800/80">
              Relative to each event: {suggestions.suggestedExtractionPathRelative}
            </dd>
          ) : null}
        </div>
        <div>
          <dt className="font-semibold">Suggested event array path</dt>
          <dd className="font-mono text-[10px]">{suggestions.suggestedEventArrayPath ?? '—'}</dd>
        </div>
        <div>
          <dt className="font-semibold">Suggested stable sort</dt>
          <dd>{suggestions.suggestedSort ?? '—'}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-semibold">Suggested tie-breaker</dt>
          <dd>{suggestions.suggestedTieBreaker ?? '—'}</dd>
        </div>
      </dl>

      {suggestions.warnings.length > 0 ? (
        <div className="mt-3 rounded border border-amber-300/60 bg-amber-50/70 p-2 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="font-semibold text-amber-900 dark:text-amber-100">Warnings</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-amber-950 dark:text-amber-50">
            {suggestions.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul className="mt-2 space-y-0.5 text-[10px] text-violet-800/85 dark:text-violet-100/75">
        {suggestions.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>

      {applyHandlers ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {suggestions.suggestedEventArrayPath && applyHandlers.onApplyEventArrayPath ? (
            <button
              type="button"
              data-testid="apply-event-array-path"
              onClick={() => applyHandlers.onApplyEventArrayPath?.(suggestions.suggestedEventArrayPath!)}
              className="h-8 rounded-md border border-violet-400/50 bg-white px-2.5 text-[11px] font-semibold text-violet-800 hover:bg-violet-500/10 dark:border-violet-400/40 dark:bg-violet-950/20 dark:text-violet-100"
            >
              Apply event array path
            </button>
          ) : null}
          {suggestions.suggestedExtractionPathRelative &&
          suggestions.suggestedCheckpointType &&
          applyHandlers.onApplyCheckpointExtraction ? (
            <button
              type="button"
              data-testid="apply-checkpoint-extraction"
              onClick={() =>
                applyHandlers.onApplyCheckpointExtraction?.({
                  checkpointType: suggestions.suggestedCheckpointType!,
                  extractionPathRelative: suggestions.suggestedExtractionPathRelative!,
                  extractionPathAbsolute: suggestions.suggestedExtractionPathAbsolute ?? suggestions.suggestedExtractionPathRelative!,
                })
              }
              className="h-8 rounded-md border border-violet-400/50 bg-white px-2.5 text-[11px] font-semibold text-violet-800 hover:bg-violet-500/10 dark:border-violet-400/40 dark:bg-violet-950/20 dark:text-violet-100"
            >
              Apply checkpoint extraction path
            </button>
          ) : null}
          {suggestions.suggestedSort && primaryField && applyHandlers.onApplySortRecommendation ? (
            <button
              type="button"
              data-testid="apply-sort-recommendation"
              onClick={() =>
                applyHandlers.onApplySortRecommendation?.({
                  sortLabel: suggestions.suggestedSort!,
                  tieBreakerLabel: suggestions.suggestedTieBreaker,
                  primaryFieldName: primaryField,
                  tieBreakerFieldName: tieField,
                })
              }
              className="h-8 rounded-md border border-violet-400/50 bg-white px-2.5 text-[11px] font-semibold text-violet-800 hover:bg-violet-500/10 dark:border-violet-400/40 dark:bg-violet-950/20 dark:text-violet-100"
            >
              Apply sort recommendation
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
