export type ProtectionRuleOrigin = 'Operator' | 'Wizard'

/** DB protection rules only — runtime Auto Protect ephemeral rules are excluded. */
export function protectionRuleOrigin(sourceFindingId: number | null | undefined): ProtectionRuleOrigin {
  return sourceFindingId != null ? 'Operator' : 'Wizard'
}
