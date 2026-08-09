import { GDC_DEFAULT_READ_JSON_TIMEOUT_MS, safeRequestJson } from '../api'
import type { RouteClassificationEffective } from './gdcRouteClassification'
import type { RoutePolicyEffective } from './gdcRoutePolicy'
import type { RouteProtectionEffective } from './gdcRouteProtection'
import type { RouteTransformEffective } from './gdcRouteTransform'
import { GDC_API_PREFIX } from './gdcApiPrefix'
import { readJsonWithSignal, type GdcSignalOptions } from './gdcSignalOptions'

const RT = `${GDC_API_PREFIX}/runtime`

const readJsonOpts = { timeoutMs: GDC_DEFAULT_READ_JSON_TIMEOUT_MS }

export type GovernanceWorkspaceRouteSnapshot = {
  route_id: number
  route_name: string
  transform: RouteTransformEffective
  protection: RouteProtectionEffective
  classification: RouteClassificationEffective
  policy: RoutePolicyEffective
}

export type GovernanceWorkspaceSnapshot = {
  stream_id: number
  route_count: number
  routes: GovernanceWorkspaceRouteSnapshot[]
}

/** Stream-scoped bulk effective governance for Governance Workspace (replaces 4×R fan-out). */
export async function fetchGovernanceWorkspaceSnapshot(
  streamId: number,
  options?: GdcSignalOptions,
): Promise<GovernanceWorkspaceSnapshot | null> {
  return safeRequestJson<GovernanceWorkspaceSnapshot>(
    `${RT}/streams/${streamId}/governance/workspace-snapshot`,
    readJsonWithSignal(readJsonOpts, options?.signal),
  )
}
