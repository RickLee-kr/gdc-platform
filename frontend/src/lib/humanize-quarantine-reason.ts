/** Canonical quarantine reason labels (aligned with Governance Center). */

function schemaDriftRuntimePolicyLabel(name: string): string | null {
  const raw = String(name ?? '').trim()
  if (!raw.startsWith('schema_drift:')) return null
  const tail = raw.slice('schema_drift:'.length).trim().replace(/_/g, ' ')
  if (tail === 'unknown normal') return 'Schema Drift Policy — Unknown Normal Field'
  if (tail === 'unknown sensitive') return 'Schema Drift Policy — Unknown Sensitive Field'
  if (!tail) return null
  return `Schema Drift Policy — ${tail.replace(/\b\w/g, (c) => c.toUpperCase())}`
}

export type HumanizeQuarantineReasonOptions = {
  quarantineSource?: string | null
}

/** Humanize raw quarantine_reason for operator-facing UI (display only). */
export function humanizeQuarantineReason(
  reason: string,
  options?: HumanizeQuarantineReasonOptions,
): string {
  if (options?.quarantineSource === 'manual') {
    return 'Manual Quarantine'
  }

  const text = String(reason ?? '').trim()
  if (text.startsWith('policy:schema_drift:')) {
    const label = schemaDriftRuntimePolicyLabel(text.slice('policy:'.length))
    if (label) return label
  }
  if (text.startsWith('policy:')) {
    const names = text.slice('policy:'.length).split(',')
    const first = names[0]?.trim()
    if (first) {
      const driftLabel = schemaDriftRuntimePolicyLabel(first)
      if (driftLabel) return driftLabel
      return `Policy Rule — ${first}`
    }
  }
  if (text) return text
  return 'Policy response triggered quarantine'
}
