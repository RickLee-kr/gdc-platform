import { protectionActionLabel, deliveryBehaviorLabel } from './wizard-data-protection-summary'
import type { WizardDataProtectionState, WizardRouteDraft } from './wizard-state'

export type RouteProtectionOverrideReviewRow = {
  fieldPath: string
  routeLabel: string
  protectionAction: string
  deliveryBehavior: string
}

export function routeProtectionOverrideReviewRows(
  dataProtection: Pick<WizardDataProtectionState, 'routeOverrides'>,
  routeDrafts: readonly WizardRouteDraft[],
  destinationLabelsByDraftKey: ReadonlyMap<string, string>,
): RouteProtectionOverrideReviewRow[] {
  const draftByKey = new Map(routeDrafts.map((d) => [d.key, d]))
  return dataProtection.routeOverrides
    .filter((o) => o.enabled)
    .map((override) => {
      const draft = draftByKey.get(override.routeDraftKey)
      const destLabel =
        destinationLabelsByDraftKey.get(override.routeDraftKey) ??
        (draft ? `Destination #${draft.destinationId}` : override.routeDraftKey)
      return {
        fieldPath: override.fieldPath,
        routeLabel: destLabel,
        protectionAction: protectionActionLabel(override.protectionAction),
        deliveryBehavior: deliveryBehaviorLabel(override.deliveryBehavior),
      }
    })
}

export function routeProtectionOverridesGroupedByField(
  rows: readonly RouteProtectionOverrideReviewRow[],
): Map<string, RouteProtectionOverrideReviewRow[]> {
  const grouped = new Map<string, RouteProtectionOverrideReviewRow[]>()
  for (const row of rows) {
    const existing = grouped.get(row.fieldPath) ?? []
    existing.push(row)
    grouped.set(row.fieldPath, existing)
  }
  return grouped
}

export function countRouteProtectionOverridesForDraft(
  dataProtection: Pick<WizardDataProtectionState, 'routeOverrides'>,
  routeDraftKey: string,
): number {
  return dataProtection.routeOverrides.filter(
    (o) => o.enabled && o.routeDraftKey === routeDraftKey,
  ).length
}

export function routeDraftHasProtectionOverrides(
  dataProtection: Pick<WizardDataProtectionState, 'routeOverrides'>,
  routeDraftKey: string,
): boolean {
  return countRouteProtectionOverridesForDraft(dataProtection, routeDraftKey) > 0
}
