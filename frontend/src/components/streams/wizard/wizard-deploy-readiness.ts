import { incrementalRequestTestWarning } from './wizard-incremental-request'
import { countDuplicateEnrichmentKeys } from './wizard-review-preview'
import {
  buildDataProtectionPersistPreview,
  protectionActionNeedsFieldRule,
} from './wizard-data-protection-persist'
import {
  wizardApiTestReady,
  wizardCheckpointConfirmed,
  wizardDestinationGateReady,
  wizardRecordPathConfirmed,
} from './wizard-step-gates'
import {
  computeLegacySubstepCompletion,
  computeWizardRouteProcessingStatuses,
  wizardDataProtectionIntentReady,
  wizardMappingContentReady,
  type RouteProcessingStatus,
  type WizardLegacySubstepKey,
  type WizardRouteDraft,
  type WizardState,
} from './wizard-state'
import { WIZARD_LABEL } from '../../../lib/operator-vocabulary'
import {
  getUnionSchemaSampleStatus,
  resolveUnionSchemaSampleCount,
} from '../../../utils/unionSchemaSamplePolicy'

export type DeployChecklistTone = 'ok' | 'warn' | 'err'

export type DeployReadinessStatus = 'ready' | 'ready_with_warnings' | 'needs_attention'

export type DeployChecklistCategoryKey =
  | 'connection'
  | 'data'
  | 'records'
  | 'transform'
  | 'protection'
  | 'route_processing'
  | 'delivery'

export type DeployChecklistCategory = {
  key: DeployChecklistCategoryKey
  label: string
  tone: DeployChecklistTone
  summary: string
  detail?: string
  stepKey: WizardLegacySubstepKey
}

export type DeployConnectivityInfo = {
  ok: boolean
  failed: boolean
  unknown: boolean
}

export type DeployReadinessSnapshot = {
  status: DeployReadinessStatus
  statusLabel: 'READY' | 'READY WITH WARNINGS' | 'NEEDS ATTENTION'
  canCreate: boolean
  categories: DeployChecklistCategory[]
}

export const DEPLOY_STATUS_LABEL: Record<DeployReadinessStatus, DeployReadinessSnapshot['statusLabel']> = {
  ready: 'READY',
  ready_with_warnings: 'READY WITH WARNINGS',
  needs_attention: 'NEEDS ATTENTION',
}

export type RouteProcessingSummary = {
  enabledRoutes: number
  totalRoutes: number
  transformLabel: string
  protectionLabel: string
  overrideRouteCount: number
  overrideCounts: {
    transform: number
    protection: number
    classification: number
    policy: number
  }
}

export function computeRouteProcessingOverrideCounts(
  state: Pick<WizardState, 'destinations' | 'dataProtection'>,
): RouteProcessingSummary['overrideCounts'] {
  const counts = { transform: 0, protection: 0, classification: 0, policy: 0 }
  for (const draft of state.destinations.routeDrafts) {
    const statuses = computeWizardRouteProcessingStatuses(draft, state.dataProtection)
    if (statuses.transform !== 'Inherited') counts.transform += 1
    if (statuses.protection !== 'Inherited') counts.protection += 1
    if (statuses.classification !== 'Inherited') counts.classification += 1
    if (statuses.policy !== 'Inherited') counts.policy += 1
  }
  return counts
}

export function buildRouteProcessingSummary(
  state: Pick<WizardState, 'destinations' | 'dataProtection'>,
): RouteProcessingSummary {
  const routeDrafts = state.destinations.routeDrafts
  const overrideCounts = computeRouteProcessingOverrideCounts(state)
  let overrideRouteCount = 0
  for (const draft of routeDrafts) {
    const statuses = computeWizardRouteProcessingStatuses(draft, state.dataProtection)
    const hasOverride = [statuses.transform, statuses.protection, statuses.classification, statuses.policy].some(
      (s) => s !== 'Inherited',
    )
    if (hasOverride) overrideRouteCount += 1
  }
  const sharedDefault = 'Shared default'
  return {
    enabledRoutes: routeDrafts.filter((r) => r.enabled).length,
    totalRoutes: routeDrafts.length,
    transformLabel: overrideRouteCount > 0 ? `${overrideRouteCount} route override(s)` : sharedDefault,
    protectionLabel: overrideRouteCount > 0 ? `${overrideRouteCount} route override(s)` : sharedDefault,
    overrideRouteCount,
    overrideCounts,
  }
}

export function formatRouteProcessingSummaryLine(summary: RouteProcessingSummary): string {
  return `${summary.enabledRoutes} enabled / ${summary.totalRoutes} total`
}

export type RouteDeployReadinessStatus = 'ready' | 'warning' | 'error'

export type RouteProcessingConcern = 'transform' | 'protection' | 'classification' | 'policy'

export const ROUTE_PROCESSING_CONCERN_LABEL: Record<RouteProcessingConcern, string> = {
  transform: 'Transform',
  protection: 'Protection',
  classification: 'Classification',
  policy: 'Policy',
}

export type RouteProcessingDeployMode = 'shared' | 'override'

export type RouteDeployHealth = {
  routeKey: string
  label: string
  enabled: boolean
  status: RouteDeployReadinessStatus
  statusLabel: 'Ready' | 'Warning' | 'Needs Attention'
  processing: Record<RouteProcessingConcern, RouteProcessingDeployMode>
  overrideConcerns: RouteProcessingConcern[]
  warningReasons: string[]
  errorReasons: string[]
}

export type RouteOverrideDeploySummary = {
  label: string
  concerns: RouteProcessingConcern[]
}

export type SharedProcessingDeploySummary = {
  concerns: RouteProcessingConcern[]
  appliedToRouteCount: number
}

export type RouteDeployReadinessSnapshot = {
  totalRoutes: number
  routes: RouteDeployHealth[]
  readyCount: number
  warningCount: number
  errorCount: number
  overrideRoutes: RouteOverrideDeploySummary[]
  sharedProcessing: SharedProcessingDeploySummary
}

export type RouteDeployDestinationMeta = {
  id: number
  name?: string | null
  last_connectivity_test_success?: boolean | null
}

const ROUTE_DEPLOY_STATUS_LABEL: Record<RouteDeployReadinessStatus, RouteDeployHealth['statusLabel']> = {
  ready: 'Ready',
  warning: 'Warning',
  error: 'Needs Attention',
}

export function routeProcessingStatusToDeployMode(status: RouteProcessingStatus): RouteProcessingDeployMode {
  return status === 'Inherited' ? 'shared' : 'override'
}

export function routeOverrideConcernsFromStatuses(
  statuses: ReturnType<typeof computeWizardRouteProcessingStatuses>,
): RouteProcessingConcern[] {
  const concerns: RouteProcessingConcern[] = []
  if (statuses.transform !== 'Inherited') concerns.push('transform')
  if (statuses.protection !== 'Inherited') concerns.push('protection')
  if (statuses.classification !== 'Inherited') concerns.push('classification')
  if (statuses.policy !== 'Inherited') concerns.push('policy')
  return concerns
}

function computeStreamProcessingWarnings(state: WizardState): { transformWarn: boolean; protectionWarn: boolean } {
  const enrichmentDupes = countDuplicateEnrichmentKeys(state.enrichment)
  const enrichmentValid =
    state.enrichment.length === 0 || state.enrichment.every((e) => e.fieldName.trim().length > 0)
  const enrichmentOk = enrichmentValid && enrichmentDupes === 0
  const mappingReady =
    wizardMappingContentReady(state) || state.transformRules.some((r) => r.outputField.trim())
  const dataOk = wizardApiTestReady(state)
  const sampleCount = resolveUnionSchemaSampleCount(state.apiTest)
  const samplePolicy = getUnionSchemaSampleStatus(sampleCount)
  const transformSampleWarn = dataOk && samplePolicy.status !== 'ready'
  const transformWarn =
    (mappingReady && (!enrichmentOk || enrichmentDupes > 0)) || transformSampleWarn

  const validProtectionIntents = state.dataProtection.intents.filter(wizardDataProtectionIntentReady)
  const incompleteProtectionRows = state.dataProtection.intents.some(
    (intent) => intent.detectedField.trim().length > 0 && !wizardDataProtectionIntentReady(intent),
  )
  const protectionPreview = buildDataProtectionPersistPreview(state.dataProtection)
  const protectionOk =
    validProtectionIntents.length === 0 ||
    (!incompleteProtectionRows && !protectionPreview.enforcementIncomplete)
  const protectionWarn =
    !protectionOk &&
    !incompleteProtectionRows &&
    (protectionPreview.enforcementIncomplete || protectionPreview.warnings.length > 0)

  return { transformWarn, protectionWarn }
}

function evaluateRouteDeployHealth(
  route: WizardRouteDraft,
  label: string,
  destination: RouteDeployDestinationMeta | undefined,
  dataProtection: WizardState['dataProtection'],
  streamWarnings: { transformWarn: boolean; protectionWarn: boolean },
): RouteDeployHealth {
  const statuses = computeWizardRouteProcessingStatuses(route, dataProtection)
  const overrideConcerns = routeOverrideConcernsFromStatuses(statuses)
  const errorReasons: string[] = []
  const warningReasons: string[] = []

  const missingDestination = !route.destinationId || route.destinationId <= 0
  if (route.enabled && missingDestination) {
    errorReasons.push('No destination configured')
  } else if (missingDestination) {
    warningReasons.push('No destination configured')
  } else if (!destination) {
    if (route.enabled) errorReasons.push('Destination not found')
    else warningReasons.push('Destination not found')
  }

  if (route.enabled && errorReasons.length === 0 && destination) {
    if (destination.last_connectivity_test_success === false) {
      errorReasons.push('Connectivity test failed')
    } else if (destination.last_connectivity_test_success !== true) {
      warningReasons.push('Connectivity not verified')
    }
  }

  if (overrideConcerns.length > 0) {
    warningReasons.push('Route processing overrides configured')
  }
  if (streamWarnings.transformWarn) {
    warningReasons.push('Stream transform needs attention')
  }
  if (streamWarnings.protectionWarn) {
    warningReasons.push('Data protection needs attention')
  }

  let status: RouteDeployReadinessStatus
  if (errorReasons.length > 0) {
    status = 'error'
  } else if (warningReasons.length > 0) {
    status = 'warning'
  } else {
    status = 'ready'
  }

  return {
    routeKey: route.key,
    label,
    enabled: route.enabled,
    status,
    statusLabel: ROUTE_DEPLOY_STATUS_LABEL[status],
    processing: {
      transform: routeProcessingStatusToDeployMode(statuses.transform),
      protection: routeProcessingStatusToDeployMode(statuses.protection),
      classification: routeProcessingStatusToDeployMode(statuses.classification),
      policy: routeProcessingStatusToDeployMode(statuses.policy),
    },
    overrideConcerns,
    warningReasons,
    errorReasons,
  }
}

export function buildSharedProcessingDeploySummary(
  _state: Pick<WizardState, 'mapping' | 'transformRules' | 'mappingMode' | 'fullEventJsonataExpression' | 'fullEventRegexConfigJson' | 'dataProtection'>,
  totalRoutes: number,
): SharedProcessingDeploySummary {
  const concerns: RouteProcessingConcern[] = ['transform', 'protection', 'classification', 'policy']
  return {
    concerns,
    appliedToRouteCount: totalRoutes,
  }
}

export function computeRouteDeployReadiness(
  state: WizardState,
  destinations: RouteDeployDestinationMeta[] = [],
): RouteDeployReadinessSnapshot {
  const routeDrafts = state.destinations.routeDrafts
  const destById = new Map(destinations.map((d) => [d.id, d]))
  const streamWarnings = computeStreamProcessingWarnings(state)

  const routes = routeDrafts.map((route) => {
    const destination = destById.get(route.destinationId)
    const label = destination?.name?.trim() || `Destination #${route.destinationId}`
    return evaluateRouteDeployHealth(route, label, destination, state.dataProtection, streamWarnings)
  })

  const overrideRoutes: RouteOverrideDeploySummary[] = routes
    .filter((route) => route.overrideConcerns.length > 0)
    .map((route) => ({
      label: route.label,
      concerns: route.overrideConcerns,
    }))

  return {
    totalRoutes: routeDrafts.length,
    routes,
    readyCount: routes.filter((route) => route.status === 'ready').length,
    warningCount: routes.filter((route) => route.status === 'warning').length,
    errorCount: routes.filter((route) => route.status === 'error').length,
    overrideRoutes,
    sharedProcessing: buildSharedProcessingDeploySummary(state, routeDrafts.length),
  }
}

function categoryTone(ok: boolean, warn: boolean): DeployChecklistTone {
  if (ok) return 'ok'
  if (warn) return 'warn'
  return 'err'
}

export function computeDeployReadiness(
  state: WizardState,
  connectivity: DeployConnectivityInfo = { ok: true, failed: false, unknown: false },
): DeployReadinessSnapshot {
  const completion = computeLegacySubstepCompletion(state)
  const reviewReady = completion.review === 'in_progress'

  const previewErr = state.apiTest.analysis?.previewError
  const eventPathOk = wizardRecordPathConfirmed(state) && !previewErr
  const syncPositionOk = wizardCheckpointConfirmed(state)

  const mappedCount = state.mapping.filter((m) => m.outputField.trim() && m.sourceJsonPath.trim()).length
  const mappingReady =
    wizardMappingContentReady(state) || state.transformRules.some((r) => r.outputField.trim())
  const enrichmentDupes = countDuplicateEnrichmentKeys(state.enrichment)
  const enrichmentValid =
    state.enrichment.length === 0 || state.enrichment.every((e) => e.fieldName.trim().length > 0)
  const enrichmentOk = enrichmentValid && enrichmentDupes === 0

  const checkpointOk = syncPositionOk

  const incrementalTestWarn = incrementalRequestTestWarning({
    pattern: state.stream.incrementalRequestPattern,
    draft: state.stream.incrementalRequestDraft,
    checkpointSourcePath: state.stream.checkpointSourcePath,
    eventArrayPath: state.stream.eventArrayPath,
    lastSuccessSignature: state.stream.incrementalRequestTestSignature,
    lastSuccessAt: state.stream.incrementalRequestTestedAt,
  })

  const routeDrafts = state.destinations.routeDrafts
  const enabledRoutes = routeDrafts.filter((r) => r.enabled).length

  const connectionOk =
    completion.connector === 'complete' && completion.stream === 'complete' && completion.api_test === 'complete'
  const connectionWarn =
    !connectionOk &&
    completion.connector !== 'incomplete' &&
    completion.stream !== 'incomplete' &&
    completion.api_test !== 'complete'
  const dataOk = wizardApiTestReady(state)
  const sampleCount = resolveUnionSchemaSampleCount(state.apiTest)
  const samplePolicy = getUnionSchemaSampleStatus(sampleCount)
  const samplePolicyWarn = dataOk && samplePolicy.status !== 'ready'
  const dataWarn = (state.apiTest.status === 'success' && !state.apiTest.ok) || samplePolicyWarn

  const recordsBlocked = !eventPathOk || !checkpointOk
  const recordsOk = !recordsBlocked && incrementalTestWarn.level !== 'warning'
  const recordsWarn =
    !recordsBlocked &&
    (incrementalTestWarn.level === 'warning' ||
      Boolean(previewErr && previewErr.length > 0 && eventPathOk))

  const transformOk = mappingReady && enrichmentOk
  const transformSampleWarn = dataOk && samplePolicy.status !== 'ready'
  const transformWarn = (mappingReady && (!enrichmentOk || enrichmentDupes > 0)) || transformSampleWarn

  const deliveryOk = wizardDestinationGateReady(state) && connectivity.ok
  const deliveryWarn =
    wizardDestinationGateReady(state) && connectivity.unknown && !connectivity.failed

  const validProtectionIntents = state.dataProtection.intents.filter(wizardDataProtectionIntentReady)
  const incompleteProtectionRows = state.dataProtection.intents.some(
    (intent) => intent.detectedField.trim().length > 0 && !wizardDataProtectionIntentReady(intent),
  )
  const protectionPreview = buildDataProtectionPersistPreview(state.dataProtection)
  const protectionOk =
    validProtectionIntents.length === 0 ||
    (!incompleteProtectionRows && !protectionPreview.enforcementIncomplete)
  const protectionWarn =
    !protectionOk &&
    !incompleteProtectionRows &&
    (protectionPreview.enforcementIncomplete || protectionPreview.warnings.length > 0)

  const routeProcessingSummary = buildRouteProcessingSummary(state)
  const routeProcessingOk = wizardDestinationGateReady(state) && transformOk && protectionOk
  const routeProcessingWarn =
    wizardDestinationGateReady(state) &&
    !routeProcessingOk &&
    (transformWarn || protectionWarn || routeProcessingSummary.totalRoutes === 0)
  const routeProcessingTone = categoryTone(routeProcessingOk, routeProcessingWarn)

  const connectionTone = categoryTone(
    connectionOk,
    connectionWarn,
  )

  const dataTone = !dataOk ? categoryTone(dataOk, dataWarn) : samplePolicyWarn ? 'warn' : 'ok'

  const recordsTone = categoryTone(recordsOk, recordsWarn)

  const transformTone = categoryTone(transformOk && !transformSampleWarn, transformWarn)

  const protectionTone = categoryTone(protectionOk, protectionWarn)

  const deliveryTone = categoryTone(deliveryOk, deliveryWarn)

  const categories: DeployChecklistCategory[] = [
    {
      key: 'connection',
      label: 'Connection',
      tone: connectionTone,
      summary: connectionOk
        ? WIZARD_LABEL.connectorConfigured
        : connectionWarn
          ? 'Source connection configured — run Test Connection'
          : 'Complete source connection, request, and connection test',
      stepKey: 'connector',
    },
    {
      key: 'data',
      label: 'Data',
      tone: dataTone,
      summary: dataOk
        ? samplePolicy.status === 'needs_attention'
          ? 'Sample fetched — Union Schema needs attention'
          : samplePolicy.status === 'warning'
            ? 'Sample fetched — more events recommended'
            : 'Sample data fetched successfully'
        : dataWarn
          ? 'Sample returned — review response status'
          : 'Run a successful sample fetch',
      detail: samplePolicyWarn
        ? samplePolicy.message ?? undefined
        : dataWarn && !dataOk
          ? state.apiTest.errorMessage ?? undefined
          : undefined,
      stepKey: 'api_test',
    },
    {
      key: 'records',
      label: 'Records',
      tone: recordsTone,
      summary: recordsOk
        ? 'Record path and sync position confirmed'
        : recordsWarn
          ? 'Record selection needs review'
          : 'Confirm record path and sync position',
      detail:
        incrementalTestWarn.level === 'warning'
          ? incrementalTestWarn.message
          : previewErr && previewErr.length > 0
            ? previewErr
            : undefined,
      stepKey: 'preview',
    },
    {
      key: 'transform',
      label: 'Transform',
      tone: transformTone,
      summary: transformOk
        ? `${mappedCount > 0 ? mappedCount : 'Full-event'} output field${mappedCount === 1 ? '' : 's'} ready`
        : transformWarn
          ? 'Transform rules need attention'
          : 'Add at least one output field or transform expression',
      detail:
        transformSampleWarn && samplePolicy.message
          ? samplePolicy.message
          : enrichmentDupes > 0
            ? 'Duplicate output field names in transform rules'
            : undefined,
      stepKey: 'mapping',
    },
    {
      key: 'protection',
      label: 'Data Protection',
      tone: protectionTone,
      summary: incompleteProtectionRows
        ? 'Complete detected field paths for all protection rows'
          : validProtectionIntents.length === 0
          ? 'No data protection intent configured'
          : `${validProtectionIntents.length} field intent${validProtectionIntents.length === 1 ? '' : 's'} — policy, classification, and protection rules deploy together`,
      detail:
        incompleteProtectionRows
          ? 'Each protection row needs a JSONPath starting with $.'
          : protectionPreview.warnings[0] ??
            (validProtectionIntents.some((intent) => protectionActionNeedsFieldRule(intent.protectionAction))
              ? 'Field paths resolve against the final runtime event at deploy.'
              : undefined),
      stepKey: 'data_protection',
    },
    {
      key: 'route_processing',
      label: 'Route Processing',
      tone: routeProcessingTone,
      summary: routeProcessingOk
        ? `${routeProcessingSummary.enabledRoutes} enabled route${routeProcessingSummary.enabledRoutes === 1 ? '' : 's'} · ${routeProcessingSummary.totalRoutes} total · Transform: ${routeProcessingSummary.transformLabel} · Protection: ${routeProcessingSummary.protectionLabel}`
        : routeProcessingWarn
          ? 'Route processing needs attention — review transform, protection, or enabled routes'
          : 'Add at least one enabled delivery path and configure stream transform',
      detail:
        routeProcessingSummary.enabledRoutes === 0 && routeProcessingSummary.totalRoutes > 0
          ? 'Enable at least one route before deploying.'
          : undefined,
      stepKey: 'mapping',
    },
    {
      key: 'delivery',
      label: 'Delivery',
      tone: deliveryTone,
      summary: deliveryOk
        ? `${enabledRoutes} enabled delivery path${enabledRoutes === 1 ? '' : 's'} · connectivity verified`
        : deliveryWarn
          ? `${WIZARD_LABEL.deliveryPaths} configured — verify connectivity or enable paths`
          : `Add at least one enabled ${WIZARD_LABEL.deliveryPath.toLowerCase()}`,
      detail: connectivity.failed
        ? 'One or more destinations reported a failed connectivity test.'
        : connectivity.unknown && routeDrafts.length > 0
          ? 'Run Test from Destinations to verify connectivity.'
          : enabledRoutes === 0 && routeDrafts.length > 0
            ? `Enable at least one ${WIZARD_LABEL.deliveryPath.toLowerCase()} before deploying.`
            : undefined,
      stepKey: 'destinations',
    },
  ]

  const hasError = categories.some((c) => c.tone === 'err')
  const hasWarn = categories.some((c) => c.tone === 'warn')
  const canCreate = reviewReady && !hasError

  let status: DeployReadinessStatus
  if (!canCreate) {
    status = 'needs_attention'
  } else if (hasWarn) {
    status = 'ready_with_warnings'
  } else {
    status = 'ready'
  }

  return {
    status,
    statusLabel: DEPLOY_STATUS_LABEL[status],
    canCreate,
    categories,
  }
}
