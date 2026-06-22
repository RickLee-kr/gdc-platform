import type { RouteProcessingStatus, WizardRouteDraft } from '../wizard/wizard-state'

export const ROUTE_PROCESSING_CONCERN_KEYS = [
  'transform',
  'protection',
  'classification',
  'policy',
] as const

export type RouteProcessingConcernKey = (typeof ROUTE_PROCESSING_CONCERN_KEYS)[number]

export const ROUTE_PROCESSING_CONCERN_LABEL: Record<RouteProcessingConcernKey, string> = {
  transform: 'Transform',
  protection: 'Protection',
  classification: 'Classification',
  policy: 'Policy',
}

export const ROUTE_PROCESSING_CARD_CONCERNS = [
  ...ROUTE_PROCESSING_CONCERN_KEYS,
  'delivery',
] as const

export type RouteProcessingCardConcern = (typeof ROUTE_PROCESSING_CARD_CONCERNS)[number]

export const ROUTE_PROCESSING_CARD_CONCERN_LABEL: Record<RouteProcessingCardConcern, string> = {
  ...ROUTE_PROCESSING_CONCERN_LABEL,
  delivery: 'Delivery',
}

export type RouteProcessingDeployMode = 'shared' | 'override'

export const ROUTE_PROCESSING_COPY = {
  noRoutes: 'No routes configured.',
  noRoutesHint: 'Select a destination to create route processing.',
  destinationMissing: 'Destination missing.',
  destinationMissingHint: 'This route needs a destination before deploy.',
  allInherited: 'All processing is inherited from Shared Processing.',
  routeUsesShared: 'This route uses Shared Processing for Transform, Protection, Classification, and Policy.',
  routeUsesSharedHint: 'Configure delivery settings below, or switch to Override for route-specific processing.',
  selectRouteDetail: 'Select a route to view processing details.',
  selectRouteConfigure: 'Select a route to configure processing overrides.',
  routeDetailTitle: 'Route Detail',
} as const

export function routeDraftUsesSharedProcessing(draft: Pick<WizardRouteDraft, 'inherit'>): boolean {
  return (
    draft.inherit.transform &&
    draft.inherit.protection &&
    draft.inherit.classification &&
    draft.inherit.policy
  )
}

export function routeProcessingStatusDisplayLabel(status: RouteProcessingStatus): string {
  switch (status) {
    case 'Inherited':
      return 'Shared'
    case 'Overridden':
      return 'Override'
    case 'Mixed':
      return 'Mixed'
    default:
      return status
  }
}

export function routeProcessingDeployModeLabel(mode: RouteProcessingDeployMode): string {
  return mode === 'shared' ? 'Shared' : 'Override'
}

export function routeDeployReadinessLabel(status: 'ready' | 'warning' | 'error'): string {
  switch (status) {
    case 'ready':
      return 'Ready'
    case 'warning':
      return 'Warning'
    case 'error':
      return 'Needs Attention'
  }
}
