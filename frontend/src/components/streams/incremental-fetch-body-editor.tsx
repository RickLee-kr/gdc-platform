import { IncrementalFetchCompatibilityHints } from './incremental-fetch-compatibility-hints'
import { cn } from '../../lib/utils'
import {
  CHECKPOINT_TEMPLATE_VARIABLES,
  INCREMENTAL_FETCH_CHECKPOINT_HELPER,
  INCREMENTAL_FETCH_GDC_NOTE,
} from './incremental-fetch-templates'

const inputCls =
  'w-full rounded-md border border-slate-200/90 bg-white px-2.5 py-2 font-mono text-[12px] text-slate-900 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100'

type IncrementalFetchBodyEditorProps = {
  id?: string
  value: string
  onChange: (value: string) => void
  rows?: number
  className?: string
  queryParams?: Record<string, string>
  platformCheckpointConfigured?: boolean
}

export function IncrementalFetchBodyEditor({
  id = 'stream-json-request-body',
  value,
  onChange,
  rows = 8,
  className,
  queryParams,
  platformCheckpointConfigured,
}: IncrementalFetchBodyEditorProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <div className="rounded-md border border-amber-200/80 bg-amber-50/60 p-3 text-[11px] leading-relaxed text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
        <p>{INCREMENTAL_FETCH_CHECKPOINT_HELPER}</p>
        <p className="mt-2">{INCREMENTAL_FETCH_GDC_NOTE}</p>
      </div>

      <div className="rounded-md border border-slate-200/80 bg-slate-50/80 p-3 text-[11px] leading-relaxed text-slate-600 dark:border-gdc-border dark:bg-gdc-card dark:text-gdc-mutedStrong">
        <p className="font-semibold text-slate-700 dark:text-slate-200">Checkpoint & runtime variables</p>
        <ul className="mt-1 list-inside list-disc space-y-0.5 font-mono text-[10px] text-slate-700 dark:text-slate-200">
          {CHECKPOINT_TEMPLATE_VARIABLES.map((v) => (
            <li key={v}>{v}</li>
          ))}
        </ul>
        <p className="mt-2 text-[10px] text-slate-600 dark:text-gdc-muted">
          Pagination size belongs in the JSON body for Elasticsearch-style APIs (e.g. <span className="font-semibold">size</span>
          ), not only as a query <span className="font-mono">limit</span> parameter.
        </p>
      </div>

      <div>
        <label htmlFor={id} className="text-[11px] font-semibold text-slate-600 dark:text-gdc-mutedStrong">
          JSON Request Body (optional)
        </label>
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          aria-label="JSON Request Body"
          className={`${inputCls} mt-1`}
          placeholder='{"filters":[{"fieldName":"creationTime","operator":"GreaterThan","values":["{{checkpoint.last_timestamp}}"]}]}'
        />
        <IncrementalFetchCompatibilityHints
          requestBodyText={value}
          queryParams={queryParams}
          platformCheckpointConfigured={platformCheckpointConfigured}
          className="mt-2"
        />
      </div>
    </div>
  )
}
