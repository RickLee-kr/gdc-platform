import { putStreamGovernance, type StreamGovernanceDocument } from '../../../api/gdcStreamGovernance'
import { inferWizardSensitivityClass } from './wizard-data-protection-fields'
import { normalizeWizardDetectedField } from './wizard-data-protection-fields'
import {
  wizardDataProtectionIntentReady,
  type WizardDataProtectionState,
  type WizardRouteDraft,
  type WizardRouteProtectionOverride,
  type WizardState,
} from './wizard-state'

export type RouteDraftKeyToIdMap = Map<string, number>

export type GovernancePersistResult = {
  saved: boolean
  errors: string[]
  warnings: string[]
}

export function buildRouteDraftKeyToIdMap(
  routeDrafts: readonly WizardRouteDraft[],
  routeIds: readonly number[],
): RouteDraftKeyToIdMap {
  const map = new Map<string, number>()
  routeDrafts.forEach((draft, index) => {
    const routeId = routeIds[index]
    if (typeof routeId === 'number' && Number.isFinite(routeId)) {
      map.set(draft.key, routeId)
    }
  })
  return map
}

function normalizeOverrideFieldPath(path: string): string {
  const normalized = normalizeWizardDetectedField(path)
  return normalized || path.trim()
}

export function isDuplicateRouteOverride(
  overrides: readonly WizardRouteProtectionOverride[],
  fieldPath: string,
  routeDraftKey: string,
  excludeKey?: string,
): boolean {
  const normalizedField = normalizeOverrideFieldPath(fieldPath)
  return overrides.some(
    (o) =>
      o.key !== excludeKey &&
      normalizeOverrideFieldPath(o.fieldPath) === normalizedField &&
      o.routeDraftKey === routeDraftKey,
  )
}

export function buildStreamGovernancePayload(
  dataProtection: WizardDataProtectionState,
  routeDraftKeyToId: RouteDraftKeyToIdMap,
): StreamGovernanceDocument {
  const validIntents = dataProtection.intents.filter(wizardDataProtectionIntentReady)

  const rules = validIntents.map((intent) => {
    const fieldPath = normalizeOverrideFieldPath(intent.detectedField)
    return {
      field_path: fieldPath,
      sensitivity_type: inferWizardSensitivityClass(fieldPath),
      default_protection_action: intent.protectionAction,
      default_delivery_behavior: intent.deliveryBehavior,
      enabled: true,
    }
  })

  const route_overrides = dataProtection.routeOverrides
    .filter((o) => o.enabled)
    .map((override) => {
      const routeId = routeDraftKeyToId.get(override.routeDraftKey)
      if (routeId == null) return null
      return {
        field_path: normalizeOverrideFieldPath(override.fieldPath),
        route_id: routeId,
        protection_action: override.protectionAction,
        delivery_behavior: override.deliveryBehavior,
        enabled: true,
      }
    })
    .filter((o): o is NonNullable<typeof o> => o != null)

  return {
    enabled: validIntents.length > 0 || route_overrides.length > 0,
    rules,
    route_overrides,
  }
}

export function governancePayloadHasContent(payload: StreamGovernanceDocument): boolean {
  return payload.rules.length > 0 || payload.route_overrides.length > 0
}

export async function persistWizardStreamGovernance(
  streamId: number,
  state: WizardState,
  routeIds: readonly number[],
): Promise<GovernancePersistResult> {
  const routeDraftKeyToId = buildRouteDraftKeyToIdMap(state.destinations.routeDrafts, routeIds)
  const payload = buildStreamGovernancePayload(state.dataProtection, routeDraftKeyToId)

  if (!governancePayloadHasContent(payload)) {
    return { saved: true, errors: [], warnings: [] }
  }

  const warnings: string[] = []
  const skippedOverrides = state.dataProtection.routeOverrides.filter(
    (o) => o.enabled && !routeDraftKeyToId.has(o.routeDraftKey),
  )
  if (skippedOverrides.length > 0) {
    warnings.push(
      `${skippedOverrides.length} route override(s) skipped — route was not created.`,
    )
  }

  try {
    await putStreamGovernance(streamId, payload)
    return { saved: true, errors: [], warnings }
  } catch (err) {
    return {
      saved: false,
      errors: [`governance: ${err instanceof Error ? err.message : String(err)}`],
      warnings,
    }
  }
}
