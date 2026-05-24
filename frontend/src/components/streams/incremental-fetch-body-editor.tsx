import { useState } from 'react'
import { IncrementalFetchCompatibilityHints } from './incremental-fetch-compatibility-hints'
import { cn } from '../../lib/utils'
import {
  CHECKPOINT_TEMPLATE_VARIABLES,
  INCREMENTAL_FETCH_CHECKPOINT_HELPER,
  INCREMENTAL_FETCH_GDC_NOTE,
  INCREMENTAL_FETCH_TEMPLATES,
  type IncrementalFetchTemplate,
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
}

export function IncrementalFetchBodyEditor({
  id = 'stream-json-request-body',
  value,
  onChange,
  rows = 8,
  className,
  queryParams,
}: IncrementalFetchBodyEditorProps) {
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null)

  function insertTemplate(template: IncrementalFetchTemplate) {
    onChange(template.body)
    setExpandedTemplateId(template.id)
  }

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

      <div className="space-y-2">
        <p className="text-[11px] font-semibold text-slate-600 dark:text-gdc-mutedStrong">Incremental fetch templates</p>
        <ul className="space-y-2">
          {INCREMENTAL_FETCH_TEMPLATES.map((template) => (
            <li
              key={template.id}
              className="rounded-lg border border-slate-200/80 bg-white p-3 dark:border-gdc-border dark:bg-gdc-section"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">{template.label}</p>
                  <p className="mt-0.5 text-[11px] text-slate-600 dark:text-gdc-muted">{template.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => insertTemplate(template)}
                  className="h-8 shrink-0 rounded-md border border-violet-300/60 bg-white px-2.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-500/[0.08] dark:border-violet-500/40 dark:bg-gdc-card dark:text-violet-300 dark:hover:bg-violet-500/15"
                >
                  Use Incremental Fetch Template
                </button>
              </div>
              <dl className="mt-2 grid gap-1 text-[10px] text-slate-600 dark:text-gdc-muted sm:grid-cols-2">
                <div>
                  <dt className="font-semibold text-slate-700 dark:text-slate-300">Checkpoint type</dt>
                  <dd>{template.checkpointType}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-700 dark:text-slate-300">Checkpoint update path</dt>
                  <dd className="font-mono text-[10px]">{template.checkpointUpdatePathExample}</dd>
                </div>
                {template.sortingRequirement ? (
                  <div className="sm:col-span-2">
                    <dt className="font-semibold text-slate-700 dark:text-slate-300">Sort requirement</dt>
                    <dd>{template.sortingRequirement}</dd>
                  </div>
                ) : null}
              </dl>
              {template.warning ? (
                <p
                  className="mt-2 rounded border border-amber-200/70 bg-amber-50/50 px-2 py-1 text-[10px] text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100"
                  data-testid={`template-warning-${template.id}`}
                >
                  {template.warning}
                </p>
              ) : null}
              {expandedTemplateId === template.id ? (
                <pre
                  className="mt-2 max-h-40 overflow-auto rounded border border-slate-200/80 bg-slate-50/80 p-2 font-mono text-[10px] text-slate-800 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
                  data-testid={`template-body-preview-${template.id}`}
                >
                  {template.body}
                </pre>
              ) : null}
            </li>
          ))}
        </ul>
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
        <IncrementalFetchCompatibilityHints requestBodyText={value} queryParams={queryParams} className="mt-2" />
      </div>
    </div>
  )
}
