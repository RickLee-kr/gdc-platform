import type { TabKey } from '../runtimeTypes'
import { buildRuntimeReadinessSummary } from './runtimeReadiness'
import type { PersistedIds } from './runtimeState'

type JsonObject = Record<string, unknown>

function parseJsonObjectSafe(raw: string): JsonObject | null {
  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as JsonObject
    }
  } catch {
    return null
  }
  return null
}

function asObject(value: unknown): JsonObject | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonObject
  }
  return null
}

export type RouteVisualizationSummary = {
  routeEnabled: string
  destinationType: string
  failurePolicy: string
  rateLimitSummary: string
}

export function buildRouteVisualizationSummary(routeConfig: string, destinationConfig: string): RouteVisualizationSummary {
  const routeRoot = parseJsonObjectSafe(routeConfig)
  const destinationRoot = parseJsonObjectSafe(destinationConfig)
  const routeObj = asObject(routeRoot?.route)
  const destinationObj = asObject(destinationRoot?.destination) ?? asObject(routeRoot?.destination)
  const destinationConfigJson = asObject(destinationObj?.config_json)
  const routeRateLimit = asObject(routeObj?.rate_limit_json)
  const destinationRateLimit = asObject(destinationObj?.rate_limit_json)

  const routeEnabledRaw = routeObj?.enabled
  const routeEnabled = typeof routeEnabledRaw === 'boolean' ? (routeEnabledRaw ? 'enabled' : 'disabled') : 'unknown'

  const destinationTypeRaw = destinationConfigJson?.destination_type ?? destinationObj?.destination_type
  const destinationType = typeof destinationTypeRaw === 'string' && destinationTypeRaw.trim() ? destinationTypeRaw : 'unknown'

  const failurePolicyRaw = routeObj?.failure_policy
  const failurePolicy = typeof failurePolicyRaw === 'string' && failurePolicyRaw.trim() ? failurePolicyRaw : 'unknown'

  const routeRateText = routeRateLimit ? JSON.stringify(routeRateLimit) : ''
  const destinationRateText = destinationRateLimit ? JSON.stringify(destinationRateLimit) : ''
  const rateLimitSummary = [routeRateText && `route=${routeRateText}`, destinationRateText && `destination=${destinationRateText}`]
    .filter(Boolean)
    .join(' | ') || 'unknown'

  return {
    routeEnabled,
    destinationType,
    failurePolicy,
    rateLimitSummary,
  }
}

export function buildRouteVisualizationHints(ids: PersistedIds, unsavedByTab: Record<TabKey, string[]>) {
  const summary = buildRuntimeReadinessSummary(ids, unsavedByTab)
  return {
    missingStreamId: !ids.streamId.trim(),
    missingRouteId: !ids.routeId.trim(),
    missingDestinationId: !ids.destinationId.trim(),
    routeDirty: unsavedByTab.route.length > 0,
    destinationDirty: unsavedByTab.destination.length > 0,
    readyForRouteDeliveryPreview: summary.readyForPreview && Boolean(ids.routeId.trim()),
    readyForRuntimeStart: summary.readyForRuntimeStart,
  }
}
