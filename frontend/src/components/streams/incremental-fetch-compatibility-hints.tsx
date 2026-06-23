import { useMemo } from 'react'
import { cn } from '../../lib/utils'
import {
  analyzeIncrementalFetchCompatibility,
  INCREMENTAL_FETCH_INJECTION_NOTE,
  INCREMENTAL_FETCH_NO_INFERENCE_NOTE,
  type IncrementalFetchCompatibilityInput,
} from './incremental-fetch-compatibility'

type IncrementalFetchCompatibilityHintsProps = IncrementalFetchCompatibilityInput & {
  className?: string
  /** Hide generic onboarding notes when sample/checkpoint setup is complete. */
  guidanceComplete?: boolean
}

export function IncrementalFetchCompatibilityHints({
  requestBodyText,
  queryParams,
  platformCheckpointConfigured,
  className,
  guidanceComplete = false,
}: IncrementalFetchCompatibilityHintsProps) {
  const { hints, messages } = useMemo(
    () => analyzeIncrementalFetchCompatibility({ requestBodyText, queryParams, platformCheckpointConfigured }),
    [platformCheckpointConfigured, queryParams, requestBodyText],
  )

  if (messages.length === 0 && hints.length === 0) return null

  return (
    <div
      data-testid="incremental-fetch-compatibility-hints"
      className={cn(
        'rounded-md border border-sky-200/80 bg-sky-50/70 p-3 text-[11px] leading-relaxed text-sky-950 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100',
        className,
      )}
    >
      <p className="font-semibold text-sky-900 dark:text-sky-50">Incremental fetch compatibility</p>
      {messages.length > 0 ? (
        <ul className="mt-2 list-inside list-disc space-y-1">
          {messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}
      {!guidanceComplete ? (
        <>
          <p className="mt-2 text-[10px] text-sky-800/90 dark:text-sky-100/80">{INCREMENTAL_FETCH_INJECTION_NOTE}</p>
          <p className="mt-1 text-[10px] text-sky-800/90 dark:text-sky-100/80">{INCREMENTAL_FETCH_NO_INFERENCE_NOTE}</p>
        </>
      ) : null}
      {hints.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1" aria-label="Compatibility hint codes">
          {hints.map((hint) => (
            <li
              key={hint}
              className="rounded border border-sky-300/50 bg-white/70 px-1.5 py-0.5 font-mono text-[9px] text-sky-900 dark:border-sky-400/30 dark:bg-sky-950/20 dark:text-sky-100"
            >
              {hint}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
