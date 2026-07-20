import type { TransformConfig } from './transform.js'
import type { GovernancePolicy } from './governance.js'

export type RouteDefinition = {
  route_key: string
  destination_type: string
  transform_override?: TransformConfig | null
  protection_override?: GovernancePolicy['protection']
  policy?: 'continue' | 'block'
}

export type EffectiveRoute = {
  route_key: string
  destination_type: string
  transform: TransformConfig
  governance: GovernancePolicy
  policy: 'continue' | 'block'
  override_applied: boolean
}

export function mergeRouteConfig(
  globalTransform: TransformConfig,
  globalGov: GovernancePolicy,
  route: RouteDefinition,
): EffectiveRoute {
  const override_applied = Boolean(
    route.transform_override || route.protection_override || route.policy === 'block',
  )
  const transform: TransformConfig = {
    ...globalTransform,
    ...(route.transform_override || {}),
  }
  const governance: GovernancePolicy = {
    ...globalGov,
    ...(route.protection_override ? { protection: route.protection_override } : {}),
  }
  return {
    route_key: route.route_key,
    destination_type: route.destination_type,
    transform,
    governance,
    policy: route.policy || 'continue',
    override_applied,
  }
}
