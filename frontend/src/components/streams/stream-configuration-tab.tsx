import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchStreamConfiguration,
  fetchStreamSampleData,
  type StreamConfigurationResponse,
  type StreamSampleDataResponse,
} from '../../api/gdcStreamConfiguration'
import { streamEditPath } from '../../config/nav-paths'
import { gdcUi } from '../../lib/gdc-ui-tokens'
import { useSessionCapabilities } from '../../lib/rbac'
import { cn } from '../../lib/utils'
import { StreamCheckpointPanel } from './stream-checkpoint-panel'
import { StreamDedupPanel } from './stream-dedup-panel'
import { StreamIncrementalTestPanel } from './stream-incremental-test-panel'
import { StreamReplayPanel } from './stream-replay-panel'

const CONFIG_SECTION_CLS = cn(gdcUi.cardShell, 'rounded-lg p-4')

function ConfigFieldRow({ label, value, sensitive }: { label: string; value: string; sensitive?: boolean }) {
  const isNotConfigured = value === 'Not configured'
  return (
    <div className="grid gap-1 border-b border-slate-100 py-2 dark:border-gdc-divider sm:grid-cols-[200px_1fr]">
      <dt className="text-[12px] font-semibold text-slate-600 dark:text-gdc-mutedStrong">{label}</dt>
      <dd
        className={cn(
          'whitespace-pre-wrap break-words font-mono text-[11px]',
          isNotConfigured ? 'italic text-slate-400 dark:text-gdc-placeholder' : 'text-slate-800 dark:text-gdc-foreground',
          sensitive && !isNotConfigured && 'text-amber-800 dark:text-amber-300',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

export function StreamConfigurationTab({ streamId }: { streamId: number }) {
  const caps = useSessionCapabilities()
  const canMutateWorkspace = caps.workspace_mutations === true
  const canRuntimeControl = caps.runtime_stream_control === true
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [config, setConfig] = useState<StreamConfigurationResponse | null>(null)
  const [sampleData, setSampleData] = useState<StreamSampleDataResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      const [cfg, sample] = await Promise.all([
        fetchStreamConfiguration(streamId),
        fetchStreamSampleData(streamId),
      ])
      if (cancelled) return
      if (!cfg) {
        setError('Could not load stream configuration.')
        setConfig(null)
        setSampleData(null)
      } else {
        setConfig(cfg)
        setSampleData(sample)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [streamId])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-slate-500 dark:text-gdc-muted" data-testid="stream-configuration-loading">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading configuration…
      </div>
    )
  }

  if (error || !config) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200">
        {error ?? 'Configuration unavailable.'}
      </div>
    )
  }

  return (
    <div className="space-y-6" data-testid="stream-configuration-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Configuration</h2>
          <p className="text-[12px] text-slate-500 dark:text-gdc-muted">
            Read-only view of saved stream setup. Sensitive values are masked.
          </p>
        </div>
        {canMutateWorkspace ? (
          <Link
            to={streamEditPath(String(streamId))}
            className="rounded-md bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-violet-500"
            data-testid="stream-configuration-edit-link"
          >
            Edit Stream (Resume Wizard)
          </Link>
        ) : (
          <span
            className="cursor-not-allowed rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-[12px] font-semibold text-slate-400 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-500"
            title="Viewer role cannot edit stream configuration."
            data-testid="stream-configuration-edit-disabled"
          >
            Edit Stream (Resume Wizard)
          </span>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {config.sections.map((section) => (
          <section
            key={section.title}
            className={CONFIG_SECTION_CLS}
            data-testid={`stream-configuration-section-${section.title.toLowerCase().replace(/\s+/g, '-')}`}
          >
            <h3 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              {section.title}
            </h3>
            <dl>
              {section.fields.map((field, idx) => (
                <ConfigFieldRow
                  key={`${field.label}-${idx}`}
                  label={field.label}
                  value={field.value}
                  sensitive={field.sensitive}
                />
              ))}
            </dl>
          </section>
        ))}
      </div>

      <section className={CONFIG_SECTION_CLS}>
        <h3 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">
          Sample Data
        </h3>
        {!sampleData?.has_sample_data ? (
          <p className="text-sm italic text-slate-500 dark:text-gdc-muted" data-testid="stream-sample-empty">
            No sample data saved yet. Run API Test in the Edit Wizard to capture sample events and union schema.
          </p>
        ) : (
          <div className="space-y-3 text-[12px] text-slate-700 dark:text-gdc-mutedStrong">
            <p>
              <span className="font-semibold text-slate-800 dark:text-gdc-foreground">Sample count:</span>{' '}
              {sampleData.sample_count}
              {sampleData.saved_at ? (
                <span className="ml-3 text-slate-500 dark:text-gdc-muted">
                  Saved {new Date(sampleData.saved_at).toLocaleString()}
                </span>
              ) : null}
            </p>
            {sampleData.event_root_path ? (
              <p>
                <span className="font-semibold text-slate-800 dark:text-gdc-foreground">Event root:</span>{' '}
                <code className="font-mono text-slate-800 dark:text-gdc-foreground">{sampleData.event_root_path}</code>
              </p>
            ) : null}
            {sampleData.record_path ? (
              <p>
                <span className="font-semibold text-slate-800 dark:text-gdc-foreground">Record path:</span>{' '}
                <code className="font-mono text-slate-800 dark:text-gdc-foreground">{sampleData.record_path}</code>
              </p>
            ) : null}
            {sampleData.union_schema ? (
              <details>
                <summary className="cursor-pointer font-semibold text-violet-700 dark:text-violet-300">Union schema</summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-950/90 p-3 text-[10px] text-slate-100">
                  {JSON.stringify(sampleData.union_schema, null, 2)}
                </pre>
              </details>
            ) : null}
            {sampleData.sample_events.length > 0 ? (
              <details>
                <summary className="cursor-pointer font-semibold text-violet-700 dark:text-violet-300">Sample events</summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-950/90 p-3 text-[10px] text-slate-100">
                  {JSON.stringify(sampleData.sample_events.slice(0, 5), null, 2)}
                </pre>
              </details>
            ) : null}
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <StreamIncrementalTestPanel streamId={streamId} initialSample={sampleData} canOperate={canRuntimeControl} />
        <StreamReplayPanel streamId={streamId} canOperate={canRuntimeControl} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <StreamCheckpointPanel streamId={streamId} canOperate={canMutateWorkspace} />
        <StreamDedupPanel streamId={streamId} canOperate={canMutateWorkspace} />
      </div>
    </div>
  )
}
