import type { RouteClassificationEffective } from '../api/gdcRouteClassification'
import type { RoutePolicyEffective } from '../api/gdcRoutePolicy'
import type { RouteProtectionEffective } from '../api/gdcRouteProtection'
import type { RouteTransformEffective } from '../api/gdcRouteTransform'

export type GovernanceProcessingStatus = 'Inherited' | 'Overridden' | 'Mixed'

export type RouteGovernanceSnapshot = {
  routeId: number
  routeName: string
  transform: GovernanceProcessingStatus | null
  protection: GovernanceProcessingStatus | null
  classification: GovernanceProcessingStatus | null
  policy: GovernanceProcessingStatus | null
  transformEffective: RouteTransformEffective | null
  protectionEffective: RouteProtectionEffective | null
  classificationEffective: RouteClassificationEffective | null
  policyEffective: RoutePolicyEffective | null
}

export type GovernanceDimensionSummary = {
  streamRulesCount: number
  routeOverrideCount: number
}

export type StreamGovernanceSummary = {
  protection: GovernanceDimensionSummary
  classification: GovernanceDimensionSummary
  policy: GovernanceDimensionSummary
  transform: GovernanceDimensionSummary
  routes: {
    routeCount: number
    overriddenRoutesCount: number
  }
}

function isOverriddenStatus(status: GovernanceProcessingStatus | null): boolean {
  return status === 'Overridden' || status === 'Mixed'
}

function streamRuleCountFromInherited(
  routes: readonly RouteGovernanceSnapshot[],
  field: 'protection' | 'classification' | 'policy',
): number {
  const inherited = routes.find((route) => route[field] === 'Inherited')
  if (!inherited) return 0
  const effectiveKey =
    field === 'protection' ? 'protectionEffective' : field === 'classification' ? 'classificationEffective' : 'policyEffective'
  return inherited[effectiveKey]?.rule_count ?? 0
}

function streamTransformRuleCount(routes: readonly RouteGovernanceSnapshot[]): number {
  const inherited = routes.find((route) => route.transform === 'Inherited')
  if (!inherited?.transformEffective) return 0
  return inherited.transformEffective.mapping_count + inherited.transformEffective.enrichment_count
}

function routeOverrideCount(
  routes: readonly RouteGovernanceSnapshot[],
  field: 'transform' | 'protection' | 'classification' | 'policy',
): number {
  return routes.filter((route) => isOverriddenStatus(route[field])).length
}

function overriddenRoutesCount(routes: readonly RouteGovernanceSnapshot[]): number {
  return routes.filter(
    (route) =>
      isOverriddenStatus(route.transform) ||
      isOverriddenStatus(route.protection) ||
      isOverriddenStatus(route.classification) ||
      isOverriddenStatus(route.policy),
  ).length
}

export function buildStreamGovernanceSummary(routes: readonly RouteGovernanceSnapshot[]): StreamGovernanceSummary {
  return {
    protection: {
      streamRulesCount: streamRuleCountFromInherited(routes, 'protection'),
      routeOverrideCount: routeOverrideCount(routes, 'protection'),
    },
    classification: {
      streamRulesCount: streamRuleCountFromInherited(routes, 'classification'),
      routeOverrideCount: routeOverrideCount(routes, 'classification'),
    },
    policy: {
      streamRulesCount: streamRuleCountFromInherited(routes, 'policy'),
      routeOverrideCount: routeOverrideCount(routes, 'policy'),
    },
    transform: {
      streamRulesCount: streamTransformRuleCount(routes),
      routeOverrideCount: routeOverrideCount(routes, 'transform'),
    },
    routes: {
      routeCount: routes.length,
      overriddenRoutesCount: overriddenRoutesCount(routes),
    },
  }
}
