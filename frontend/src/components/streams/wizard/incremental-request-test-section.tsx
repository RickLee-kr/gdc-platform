import { AlertTriangle, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { runHttpApiTest } from '../../../api/gdcRuntimePreview'
import { cn } from '../../../lib/utils'
import { wizardExtractEvents } from './wizard-json-extract'
import {
  buildApiTestCheckpointPayload,
  buildIncrementalRequestTestSignature,
  calculateIncrementalRequestTestCheckpoint,
  collectCheckpointValuesFromEventSource,
  looksLikeQueryParams,
  type IncrementalRequestPattern,
  type IncrementalRequestTestCheckpointResult,
} from './wizard-incremental-request'
import {
  buildSourceAuthPayload,
  buildSourceConfig,
  buildStreamConfigPayload,
  type WizardCheckpointFieldType,
  type WizardConfigState,
  type WizardIncrementalRequestTestResult,
  type WizardState,
} from './wizard-state'

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatSubstitutedRequest(
  queryParams: Record<string, unknown> | undefined,
  jsonBody: unknown,
  draft: string,
  pattern: IncrementalRequestPattern,
): string {
  const treatAsQuery = pattern === 'query_params' || (pattern === 'custom' && looksLikeQueryParams(draft))
  if (treatAsQuery) {
    const lines = Object.entries(queryParams ?? {}).map(([k, v]) => `${k}=${String(v)}`)
    return lines.join('\n') || draft
  }
  if (jsonBody != null) {
    return typeof jsonBody === 'string' ? jsonBody : formatJson(jsonBody)
  }
  return draft
}

function NumberBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[9px] font-bold text-white">
      {n}
    </span>
  )
}

export type IncrementalRequestTestSectionProps = {
  state: WizardState
  eventSourceRecords: Array<Record<string, unknown>>
  eventArrayPath: string
  checkpointSourcePath: string
  checkpointFieldType: WizardCheckpointFieldType
  pattern: IncrementalRequestPattern
  draft: string
  onStreamPatch?: (patch: Partial<WizardConfigState>) => void
}

export function useIncrementalRequestTest(props: Omit<IncrementalRequestTestSectionProps, 'onCopy'>) {
  const {
    state,
    eventSourceRecords,
    eventArrayPath,
    checkpointSourcePath,
    checkpointFieldType,
    pattern,
    draft,
    onStreamPatch,
  } = props
  const [testing, setTesting] = useState(false)

  const signature = useMemo(
    () =>
      buildIncrementalRequestTestSignature({
        pattern,
        draft: draft.trim(),
        checkpointSourcePath,
        eventArrayPath,
      }),
    [pattern, draft, checkpointSourcePath, eventArrayPath],
  )

  const checkpointCalc = useMemo((): IncrementalRequestTestCheckpointResult => {
    if (pattern === 'none' || !draft.trim()) {
      return { kind: 'disabled', reason: 'Select an incremental request pattern first.' }
    }
    const values = collectCheckpointValuesFromEventSource(eventSourceRecords, checkpointSourcePath)
    return calculateIncrementalRequestTestCheckpoint(values, checkpointFieldType)
  }, [pattern, draft, eventSourceRecords, checkpointSourcePath, checkpointFieldType])

  const testDisabled =
    pattern === 'none' ||
    !draft.trim() ||
    testing ||
    checkpointCalc.kind === 'disabled' ||
    checkpointCalc.kind === 'unsortable_string'

  const testDisabledReason =
    checkpointCalc.kind === 'disabled'
      ? checkpointCalc.reason
      : checkpointCalc.kind === 'unsortable_string'
        ? checkpointCalc.reason
        : pattern === 'none'
          ? 'Select an incremental request pattern first.'
          : !draft.trim()
            ? 'Add a request template first.'
            : null

  useEffect(() => {
    if (!onStreamPatch) return
    const prev = state.stream.incrementalRequestTestResult
    if (!prev) return
    if (prev.signature === signature) return
    onStreamPatch({
      incrementalRequestTestResult: null,
      incrementalRequestTestSignature:
        state.stream.incrementalRequestTestSignature === prev.signature
          ? null
          : state.stream.incrementalRequestTestSignature,
      incrementalRequestTestedAt:
        state.stream.incrementalRequestTestSignature === prev.signature ? null : state.stream.incrementalRequestTestedAt,
    })
  }, [
    signature,
    onStreamPatch,
    state.stream.incrementalRequestTestResult,
    state.stream.incrementalRequestTestSignature,
    state.stream.incrementalRequestTestedAt,
  ])

  const runTest = useCallback(async () => {
    if (testDisabled || checkpointCalc.kind !== 'ok' || !onStreamPatch) return
    setTesting(true)
    const startedAt = Date.now()
    const testState: WizardState = { ...state, stream: { ...state.stream, incrementalRequestDraft: draft } }
    try {
      const res = await runHttpApiTest({
        connector_id: state.connector.connectorId ?? undefined,
        source_config: { ...buildSourceConfig(testState), ...buildSourceAuthPayload(testState) },
        stream_config: buildStreamConfigPayload(testState),
        checkpoint: buildApiTestCheckpointPayload(checkpointCalc),
        fetch_sample: false,
      })
      const durationMs = res.response?.latency_ms ?? Date.now() - startedAt
      const parsed = res.response?.parsed_json ?? null
      const pathForExtract = eventArrayPath.trim() || state.stream.eventArrayPath.trim()
      const returned = wizardExtractEvents(
        parsed !== null && typeof parsed === 'object' ? parsed : null,
        pathForExtract,
        state.stream.eventRootPath,
      )
      const substitutedRequestBody = formatSubstitutedRequest(
        res.actual_request_sent?.query_params,
        res.actual_request_sent?.json_body_masked,
        draft,
        pattern,
      )
      const sampleRecords = returned.slice(0, 2)
      const testedAt = Date.now()
      if (res.ok && res.response) {
        const result: WizardIncrementalRequestTestResult = {
          status: 'success',
          httpStatus: res.response.status_code,
          durationMs,
          returnedRecordCount: returned.length,
          testedCheckpointDisplay: checkpointCalc.displayValue,
          substitutedRequestBody,
          sampleRecords,
          rawResponseBody: res.response.raw_body ?? null,
          message: 'Incremental request looks good.',
          testedAt,
          signature,
        }
        onStreamPatch({
          incrementalRequestTestResult: result,
          incrementalRequestTestSignature: signature,
          incrementalRequestTestedAt: testedAt,
        })
      } else {
        const result: WizardIncrementalRequestTestResult = {
          status: 'error',
          httpStatus: res.response?.status_code ?? res.target_status_code ?? null,
          durationMs,
          returnedRecordCount: 0,
          testedCheckpointDisplay: checkpointCalc.displayValue,
          substitutedRequestBody,
          sampleRecords: [],
          rawResponseBody: res.target_response_body ?? res.response?.raw_body ?? res.message ?? null,
          message: 'Incremental request test failed. Fix the request body before creating the stream.',
          testedAt,
          signature,
        }
        onStreamPatch({
          incrementalRequestTestResult: result,
          incrementalRequestTestSignature: null,
          incrementalRequestTestedAt: null,
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const result: WizardIncrementalRequestTestResult = {
        status: 'error',
        httpStatus: null,
        durationMs: Date.now() - startedAt,
        returnedRecordCount: 0,
        testedCheckpointDisplay: checkpointCalc.displayValue,
        substitutedRequestBody: draft,
        sampleRecords: [],
        rawResponseBody: message,
        message: 'Incremental request test failed. Fix the request body before creating the stream.',
        testedAt: Date.now(),
        signature,
      }
      onStreamPatch({
        incrementalRequestTestResult: result,
        incrementalRequestTestSignature: null,
        incrementalRequestTestedAt: null,
      })
    } finally {
      setTesting(false)
    }
  }, [checkpointCalc, draft, eventArrayPath, onStreamPatch, pattern, signature, state, testDisabled])

  return { testing, testDisabled, testDisabledReason, checkpointCalc, runTest, signature }
}

export function IncrementalRequestTestSection({
  state,
  eventSourceRecords,
  eventArrayPath,
  checkpointSourcePath,
  checkpointFieldType,
  pattern,
  draft,
  onStreamPatch,
}: IncrementalRequestTestSectionProps) {
  const [showRaw, setShowRaw] = useState(false)
  const { testDisabledReason, checkpointCalc, signature } = useIncrementalRequestTest({
    state,
    eventSourceRecords,
    eventArrayPath,
    checkpointSourcePath,
    checkpointFieldType,
    pattern,
    draft,
    onStreamPatch,
  })

  const result = state.stream.incrementalRequestTestResult
  const stale =
    result?.status === 'success' &&
    (result.signature !== signature || state.stream.incrementalRequestTestSignature !== signature)

  return (
    <>
      {checkpointCalc.kind === 'unsortable_string' ? (
        <p className="mt-2 rounded-md border border-amber-200/80 bg-amber-500/[0.06] px-2 py-1.5 text-[10px] text-amber-900 dark:border-amber-500/35 dark:text-amber-100">
          {checkpointCalc.reason}
        </p>
      ) : testDisabledReason && pattern !== 'none' ? (
        <p className="mt-2 text-[10px] text-slate-500 dark:text-gdc-mutedStrong">{testDisabledReason}</p>
      ) : null}

      {pattern !== 'none' ? (
        <p className="mt-1.5 text-[10px] text-slate-500 dark:text-gdc-mutedStrong">
          Test will use the second-latest checkpoint value from the detected records to ensure at least one new record is
          returned.
        </p>
      ) : null}

      {result && result.signature === signature ? (
        <div className="mt-2 space-y-2" data-testid="incremental-request-test-result">
          <div className="flex items-center gap-2">
            <NumberBadge n={4} />
            <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">Test result</p>
          </div>
          <div
            className={cn(
              'rounded-md border px-2.5 py-2',
              result.status === 'success'
                ? 'border-emerald-300/70 bg-emerald-500/[0.08] dark:border-emerald-500/35 dark:bg-emerald-500/10'
                : 'border-red-300/70 bg-red-500/[0.06] dark:border-red-500/35 dark:bg-red-500/10',
            )}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
              <span
                className={cn(
                  'font-semibold',
                  result.status === 'success' ? 'text-emerald-800 dark:text-emerald-200' : 'text-red-800 dark:text-red-200',
                )}
              >
                {result.status === 'success' ? 'Success' : 'Failed'}
                {result.httpStatus != null ? ` · ${result.httpStatus}` : ''}
              </span>
              {result.durationMs != null ? <span className="text-slate-600 dark:text-gdc-mutedStrong">Duration: {result.durationMs}ms</span> : null}
              {result.status === 'success' ? (
                <span className="text-slate-600 dark:text-gdc-mutedStrong">Returned records: {result.returnedRecordCount}</span>
              ) : null}
              <span className="text-slate-500 dark:text-gdc-mutedStrong">
                Tested at: {new Date(result.testedAt).toLocaleString()}
              </span>
              {result.rawResponseBody ? (
                <button
                  type="button"
                  onClick={() => setShowRaw((v) => !v)}
                  className="ml-auto inline-flex items-center gap-0.5 font-semibold text-violet-700 hover:underline dark:text-violet-300"
                >
                  {showRaw ? 'Hide raw response' : 'See raw response'}
                  {showRaw ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              ) : null}
            </div>
            <p
              className={cn(
                'mt-1.5 text-[11px] font-medium',
                result.status === 'success' ? 'text-emerald-900 dark:text-emerald-100' : 'text-red-900 dark:text-red-100',
              )}
            >
              {result.message}
            </p>
            {stale ? (
              <p className="mt-1 flex items-center gap-1 text-[10px] text-amber-800 dark:text-amber-200">
                <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                Request template changed after this test — run Test again.
              </p>
            ) : null}
            <dl className="mt-2 space-y-1 text-[10px] text-slate-700 dark:text-slate-200">
              <div>
                <dt className="font-semibold text-slate-500 dark:text-gdc-mutedStrong">Tested checkpoint (used in request)</dt>
                <dd className="font-mono">{result.testedCheckpointDisplay}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500 dark:text-gdc-mutedStrong">Substituted request body</dt>
                <dd>
                  <pre className="gdc-thin-scroll mt-0.5 max-h-28 overflow-auto rounded border border-slate-200/70 bg-slate-950 p-2 font-mono text-[9px] text-emerald-200 dark:border-gdc-border">
                    {result.substitutedRequestBody}
                  </pre>
                </dd>
              </div>
              {result.status === 'success' && result.sampleRecords.length > 0 ? (
                <div>
                  <dt className="font-semibold text-slate-500 dark:text-gdc-mutedStrong">Sample records (first 2)</dt>
                  <dd>
                    <pre className="gdc-thin-scroll mt-0.5 max-h-32 overflow-auto rounded border border-slate-200/70 bg-slate-950 p-2 font-mono text-[9px] text-emerald-200 dark:border-gdc-border">
                      {formatJson(result.sampleRecords)}
                    </pre>
                  </dd>
                </div>
              ) : null}
              {result.status === 'success' && result.rawResponseBody && showRaw ? (
                <div>
                  <dt className="font-semibold text-slate-500 dark:text-gdc-mutedStrong">Raw response body</dt>
                  <dd>
                    <pre className="gdc-thin-scroll mt-0.5 max-h-32 overflow-auto rounded border border-slate-200/70 bg-slate-950 p-2 font-mono text-[9px] text-emerald-200 dark:border-gdc-border">
                      {result.rawResponseBody}
                    </pre>
                  </dd>
                </div>
              ) : null}
              {result.status === 'error' && result.rawResponseBody ? (
                <div>
                  <dt className="font-semibold text-slate-500 dark:text-gdc-mutedStrong">Response / error</dt>
                  <dd>
                    <pre
                      className={cn(
                        'gdc-thin-scroll mt-0.5 max-h-32 overflow-auto rounded border p-2 font-mono text-[9px]',
                        showRaw
                          ? 'border-slate-200/70 bg-slate-950 text-emerald-200 dark:border-gdc-border'
                          : 'border-red-200/70 bg-red-950/40 text-red-100',
                      )}
                    >
                      {showRaw ? result.rawResponseBody : result.rawResponseBody.slice(0, 600)}
                    </pre>
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        </div>
      ) : null}
    </>
  )
}

export function IncrementalRequestTestButton({
  testing,
  disabled,
  onClick,
}: {
  testing: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-testid="incremental-request-test-button"
      onClick={() => void onClick()}
      disabled={disabled}
      className="inline-flex h-6 items-center gap-1 rounded bg-violet-600 px-2 text-[10px] font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {testing ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
      Test
    </button>
  )
}

export { NumberBadge as IncrementalNumberBadge }
