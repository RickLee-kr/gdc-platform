import { streamApiTestPath, streamEditPath, streamEnrichmentPath, streamMappingPath, streamRuntimePath } from '../config/nav-paths'
import type { StreamRuntimeStatus } from '../api/streamRows'
import { resolveSourceTypePresentation } from './sourceTypePresentation'

/**
 * Stream onboarding/edit workflow completion model.
 *
 * Steps stay aligned with master-design + spec 001/002:
 *   Connector → Source → API Test → Mapping → Enrichment → Destination → Route → Saved
 *
 * The runtime/edit pages share this snapshot so the operator sees a single,
 * stable progress definition across the configuration → runtime drill-down loop.
 */
export type StreamWorkflowStepKey =
  | 'connector'
  | 'apiTest'
  | 'mapping'
  | 'enrichment'
  | 'destination'
  | 'route'
  | 'saved'

export type StreamWorkflowStepStatus = 'complete' | 'pending' | 'attention'

export type StreamWorkflowStep = {
  key: StreamWorkflowStepKey
  label: string
  shortLabel: string
  status: StreamWorkflowStepStatus
  detail?: string
  nextActionLabel: string
  to: string
}

export type StreamWorkflowSnapshot = {
  streamId: string
  isNumericStreamId: boolean
  steps: StreamWorkflowStep[]
  completedCount: number
  totalCount: number
  pct: number
  attentionCount: number
  nextStepKey: StreamWorkflowStepKey | null
  nextStepLabel: string
  nextStepDetail?: string
  nextStepPath: string
  runtimePath: string
  editPath: string
  /** True only when every configuration step is complete (Start Stream is the next operator action). */
  isReadyToStart: boolean
  isRunning: boolean
}

export type StreamWorkflowInput = {
  streamId: string
  status: StreamRuntimeStatus
  events1h: number
  deliveryPct: number
  routesTotal: number
  routesOk: number
  routesDegraded?: number
  routesError?: number
  /** Optional explicit overrides; useful when wizard pages know more than the row data. */
  hasConnector?: boolean
  hasApiTest?: boolean
  hasMapping?: boolean
  hasEnrichment?: boolean
  hasSaved?: boolean
  /** Present when stream rows load `/runtime/streams/{id}/mapping-ui/config`. */
  connectorLinked?: boolean
  mappingPersisted?: boolean
  enrichmentPersisted?: boolean
  apiTestDone?: boolean
  persistedRoutesCount?: number
  /** Optional: mapping-ui `source_type` or stream `stream_type` — drives labels only. */
  sourceType?: string | null
  enabledDeliveryRoute?: boolean
}

function statusFor(ok: boolean, attention: boolean): StreamWorkflowStepStatus {
  if (ok) return 'complete'
  if (attention) return 'attention'
  return 'pending'
}

/** Computes the workflow snapshot used for progress display + next-action guidance. */
export function computeStreamWorkflow(input: StreamWorkflowInput): StreamWorkflowSnapshot {
  const {
    streamId,
    status,
    events1h,
    deliveryPct,
    routesTotal,
    routesOk,
    routesError = 0,
  } = input

  const isNumericStreamId = /^\d+$/.test(streamId)
  const isRunning = status === 'RUNNING'
  const isError = status === 'ERROR'
  const isUnknown = status === 'UNKNOWN'

  const persistedRoutesRaw =
    typeof input.persistedRoutesCount === 'number' && Number.isFinite(input.persistedRoutesCount)
      ? Math.max(0, Math.floor(input.persistedRoutesCount))
      : 0
  const routesTotalEff = Math.max(routesTotal, persistedRoutesRaw)

  const connectorOk =
    input.connectorLinked !== undefined
      ? input.connectorLinked
      : input.hasConnector !== undefined
        ? input.hasConnector
        : !isUnknown

  const apiTestOk =
    input.apiTestDone !== undefined
      ? input.apiTestDone
      : input.hasApiTest !== undefined
        ? input.hasApiTest
        : events1h > 0 || isRunning || routesOk > 0

  const mappingOk =
    input.mappingPersisted !== undefined
      ? input.mappingPersisted
      : input.hasMapping !== undefined
        ? input.hasMapping
        : deliveryPct > 0 || (events1h > 0 && routesOk > 0)

  const enrichmentOk =
    input.enrichmentPersisted !== undefined
      ? input.enrichmentPersisted
      : input.hasEnrichment !== undefined
        ? input.hasEnrichment
        : mappingOk && (deliveryPct > 0 || routesOk > 0)

  const destinationOk = routesTotalEff > 0

  const routeOk =
    routesOk > 0 || (input.enabledDeliveryRoute === true && routesTotalEff > 0)

  const routeAttention = !routeOk && (routesTotalEff > 0 || routesError > 0)

  const savedOk =
    input.hasSaved !== undefined ? input.hasSaved : !isUnknown

  const wfUi = resolveSourceTypePresentation(input.sourceType)

  const steps: StreamWorkflowStep[] = [
    {
      key: 'connector',
      label: 'Connector / Source selected',
      shortLabel: 'Connector',
      status: statusFor(connectorOk, false),
      detail: connectorOk ? undefined : 'Connector or source not yet linked.',
      nextActionLabel: 'Select connector',
      to: streamEditPath(streamId),
    },
    {
      key: 'apiTest',
      label: wfUi.workflow.apiTestStepDoneLabel,
      shortLabel: wfUi.workflow.apiTestShortLabel,
      status: statusFor(apiTestOk, false),
      detail: apiTestOk ? undefined : wfUi.workflow.apiTestDetailPending,
      nextActionLabel: wfUi.workflow.apiTestNextAction,
      to: streamApiTestPath(streamId),
    },
    {
      key: 'mapping',
      label: 'Mapping configured',
      shortLabel: 'Mapping',
      status: statusFor(mappingOk, false),
      detail: mappingOk ? undefined : 'Field mapping not yet validated against live data.',
      nextActionLabel: 'Configure Mapping',
      to: streamMappingPath(streamId),
    },
    {
      key: 'enrichment',
      label: 'Enrichment configured',
      shortLabel: 'Enrichment',
      status: statusFor(enrichmentOk, false),
      detail: enrichmentOk ? undefined : 'Enrichment fields are not validated yet.',
      nextActionLabel: 'Configure Enrichment',
      to: streamEnrichmentPath(streamId),
    },
    {
      key: 'destination',
      label: 'Destination selected',
      shortLabel: 'Destination',
      status: statusFor(destinationOk, false),
      detail: destinationOk ? undefined : 'No destination linked through a route yet.',
      nextActionLabel: destinationOk ? 'Configure Delivery' : 'Add Destination',
      to: streamEditPath(streamId),
    },
    {
      key: 'route',
      label: 'Route policy configured',
      shortLabel: 'Route',
      status: statusFor(routeOk, routeAttention),
      detail: routeOk
        ? undefined
        : routesTotalEff > 0
          ? 'Route exists but is disabled or unhealthy.'
          : 'No route linking the stream to a destination.',
      nextActionLabel: routesTotalEff > 0 && !routeOk ? 'Enable Route' : 'Configure Route Policy',
      to: streamEditPath(streamId),
    },
    {
      key: 'saved',
      label: 'Stream saved',
      shortLabel: 'Saved',
      status: statusFor(savedOk, false),
      detail: savedOk ? undefined : 'Stream configuration is not persisted yet.',
      nextActionLabel: 'Review Auto-save',
      to: streamEditPath(streamId),
    },
  ]

  // Mark complete steps as 'attention' when the runtime reports ERROR — the
  // operator should re-validate the working configuration even if the data
  // model says "configured".
  if (isError) {
    for (const step of steps) {
      if (step.status === 'complete' && (step.key === 'route' || step.key === 'saved' || step.key === 'destination')) {
        step.status = 'attention'
        if (!step.detail) step.detail = 'Runtime is in ERROR state.'
      }
    }
  }

  const completedCount = steps.filter((s) => s.status === 'complete').length
  const totalCount = steps.length
  const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
  const attentionCount = steps.filter((s) => s.status === 'attention').length

  const firstUnfinished = steps.find((s) => s.status !== 'complete')
  const isReadyToStart = firstUnfinished == null

  let nextStepKey: StreamWorkflowStepKey | null = null
  let nextStepLabel: string
  let nextStepDetail: string | undefined
  let nextStepPath: string
  if (firstUnfinished) {
    nextStepKey = firstUnfinished.key
    nextStepLabel = firstUnfinished.nextActionLabel
    nextStepDetail = firstUnfinished.detail
    nextStepPath = firstUnfinished.to
  } else if (!isRunning) {
    nextStepLabel = 'Start Stream'
    nextStepPath = streamRuntimePath(streamId)
  } else {
    nextStepLabel = 'View Runtime'
    nextStepPath = streamRuntimePath(streamId)
  }

  return {
    streamId,
    isNumericStreamId,
    steps,
    completedCount,
    totalCount,
    pct,
    attentionCount,
    nextStepKey,
    nextStepLabel,
    nextStepDetail,
    nextStepPath,
    runtimePath: streamRuntimePath(streamId),
    editPath: streamEditPath(streamId),
    isReadyToStart,
    isRunning,
  }
}

export type RuntimeStreamSlugMatch = {
  /** Numeric backend id when known, else `null`. Slug fallback always exists. */
  id: number | null
  slug: string
}

const RUNTIME_NAME_TO_SLUG: ReadonlyArray<{ test: RegExp; slug: string }> = [
  { test: /malop/i, slug: 'malop-api' },
  { test: /hunting/i, slug: 'hunting-api' },
  { test: /sensor/i, slug: 'sensor-inventory' },
  { test: /detection/i, slug: 'crowdstrike-detections' },
  { test: /defender|advanced hunting/i, slug: 'defender-advanced-hunting' },
  { test: /okta|system log/i, slug: 'okta-system-log' },
  { test: /audit/i, slug: 'malop-api' },
  { test: /webhook/i, slug: 'malop-api' },
  { test: /syslog/i, slug: 'legacy-syslog-bridge' },
]

/**
 * Maps a free-text stream name (mock runtime/logs view) back to a deterministic
 * slug so workflow drill-down keeps working without backend ids.
 *
 * Numeric backend ids stay numeric; slug fallback is preserved per the
 * project's existing routing convention.
 */
export function resolveStreamRouteIdentifier(name: string): RuntimeStreamSlugMatch {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return { id: null, slug: '' }
  if (/^\d+$/.test(trimmed)) return { id: Number(trimmed), slug: trimmed }
  const match = RUNTIME_NAME_TO_SLUG.find((entry) => entry.test.test(trimmed))
  if (match) return { id: null, slug: match.slug }
  // Last resort: deterministic slug derived from the name.
  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '')
  return { id: null, slug: slug || 'stream' }
}
