import { AlertCircle, CheckCircle2, Loader2, Play } from 'lucide-react'
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { runHttpApiTest, runConnectorAuthTest, type ConnectorAuthTestResponse, type HttpApiTestAnalysisPayload } from '../../../api/gdcRuntimePreview'
import { cn } from '../../../lib/utils'
import { RemoteFileProbeSummary } from '../../connectors/remote-file-probe-summary'
import { validateJsonBodyForApi } from '../../../utils/jsonBodySyntax'
import {
  buildSourceAuthPayload,
  buildSourceConfig,
  buildStreamConfigPayload,
  type WizardApiTestStep,
  type WizardApiTestState,
  type WizardConfigState,
  type WizardHttpApiAnalysis,
  type WizardState,
} from './wizard-state'
import { detectEventRootCandidates, flattenSampleFields, wizardExtractEvents } from './wizard-json-extract'
import { resolveSourceTypePresentation } from '../../../utils/sourceTypePresentation'

type StepApiTestProps = {
  state: WizardState
  onChange: (next: WizardApiTestState) => void
  /** When API suggests `event_array_path`, apply before extract if user has not set one. */
  onStreamPatch?: (patch: Partial<WizardConfigState>) => void
}

function mapApiAnalysis(a: HttpApiTestAnalysisPayload): WizardHttpApiAnalysis {
  return {
    responseSummary: {
      root_type: a.response_summary.root_type,
      approx_size_bytes: a.response_summary.approx_size_bytes,
      top_level_keys: a.response_summary.top_level_keys ?? [],
      item_count_root: a.response_summary.item_count_root ?? null,
      truncation: a.response_summary.truncation ?? null,
    },
    detectedArrays: (a.detected_arrays ?? []).map((x) => ({
      path: x.path,
      count: x.count,
      confidence: x.confidence,
      reason: x.reason,
      sample_item_preview: x.sample_item_preview,
    })),
    detectedCheckpointCandidates: (a.detected_checkpoint_candidates ?? []).map((x) => ({
      path: x.field_path,
      checkpoint_type: x.checkpoint_type,
      confidence: x.confidence,
      sample_value: x.sample_value,
      reason: x.reason ?? '',
    })),
    sampleEvent: a.sample_event,
    selectedEventArrayDefault: a.selected_event_array_default ?? null,
    flatPreviewFields: a.flat_preview_fields ?? [],
    eventRootCandidates: detectEventRootCandidates(a.sample_event),
    previewError: a.preview_error ?? null,
  }
}

const PLACEHOLDER_RAW_RESPONSE = {
  data: {
    events: [
      { id: 'sample-1', name: 'sample.event', severity: 'low', captured_at: '2026-05-08T12:00:00Z' },
      { id: 'sample-2', name: 'sample.event', severity: 'medium', captured_at: '2026-05-08T12:00:30Z' },
      { id: 'sample-3', name: 'sample.event', severity: 'high', captured_at: '2026-05-08T12:01:15Z' },
    ],
    next_cursor: 'sample-cursor-1',
  },
} as const

function mapApiSteps(
  steps: Array<{ name: string; success: boolean; status_code?: number | null; message?: string }> | undefined,
): WizardApiTestStep[] {
  if (!steps?.length) return []
  return steps.map((s) => ({
    name: s.name,
    success: s.success,
    status_code: s.status_code ?? null,
    message: s.message ?? '',
  }))
}

export function StepApiTest({ state, onChange, onStreamPatch }: StepApiTestProps) {
  const [busy, setBusy] = useState(false)

  const sourcePres = useMemo(
    () => resolveSourceTypePresentation(state.connector.sourceType),
    [state.connector.sourceType],
  )

  const isS3 = state.connector.sourceType === 'S3_OBJECT_POLLING'
  const isRemote = state.connector.sourceType === 'REMOTE_FILE_POLLING'
  const canRunLiveApiTest = useMemo(
    () =>
      state.connector.connectorId != null &&
      state.connector.sourceId != null &&
      (isS3 || isRemote || state.stream.endpoint.trim().length > 0) &&
      (!isRemote || state.stream.remoteDirectory.trim().length > 0),
    [
      state.connector.connectorId,
      state.connector.sourceId,
      state.connector.sourceType,
      state.stream.endpoint,
      state.stream.remoteDirectory,
      isS3,
      isRemote,
    ],
  )

  const run = useCallback(async () => {
    if (busy || !canRunLiveApiTest) return

    if (state.connector.sourceType === 'S3_OBJECT_POLLING') {
      setBusy(true)
      const startedAt = Date.now()
      onChange({
        ...state.apiTest,
        status: 'running',
        startedAt,
        finishedAt: null,
        errorCode: null,
        errorType: null,
        errorMessage: null,
        s3ConnectivityPassed: false,
        extractedEvents: [],
        eventCount: 0,
        analysis: null,
      })
      try {
        const res = await runConnectorAuthTest({
          connector_id: state.connector.connectorId ?? undefined,
          method: 'GET',
          test_path: '/',
        })
        if (!res.ok) {
          onChange({
            status: 'error',
            ok: false,
            requestUrl: null,
            method: 'GET',
            statusCode: null,
            responseHeaders: {},
            rawBody: JSON.stringify(res, null, 2),
            parsedJson: null,
            rawResponse: res,
            extractedEvents: [],
            eventCount: 0,
            startedAt,
            finishedAt: Date.now(),
            errorCode: res.error_type ?? 's3_probe_failed',
            errorType: res.error_type ?? 's3_probe_failed',
            errorMessage: res.message ?? 'S3 connectivity probe failed',
            targetStatusCode: null,
            targetResponseBody: null,
            hint: 'Verify endpoint URL, bucket, credentials, and IAM (s3:ListBucket, s3:GetObject).',
            apiBacked: true,
            steps: [],
            responseSample: null,
            effectiveHeadersMasked: null,
            actualRequestSent: null,
            analysis: null,
            s3ConnectivityPassed: false,
          })
          return
        }
        const sample: Record<string, unknown> = {
          id: 's3-wizard-preview',
          message: 'Use JSONPath from your NDJSON or JSON objects (e.g. $.id, $.message).',
          severity: '1',
        }
        const analysisModel: WizardHttpApiAnalysis = {
          responseSummary: {
            root_type: 'object',
            approx_size_bytes: JSON.stringify(sample).length,
            top_level_keys: Object.keys(sample),
            item_count_root: 1,
            truncation: null,
          },
          detectedArrays: [],
          detectedCheckpointCandidates: [],
          sampleEvent: sample,
          selectedEventArrayDefault: null,
          flatPreviewFields: Object.keys(sample).map((k) => `$.${k}`),
          eventRootCandidates: detectEventRootCandidates(sample),
          previewError: null,
        }
        onStreamPatch?.({ useWholeResponseAsEvent: true, eventArrayPath: '' })
        onChange({
          status: 'success',
          ok: true,
          requestUrl: state.connector.hostBaseUrl || null,
          method: 'S3_PROBE',
          statusCode: null,
          responseHeaders: {},
          rawBody: JSON.stringify(
            {
              s3_bucket_exists: res.s3_bucket_exists,
              s3_object_count_preview: res.s3_object_count_preview,
              s3_sample_keys: res.s3_sample_keys,
              s3_endpoint_reachable: res.s3_endpoint_reachable,
              s3_auth_ok: res.s3_auth_ok,
            },
            null,
            2,
          ),
          parsedJson: null,
          rawResponse: res,
          extractedEvents: [sample],
          eventCount: 1,
          startedAt,
          finishedAt: Date.now(),
          errorCode: null,
          errorType: null,
          errorMessage: null,
          targetStatusCode: null,
          targetResponseBody: null,
          hint: null,
          apiBacked: true,
          steps: [],
          responseSample: res,
          effectiveHeadersMasked: null,
          actualRequestSent: null,
          analysis: analysisModel,
          s3ConnectivityPassed: true,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'S3 probe failed.'
        onChange({
          status: 'error',
          ok: false,
          requestUrl: null,
          method: null,
          statusCode: null,
          responseHeaders: {},
          rawBody: null,
          parsedJson: null,
          rawResponse: null,
          extractedEvents: [],
          eventCount: 0,
          startedAt,
          finishedAt: Date.now(),
          errorCode: 's3_probe_exception',
          errorType: 's3_probe_exception',
          errorMessage: message,
          targetStatusCode: null,
          targetResponseBody: null,
          hint: null,
          apiBacked: true,
          steps: [],
          responseSample: null,
          effectiveHeadersMasked: null,
          actualRequestSent: null,
          analysis: null,
          s3ConnectivityPassed: false,
        })
      } finally {
        setBusy(false)
      }
      return
    }

    if (isRemote) {
      setBusy(true)
      const startedAt = Date.now()
      onChange({
        ...state.apiTest,
        status: 'running',
        startedAt,
        finishedAt: null,
        errorCode: null,
        errorType: null,
        errorMessage: null,
        targetStatusCode: null,
        targetResponseBody: null,
        hint: null,
        requestUrl: null,
        method: null,
        statusCode: null,
        responseHeaders: {},
        rawBody: null,
        parsedJson: null,
        steps: [],
        responseSample: null,
        effectiveHeadersMasked: null,
        analysis: null,
        actualRequestSent: null,
        s3ConnectivityPassed: false,
        remoteProbe: null,
      })
      let lastProbe: ConnectorAuthTestResponse | null = null
      try {
        const probe = await runConnectorAuthTest({
          connector_id: state.connector.connectorId ?? undefined,
          method: 'GET',
          test_path: '/',
          remote_file_stream_config: {
            remote_directory: state.stream.remoteDirectory.trim(),
            file_pattern: (state.stream.filePattern.trim() || '*') as string,
            recursive: state.stream.remoteRecursive,
          },
        })
        if (!probe.ok) {
          onChange({
            status: 'error',
            ok: false,
            requestUrl: null,
            method: 'REMOTE_FILE_POLLING',
            statusCode: null,
            responseHeaders: {},
            rawBody: null,
            parsedJson: null,
            rawResponse: probe,
            extractedEvents: [],
            eventCount: 0,
            startedAt,
            finishedAt: Date.now(),
            errorCode: probe.error_type ?? 'remote_probe_failed',
            errorType: probe.error_type ?? 'remote_probe_failed',
            errorMessage: probe.message ?? 'Remote file connectivity probe failed',
            targetStatusCode: null,
            targetResponseBody: null,
            hint: 'Verify SSH host, credentials, known_hosts policy, and remote_directory.',
            apiBacked: true,
            steps: [],
            responseSample: null,
            effectiveHeadersMasked: null,
            actualRequestSent: null,
            analysis: null,
            s3ConnectivityPassed: false,
            remoteProbe: probe,
          })
          return
        }
        lastProbe = probe
        const res = await runHttpApiTest({
          connector_id: state.connector.connectorId ?? undefined,
          source_config: { ...buildSourceConfig(state), ...buildSourceAuthPayload(state) },
          stream_config: buildStreamConfigPayload(state),
          checkpoint: null,
          fetch_sample: true,
        })
        const parsedBody = res.response?.parsed_json ?? null
        let analysisModel = res.analysis ? mapApiAnalysis(res.analysis) : null
        if (
          !analysisModel &&
          Array.isArray(parsedBody) &&
          parsedBody.length > 0 &&
          typeof parsedBody[0] === 'object' &&
          parsedBody[0] !== null &&
          !Array.isArray(parsedBody[0])
        ) {
          const fe = parsedBody[0] as Record<string, unknown>
          analysisModel = {
            responseSummary: {
              root_type: 'array',
              approx_size_bytes: JSON.stringify(parsedBody).length,
              top_level_keys: [],
              item_count_root: parsedBody.length,
              truncation: null,
            },
            detectedArrays: [],
            detectedCheckpointCandidates: [],
            sampleEvent: fe,
            selectedEventArrayDefault: null,
            flatPreviewFields: flattenSampleFields(fe),
            eventRootCandidates: detectEventRootCandidates(fe),
            previewError: null,
          }
        }
        const defaultArr = analysisModel?.selectedEventArrayDefault?.trim() ?? ''
        if (!state.stream.eventArrayPath.trim() && defaultArr) {
          onStreamPatch?.({ eventArrayPath: defaultArr, useWholeResponseAsEvent: false })
        }
        const pathForExtract = (state.stream.eventArrayPath.trim() || defaultArr).trim()
        const rawRoot = parsedBody !== null && typeof parsedBody === 'object' ? parsedBody : null
        const extractedEvents = wizardExtractEvents(rawRoot, pathForExtract, state.stream.eventRootPath)
        onStreamPatch?.({ useWholeResponseAsEvent: !pathForExtract && extractedEvents.length > 0 })
        onChange({
          status: 'success',
          ok: true,
          requestUrl: res.request.url,
          method: res.request.method,
          statusCode: res.response?.status_code ?? null,
          responseHeaders: res.response?.headers ?? {},
          rawBody: res.response?.raw_body ?? null,
          parsedJson: parsedBody,
          rawResponse: parsedBody ?? res.response?.raw_body ?? null,
          extractedEvents,
          eventCount: extractedEvents.length,
          startedAt,
          finishedAt: Date.now(),
          errorCode: null,
          errorType: null,
          errorMessage: null,
          targetStatusCode: null,
          targetResponseBody: null,
          hint: null,
          apiBacked: true,
          steps: mapApiSteps(res.steps),
          responseSample: parsedBody,
          effectiveHeadersMasked: res.request.headers_masked ?? null,
          actualRequestSent: res.actual_request_sent
            ? {
                method: res.actual_request_sent.method,
                url: res.actual_request_sent.url,
                endpoint: res.actual_request_sent.endpoint ?? null,
                queryParams: res.actual_request_sent.query_params ?? {},
                headersMasked: res.actual_request_sent.headers_masked ?? {},
                jsonBodyMasked: res.actual_request_sent.json_body_masked ?? null,
                timeoutSeconds: res.actual_request_sent.timeout_seconds,
              }
            : null,
          analysis: analysisModel,
          s3ConnectivityPassed: false,
          remoteProbe: probe,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Remote file sample fetch failed.'
        onChange({
          status: 'error',
          ok: false,
          requestUrl: null,
          method: null,
          statusCode: null,
          responseHeaders: {},
          rawBody: null,
          parsedJson: null,
          rawResponse: null,
          extractedEvents: [],
          eventCount: 0,
          startedAt,
          finishedAt: Date.now(),
          errorCode: 'remote_file_fetch_exception',
          errorType: 'remote_file_fetch_exception',
          errorMessage: message,
          targetStatusCode: null,
          targetResponseBody: null,
          hint: null,
          apiBacked: true,
          steps: [],
          responseSample: null,
          effectiveHeadersMasked: null,
          actualRequestSent: null,
          analysis: null,
          s3ConnectivityPassed: false,
          remoteProbe: lastProbe,
        })
      } finally {
        setBusy(false)
      }
      return
    }

    const syntax = validateJsonBodyForApi(state.stream.requestBody)
    if (syntax.ok === false) {
      const startedAt = Date.now()
      onChange({
        status: 'error',
        ok: false,
        requestUrl: null,
        method: null,
        statusCode: null,
        responseHeaders: {},
        rawBody: null,
        parsedJson: null,
        rawResponse: null,
        extractedEvents: [],
        eventCount: 0,
        startedAt,
        finishedAt: startedAt,
        errorCode: 'invalid_json_body',
        errorType: 'invalid_json_body',
        errorMessage: syntax.message,
        targetStatusCode: null,
        targetResponseBody: null,
        hint: 'Fix JSON syntax on the HTTP Request step, then retry.',
        apiBacked: false,
        steps: [],
        responseSample: null,
        effectiveHeadersMasked: null,
        actualRequestSent: null,
        analysis: null,
        s3ConnectivityPassed: false,
      })
      return
    }
    setBusy(true)
    const startedAt = Date.now()
    onChange({
      ...state.apiTest,
      status: 'running',
      startedAt,
      finishedAt: null,
      errorCode: null,
      errorType: null,
      errorMessage: null,
      targetStatusCode: null,
      targetResponseBody: null,
      hint: null,
      requestUrl: null,
      method: null,
      statusCode: null,
      responseHeaders: {},
      rawBody: null,
      parsedJson: null,
      steps: [],
      responseSample: null,
      effectiveHeadersMasked: null,
      analysis: null,
      actualRequestSent: null,
      s3ConnectivityPassed: false,
    })
    try {
      const res = await runHttpApiTest({
        connector_id: state.connector.connectorId ?? undefined,
        source_config: { ...buildSourceConfig(state), ...buildSourceAuthPayload(state) },
        stream_config: buildStreamConfigPayload(state),
        checkpoint: null,
        fetch_sample: true,
      })
      const parsedBody = res.response?.parsed_json ?? null
      const analysisModel = res.analysis ? mapApiAnalysis(res.analysis) : null
      const defaultArr = analysisModel?.selectedEventArrayDefault?.trim() ?? ''
      if (!state.stream.eventArrayPath.trim() && defaultArr) {
        onStreamPatch?.({ eventArrayPath: defaultArr, useWholeResponseAsEvent: false })
      }
      const pathForExtract = (state.stream.eventArrayPath.trim() || defaultArr).trim()
      const rawRoot =
        parsedBody !== null && typeof parsedBody === 'object' ? parsedBody : null
      const extractedEvents = wizardExtractEvents(rawRoot, pathForExtract, state.stream.eventRootPath)
      onChange({
        status: 'success',
        ok: true,
        requestUrl: res.request.url,
        method: res.request.method,
        statusCode: res.response?.status_code ?? null,
        responseHeaders: res.response?.headers ?? {},
        rawBody: res.response?.raw_body ?? null,
        parsedJson: parsedBody,
        rawResponse: parsedBody ?? res.response?.raw_body ?? null,
        extractedEvents,
        eventCount: extractedEvents.length,
        startedAt,
        finishedAt: Date.now(),
        errorCode: null,
        errorType: null,
        errorMessage: null,
        targetStatusCode: null,
        targetResponseBody: null,
        hint: null,
        apiBacked: true,
        steps: mapApiSteps(res.steps),
        responseSample: parsedBody,
        effectiveHeadersMasked: res.request.headers_masked ?? null,
        actualRequestSent: res.actual_request_sent
          ? {
              method: res.actual_request_sent.method,
              url: res.actual_request_sent.url,
              endpoint: res.actual_request_sent.endpoint ?? null,
              queryParams: res.actual_request_sent.query_params ?? {},
              headersMasked: res.actual_request_sent.headers_masked ?? {},
              jsonBodyMasked: res.actual_request_sent.json_body_masked ?? null,
              timeoutSeconds: res.actual_request_sent.timeout_seconds,
            }
          : null,
        analysis: analysisModel,
        s3ConnectivityPassed: false,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'API test failed.'
      type ErrDetail = {
        error_type?: string
        error_code?: string
        message?: string
        target_status_code?: number
        target_response_body?: string
        hint?: string
        json_line?: number
        json_column?: number
        steps?: Array<{ name: string; success: boolean; status_code?: number | null; message?: string }>
        response_sample?: unknown
        effective_request?: { headers?: Record<string, string> }
      }
      let code: string | null = null
      let errorType: string | null = null
      let detail: string = message
      let targetStatusCode: number | null = null
      let targetResponseBody: string | null = null
      let hint: string | null = null
      let errSteps: WizardApiTestStep[] = []
      let responseSample: unknown = null
      let effectiveHeadersMasked: Record<string, string> | null = null
      let actualRequestSent: WizardApiTestState['actualRequestSent'] = null
      try {
        const parsed = JSON.parse(message) as { detail?: ErrDetail }
        const d = parsed.detail
        errorType = d?.error_type ?? null
        detail = d?.message ?? message
        if (d?.json_line != null) {
          detail = `${detail} (line ${d.json_line}${d.json_column != null ? `, column ${d.json_column}` : ''})`
        }
        targetStatusCode = d?.target_status_code ?? null
        targetResponseBody = d?.target_response_body ?? null
        hint = d?.hint ?? null
        code = d?.error_code ?? d?.error_type ?? errorType
        errSteps = mapApiSteps(d?.steps)
        responseSample = d?.response_sample ?? null
        effectiveHeadersMasked = d?.effective_request?.headers ?? null
        const req = (d as { actual_request_sent?: Record<string, unknown> } | undefined)?.actual_request_sent
        if (req && typeof req === 'object') {
          actualRequestSent = {
            method: String(req.method ?? 'GET'),
            url: String(req.url ?? ''),
            endpoint: req.endpoint == null ? null : String(req.endpoint),
            queryParams:
              req.query_params && typeof req.query_params === 'object' && !Array.isArray(req.query_params)
                ? (req.query_params as Record<string, unknown>)
                : {},
            headersMasked:
              req.headers_masked && typeof req.headers_masked === 'object' && !Array.isArray(req.headers_masked)
                ? Object.fromEntries(
                    Object.entries(req.headers_masked as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
                  )
                : {},
            jsonBodyMasked: req.json_body_masked ?? null,
            timeoutSeconds: Number(req.timeout_seconds ?? 0),
          }
        }
      } catch {
        /* leave defaults */
      }
      onChange({
        status: 'error',
        ok: false,
        requestUrl: null,
        method: null,
        statusCode: null,
        responseHeaders: {},
        rawBody: null,
        parsedJson: null,
        rawResponse: null,
        extractedEvents: [],
        eventCount: 0,
        startedAt,
        finishedAt: Date.now(),
        errorCode: code,
        errorType,
        errorMessage: detail,
        targetStatusCode,
        targetResponseBody,
        hint,
        apiBacked: true,
        steps: errSteps,
        responseSample,
        effectiveHeadersMasked,
        actualRequestSent,
        analysis: null,
        s3ConnectivityPassed: false,
      })
    } finally {
      setBusy(false)
    }
  }, [busy, canRunLiveApiTest, onChange, onStreamPatch, state])

  const usePlaceholderData = useCallback(() => {
    const jsonPathDefault = '$.data.events'
    if (!state.stream.eventArrayPath.trim()) {
      onStreamPatch?.({ eventArrayPath: jsonPathDefault, useWholeResponseAsEvent: false })
    }
    const pathForExtract = state.stream.eventArrayPath.trim() || jsonPathDefault
    const events = wizardExtractEvents(PLACEHOLDER_RAW_RESPONSE, pathForExtract, state.stream.eventRootPath)
    const startedAt = Date.now()
    const placeholderAnalysis: WizardHttpApiAnalysis = {
      responseSummary: {
        root_type: 'object',
        approx_size_bytes: JSON.stringify(PLACEHOLDER_RAW_RESPONSE).length,
        top_level_keys: ['data'],
        item_count_root: null,
        truncation: null,
      },
      detectedArrays: [
        {
          path: '$.data.events',
          count: 3,
          confidence: 0.94,
          reason: 'Array of objects with repeated schema',
          sample_item_preview: PLACEHOLDER_RAW_RESPONSE.data.events[0],
        },
      ],
      detectedCheckpointCandidates: [
        {
          path: '$.data.next_cursor',
          checkpoint_type: 'CURSOR',
          confidence: 0.88,
          sample_value: 'sample-cursor-1',
          reason: 'cursor / pagination token field',
        },
        {
          path: '$.id',
          checkpoint_type: 'EVENT_ID',
          confidence: 0.9,
          sample_value: 'sample-1',
          reason: 'identifier-shaped field',
        },
      ],
      sampleEvent: (events[0] ?? null) as Record<string, unknown> | null,
      selectedEventArrayDefault: jsonPathDefault,
      flatPreviewFields: events[0] ? Object.keys(events[0]).map((k) => `$.${k}`) : [],
      eventRootCandidates: detectEventRootCandidates(events[0] ?? null),
      previewError: null,
    }
    onChange({
      status: 'success',
      ok: true,
      requestUrl: 'local://placeholder',
      method: state.stream.httpMethod,
      statusCode: 200,
      responseHeaders: { 'x-local-preview': 'true' },
      rawBody: JSON.stringify(PLACEHOLDER_RAW_RESPONSE),
      parsedJson: PLACEHOLDER_RAW_RESPONSE,
      rawResponse: PLACEHOLDER_RAW_RESPONSE,
      extractedEvents: events,
      eventCount: events.length,
      startedAt,
      finishedAt: startedAt + 1,
      errorCode: null,
      errorType: null,
      errorMessage: null,
      targetStatusCode: null,
      targetResponseBody: null,
      hint: null,
      apiBacked: false,
      steps: [],
      responseSample: null,
      effectiveHeadersMasked: null,
      actualRequestSent: null,
      analysis: placeholderAnalysis,
      s3ConnectivityPassed: false,
      remoteProbe: null,
    })
  }, [onChange, onStreamPatch, state.stream.eventArrayPath, state.stream.eventRootPath])

  const t = state.apiTest
  const isRemoteWizard = state.connector.sourceType === 'REMOTE_FILE_POLLING'
  const copy = sourcePres.wizardApiTest
  const elapsedMs = t.startedAt && t.finishedAt ? Math.max(0, t.finishedAt - t.startedAt) : null

  return (
    <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{sourcePres.wizard.apiTestStepTitle}</h3>
          <p className="text-[12px] text-slate-600 dark:text-gdc-muted">{copy.leadParagraph}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void usePlaceholderData()}
            disabled={busy}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200/90 bg-white px-2.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200 dark:hover:bg-gdc-rowHover"
            title="Load a placeholder response without calling the upstream API"
          >
            Use placeholder data
          </button>
            <button
            type="button"
            onClick={() => void run()}
            disabled={busy || !canRunLiveApiTest}
            title={
              !canRunLiveApiTest
                ? 'Select a connector and complete the required fields on the Stream Configuration step before running a live preview.'
                : undefined
            }
            className="inline-flex h-8 items-center gap-1 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
            {busy ? 'Running…' : sourcePres.wizard.apiTestStepTitle}
          </button>
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy || !canRunLiveApiTest}
            className="inline-flex h-8 items-center rounded-md border border-slate-200/90 bg-white px-2.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
          >
            Retry
          </button>
        </div>
      </div>

      <div className="mt-4">
        {t.status === 'idle' ? (
          <p className="rounded-md border border-dashed border-slate-300 bg-slate-50/70 p-4 text-center text-[12px] text-slate-600 dark:border-gdc-border dark:bg-gdc-card dark:text-gdc-mutedStrong">
            {!canRunLiveApiTest ? (
              <>
                <span className="font-semibold text-amber-800 dark:text-amber-200">Select a connector first</span>, then{' '}
                {copy.idleBlockedTail}.
              </>
            ) : (
              <>{copy.idleReady}</>
            )}
          </p>
        ) : null}
        {t.status === 'running' ? (
          <p className="rounded-md border border-slate-200 bg-slate-50 p-4 text-[12px] text-slate-700 dark:border-gdc-border dark:bg-gdc-card dark:text-gdc-mutedStrong">
            Calling source… this can take a few seconds depending on upstream latency.
          </p>
        ) : null}
        {t.status === 'error' ? (
          <ErrorPanel
            code={t.errorCode}
            errorType={t.errorType}
            message={t.errorMessage ?? 'Unknown error'}
            targetStatusCode={t.targetStatusCode}
            targetResponseBody={t.targetResponseBody}
            hint={t.hint}
            steps={t.steps}
            responseSample={t.responseSample}
            effectiveHeadersMasked={t.effectiveHeadersMasked}
          />
        ) : null}
        {t.status === 'success' ? (
          <div className="space-y-2">
            <SuccessPanel apiBacked={t.apiBacked} eventCount={t.eventCount} elapsedMs={elapsedMs} />
            {isRemoteWizard && t.remoteProbe ? <RemoteFileProbeSummary res={t.remoteProbe} /> : null}
            {t.apiBacked ? (
              <p className="text-[11px] text-slate-600 dark:text-gdc-muted">
                Continue to <span className="font-semibold">{sourcePres.wizard.previewStepTitle}</span> to inspect the response tree and choose{' '}
                <code className="rounded bg-slate-100 px-1 dark:bg-gdc-elevated">event_array_path</code>.
              </p>
            ) : null}
            <div className="grid gap-2 md:grid-cols-2">
              <Stat label="Request URL" value={t.requestUrl ?? '—'} />
              <Stat label="Method / Status" value={`${t.method ?? '—'} / ${t.statusCode ?? '—'}`} />
            </div>
            {t.apiBacked && t.actualRequestSent ? (
              <div className="rounded-md border border-slate-200/80 bg-slate-50/80 p-2 dark:border-gdc-border dark:bg-gdc-card">
                <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">Actual Request Sent</p>
                <div className="mt-1 grid gap-2 md:grid-cols-2">
                  <div>
                    <p className="text-[10px] font-semibold text-slate-500">Method / URL</p>
                    <pre className="mt-1 max-h-24 overflow-auto rounded border border-slate-200/80 bg-slate-900 p-2 text-[10px] text-slate-100">
                      {`${t.actualRequestSent.method} ${t.actualRequestSent.url}`}
                    </pre>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-slate-500">Endpoint / Timeout</p>
                    <pre className="mt-1 max-h-24 overflow-auto rounded border border-slate-200/80 bg-slate-900 p-2 text-[10px] text-slate-100">
                      {JSON.stringify(
                        {
                          endpoint: t.actualRequestSent.endpoint,
                          timeout_seconds: t.actualRequestSent.timeoutSeconds,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-slate-500">Query Parameters</p>
                    <pre className="mt-1 max-h-24 overflow-auto rounded border border-slate-200/80 bg-slate-900 p-2 text-[10px] text-slate-100">
                      {JSON.stringify(t.actualRequestSent.queryParams, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-slate-500">JSON Body</p>
                    <pre className="mt-1 max-h-24 overflow-auto rounded border border-slate-200/80 bg-slate-900 p-2 text-[10px] text-slate-100">
                      {JSON.stringify(t.actualRequestSent.jsonBodyMasked, null, 2)}
                    </pre>
                  </div>
                </div>
                <div className="mt-2">
                  <p className="text-[10px] font-semibold text-slate-500">Masked Headers</p>
                  <pre className="mt-1 max-h-24 overflow-auto rounded border border-slate-200/80 bg-slate-900 p-2 text-[10px] text-slate-100">
                    {JSON.stringify(t.actualRequestSent.headersMasked, null, 2)}
                  </pre>
                </div>
              </div>
            ) : null}
            {t.apiBacked && t.steps.length > 0 ? (
              <div>
                <p className="text-[11px] font-semibold text-slate-600 dark:text-gdc-mutedStrong">Auth / request steps</p>
                <ol className="mt-1 space-y-1 rounded-md border border-slate-200/80 bg-slate-50/80 p-2 text-[11px] dark:border-gdc-border dark:bg-gdc-card">
                  {t.steps.map((s, i) => (
                    <li key={`${s.name}-${i}`} className="flex flex-wrap gap-x-2 text-slate-700 dark:text-slate-200">
                      <span className={s.success ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}>
                        {s.success ? '✓' : '✗'} {s.name}
                      </span>
                      {s.status_code != null ? <span className="text-slate-500">HTTP {s.status_code}</span> : null}
                      {s.message ? <span className="min-w-0 break-words text-slate-600 dark:text-gdc-muted">{s.message}</span> : null}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            {t.apiBacked && t.effectiveHeadersMasked && Object.keys(t.effectiveHeadersMasked).length > 0 ? (
              <div>
                <p className="text-[11px] font-semibold text-slate-600 dark:text-gdc-mutedStrong">Effective headers (masked)</p>
                <pre className="mt-1 max-h-32 overflow-auto rounded-md border border-slate-200/80 bg-slate-900 p-2 text-[10px] text-slate-100">
                  {JSON.stringify(t.effectiveHeadersMasked, null, 2)}
                </pre>
              </div>
            ) : null}
            <div>
              <p className="text-[11px] font-semibold text-slate-600 dark:text-gdc-mutedStrong">Response headers</p>
              <pre className="mt-1 max-h-32 overflow-auto rounded-md border border-slate-200/80 bg-slate-900 p-2 text-[10px] text-slate-100">
                {JSON.stringify(t.responseHeaders, null, 2)}
              </pre>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold text-slate-600 dark:text-gdc-mutedStrong">Formatted JSON</p>
                <pre className="mt-1 max-h-56 overflow-auto rounded-md border border-slate-200/80 bg-slate-950 p-2 text-[10px] text-emerald-200">
                  {JSON.stringify(t.rawResponse, null, 2)}
                </pre>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-slate-600 dark:text-gdc-mutedStrong">Raw Response</p>
                <pre className="mt-1 max-h-56 overflow-auto rounded-md border border-slate-200/80 bg-slate-900 p-2 text-[10px] text-slate-100">
                  {t.rawBody ?? JSON.stringify(t.rawResponse)}
                </pre>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function SuccessPanel({
  apiBacked,
  eventCount,
  elapsedMs,
}: {
  apiBacked: boolean
  eventCount: number
  elapsedMs: number | null
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <Stat
        tone="success"
        label="Status"
        value={apiBacked ? 'API-backed · 200 OK' : 'Local preview · placeholder data'}
        icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
      />
      <Stat label="Extracted events" value={`${eventCount}`} />
      <Stat label="Latency" value={elapsedMs != null ? `${elapsedMs} ms` : '—'} />
    </div>
  )
}

function ErrorPanel({
  code,
  errorType,
  message,
  targetStatusCode,
  targetResponseBody,
  hint,
  steps,
  responseSample,
  effectiveHeadersMasked,
}: {
  code: string | null
  errorType: string | null
  message: string
  targetStatusCode: number | null
  targetResponseBody: string | null
  hint: string | null
  steps: WizardApiTestStep[]
  responseSample: unknown
  effectiveHeadersMasked: Record<string, string> | null
}) {
  return (
    <div className="rounded-md border border-red-200/80 bg-red-500/[0.06] p-4 text-[12px] dark:border-red-500/40 dark:bg-red-500/10">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700 dark:text-red-300" aria-hidden />
        <div className="min-w-0">
          <p className="font-semibold text-red-800 dark:text-red-200">{code ?? 'API_TEST_FAILED'}</p>
          <p className="mt-1 break-words text-red-700 dark:text-red-200">{message}</p>
          {errorType && errorType !== code ? <p className="mt-2 text-[11px] text-red-700 dark:text-red-200">Type: {errorType}</p> : null}
          {targetStatusCode != null ? (
            <p className="mt-1 text-[11px] text-red-700 dark:text-red-200">Status code: {targetStatusCode}</p>
          ) : null}
          {steps.length > 0 ? (
            <div className="mt-3">
              <p className="text-[11px] font-semibold text-red-800 dark:text-red-200">Steps</p>
              <ol className="mt-1 space-y-1 text-[11px] text-red-900/90 dark:text-red-100/90">
                {steps.map((s, i) => (
                  <li key={`${s.name}-e-${i}`}>
                    {s.success ? '✓' : '✗'} {s.name}
                    {s.status_code != null ? ` · HTTP ${s.status_code}` : ''}
                    {s.message ? ` — ${s.message}` : ''}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          {effectiveHeadersMasked && Object.keys(effectiveHeadersMasked).length > 0 ? (
            <div className="mt-3">
              <p className="text-[11px] font-semibold text-red-800 dark:text-red-200">Request headers (masked)</p>
              <pre className="mt-1 max-h-28 overflow-auto rounded border border-red-200/50 bg-red-950/40 p-2 text-[10px] text-red-100/90">
                {JSON.stringify(effectiveHeadersMasked, null, 2)}
              </pre>
            </div>
          ) : null}
          {responseSample != null ? (
            <div className="mt-3">
              <p className="text-[11px] font-semibold text-red-800 dark:text-red-200">Response sample (masked)</p>
              <pre className="mt-1 max-h-40 overflow-auto rounded border border-red-200/50 bg-red-950/40 p-2 text-[10px] text-red-100/90">
                {typeof responseSample === 'string' ? responseSample : JSON.stringify(responseSample, null, 2)}
              </pre>
            </div>
          ) : null}
          {targetResponseBody ? (
            <p className="mt-2 line-clamp-4 text-[11px] text-red-700 dark:text-red-200">Body: {targetResponseBody}</p>
          ) : null}
          <p className="mt-2 text-[11px] text-red-600 dark:text-red-300/80">{hint ?? 'Check request URL, authentication, headers, and proxy settings.'}</p>
        </div>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
  icon,
}: {
  label: string
  value: string
  tone?: 'success' | 'warning' | 'neutral'
  icon?: ReactNode
}) {
  const toneClass =
    tone === 'success'
      ? 'border-emerald-200/80 bg-emerald-500/[0.07] text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200'
      : tone === 'warning'
        ? 'border-amber-200/80 bg-amber-500/[0.07] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200'
        : 'border-slate-200/80 bg-slate-50/70 text-slate-700 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200'
  return (
    <div className={cn('rounded-md border p-3', toneClass)}>
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide opacity-80">
        {icon ?? null}
        {label}
      </p>
      <p className="mt-1 text-[12px] font-semibold">{value}</p>
    </div>
  )
}
