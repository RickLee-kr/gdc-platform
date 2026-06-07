import { Loader2, Play } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  GovernancePolicySimulateResponse,
  PolicyJsonBody,
} from '../../api/gdcGovernancePolicies'
import { simulatePolicy, simulateSavedPolicy } from '../../api/gdcGovernancePolicies'
import { cn } from '../../lib/utils'

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  const text = JSON.stringify(value ?? {}, null, 2)
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      <pre className="max-h-40 overflow-auto rounded-md border border-slate-200/80 bg-white p-2 font-mono text-[11px] text-slate-800 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100">
        {text}
      </pre>
    </div>
  )
}

function defaultSampleJson(policyJson: PolicyJsonBody): string {
  const sample: Record<string, string> = { user: 'sample-user' }
  for (const cond of policyJson.conditions) {
    if (cond.field === 'classification') {
      sample.classification = cond.operator === 'not_equals' ? 'PUBLIC' : cond.value || 'RESTRICTED'
    } else if (cond.field === 'sensitivity') {
      sample.sensitivity = cond.value || 'PII'
    } else if (cond.field === 'field') {
      sample.field = cond.value || '$.user.email'
    }
  }
  return JSON.stringify([sample], null, 2)
}

function parseSampleEvents(raw: string): { events: Record<string, unknown>[] | null; error: string | null } {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      if (parsed.some((item) => item == null || typeof item !== 'object' || Array.isArray(item))) {
        return { events: null, error: 'Each sample event must be a JSON object.' }
      }
      return { events: parsed as Record<string, unknown>[], error: null }
    }
    if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { events: [parsed as Record<string, unknown>], error: null }
    }
    return { events: null, error: 'Paste a JSON object or array of event objects.' }
  } catch {
    return { events: null, error: 'Invalid JSON — check syntax and try again.' }
  }
}

export type PolicySimulationPanelProps = {
  policyJson: PolicyJsonBody
  policyId?: number | null
  streamIds?: number[]
  runtimeDataAvailable?: boolean
  className?: string
}

export function PolicySimulationPanel({
  policyJson,
  policyId = null,
  streamIds = [],
  runtimeDataAvailable = false,
  className,
}: PolicySimulationPanelProps) {
  const [inputMode, setInputMode] = useState<'recent' | 'paste'>(runtimeDataAvailable ? 'recent' : 'paste')
  const [sampleJson, setSampleJson] = useState(() => defaultSampleJson(policyJson))
  const [validationError, setValidationError] = useState<string | null>(null)
  const [simulationError, setSimulationError] = useState<string | null>(null)
  const [result, setResult] = useState<GovernancePolicySimulateResponse | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setSampleJson(defaultSampleJson(policyJson))
    setResult(null)
    setValidationError(null)
    setSimulationError(null)
  }, [policyJson])

  useEffect(() => {
    if (runtimeDataAvailable) {
      setInputMode('recent')
    }
  }, [runtimeDataAvailable])

  const parsedEvents = useMemo(() => parseSampleEvents(sampleJson), [sampleJson])

  const runSimulation = useCallback(async () => {
    setSimulationError(null)
    setValidationError(null)
    setResult(null)

    if (inputMode === 'paste') {
      const { events, error } = parsedEvents
      if (error || !events?.length) {
        setValidationError(error ?? 'Add at least one sample event.')
        return
      }
    }

    setLoading(true)
    try {
      const body =
        inputMode === 'recent'
          ? { sample_events: [], stream_ids: streamIds.length > 0 ? streamIds : undefined }
          : { sample_events: parsedEvents.events ?? [], stream_ids: streamIds.length > 0 ? streamIds : undefined }

      const response =
        policyId != null
          ? await simulateSavedPolicy(policyId, body)
          : await simulatePolicy({ policy_json: policyJson, ...body })

      if (!response?.events) {
        setSimulationError('Simulation failed — no results returned.')
        return
      }
      setResult(response)
    } catch (e) {
      setSimulationError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [inputMode, parsedEvents, policyId, policyJson, streamIds])

  return (
    <section
      className={cn(
        'rounded-lg border border-slate-200/90 bg-slate-50/50 p-3 dark:border-gdc-border dark:bg-gdc-card/50',
        className,
      )}
      aria-label="Policy simulation"
      data-testid="policy-simulation-panel"
    >
      <p className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Simulation (Dry Run)</p>
      <p className="mt-0.5 text-[10px] text-slate-500 dark:text-gdc-muted">
        Preview only — does not deliver, update checkpoints, or create quarantine records.
      </p>

      <div className="mt-2 flex flex-wrap gap-1">
        <button
          type="button"
          disabled={!runtimeDataAvailable}
          onClick={() => setInputMode('recent')}
          className={cn(
            'rounded-md px-2 py-1 text-[10px] font-semibold',
            inputMode === 'recent'
              ? 'bg-violet-600 text-white dark:bg-violet-500'
              : 'bg-slate-100 text-slate-600 dark:bg-gdc-elevated dark:text-gdc-mutedStrong',
            !runtimeDataAvailable && 'opacity-50',
          )}
          data-testid="policy-simulation-tab-recent"
        >
          Recent events
        </button>
        <button
          type="button"
          onClick={() => setInputMode('paste')}
          className={cn(
            'rounded-md px-2 py-1 text-[10px] font-semibold',
            inputMode === 'paste'
              ? 'bg-violet-600 text-white dark:bg-violet-500'
              : 'bg-slate-100 text-slate-600 dark:bg-gdc-elevated dark:text-gdc-mutedStrong',
          )}
          data-testid="policy-simulation-tab-paste"
        >
          Paste JSON
        </button>
      </div>

      {inputMode === 'paste' ? (
        <div className="mt-2 space-y-1">
          <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-200" htmlFor="policy-simulation-json">
            Sample Event JSON
          </label>
          <textarea
            id="policy-simulation-json"
            className="min-h-[7rem] w-full rounded-md border border-slate-200/90 bg-white px-2.5 py-2 font-mono text-[11px] text-slate-900 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
            value={sampleJson}
            onChange={(e) => {
              setSampleJson(e.target.value)
              setValidationError(null)
              setResult(null)
            }}
            data-testid="policy-simulation-json-input"
          />
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-slate-500 dark:text-gdc-muted" data-testid="policy-simulation-recent-hint">
          Uses up to 10 recent classification events from assigned streams (last 24h).
        </p>
      )}

      {validationError ? (
        <p className="mt-2 text-[11px] text-red-700 dark:text-red-300" role="alert" data-testid="policy-simulation-validation-error">
          {validationError}
        </p>
      ) : null}

      {simulationError ? (
        <p className="mt-2 text-[11px] text-red-700 dark:text-red-300" role="alert" data-testid="policy-simulation-error">
          {simulationError}
        </p>
      ) : null}

      <button
        type="button"
        disabled={loading}
        onClick={() => void runSimulation()}
        className="mt-2 inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50 dark:bg-violet-500"
        data-testid="policy-simulation-run"
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Play className="h-3 w-3" aria-hidden />}
        Run Simulation
      </button>

      {loading ? (
        <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-slate-500">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          Running dry run…
        </p>
      ) : null}

      {result?.events?.length ? (
        <div className="mt-3 space-y-2" data-testid="policy-simulation-results">
          {result.events.map((event, idx) => (
            <div
              key={idx}
              className={cn(
                'rounded-md border px-2.5 py-2',
                event.matched
                  ? 'border-emerald-200/80 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/10'
                  : 'border-slate-200/80 bg-white/80 dark:border-gdc-border dark:bg-gdc-card/80',
              )}
              data-testid={event.matched ? 'policy-simulation-result-matched' : 'policy-simulation-result-unmatched'}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                    event.matched
                      ? 'bg-emerald-600 text-white dark:bg-emerald-500'
                      : 'bg-slate-400 text-white dark:bg-slate-600',
                  )}
                >
                  {event.matched ? 'Matched' : 'Unmatched'}
                </span>
                {event.actions.length > 0 ? (
                  <span className="text-[11px] text-slate-700 dark:text-slate-200">
                    Actions: <span className="font-semibold">{event.actions.join(', ')}</span>
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-[11px] text-slate-600 dark:text-gdc-mutedStrong">
                Reason: {event.reason}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {result?.events?.length && inputMode === 'paste' && parsedEvents.events?.length ? (
        <div className="mt-3">
          <JsonBlock title="Input events" value={parsedEvents.events} />
        </div>
      ) : null}
    </section>
  )
}
