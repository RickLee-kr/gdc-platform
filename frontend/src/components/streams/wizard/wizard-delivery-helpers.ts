import type { WizardRouteDraft } from './wizard-state'

export type DeliveryModeLabel = 'Reliable' | 'Best Effort'

export function deliveryModeFromFailurePolicy(policy: string | null | undefined): DeliveryModeLabel {
  const p = (policy ?? '').trim()
  if (p === 'LOG_AND_CONTINUE') return 'Best Effort'
  return 'Reliable'
}

/** Short operational label for failure handling (maps to backend enum). */
export function failurePolicyBehaviorLabel(policy: string | null | undefined): string {
  const p = (policy ?? '').trim()
  switch (p) {
    case 'RETRY_AND_BACKOFF':
      return 'Retry'
    case 'LOG_AND_CONTINUE':
      return 'Drop'
    case 'PAUSE_STREAM_ON_FAILURE':
      return 'Pause stream'
    case 'DISABLE_ROUTE_ON_FAILURE':
      return 'Disable route'
    default:
      return p || '—'
  }
}

export function formatWizardSyslogLabel(kind: string): string {
  const k = kind.toUpperCase()
  if (k === 'SYSLOG_TCP') return 'Syslog TCP'
  if (k === 'SYSLOG_UDP') return 'Syslog UDP'
  if (k === 'SYSLOG_TLS') return 'Syslog TLS'
  if (k === 'WEBHOOK_POST') return 'Webhook POST'
  return kind || 'Destination'
}

/** Display string for formatter column — aligns with destination adapter output style. */
export function formatWizardFormatterSummary(destinationType: string | undefined): string {
  const k = String(destinationType ?? '').toUpperCase()
  if (k === 'WEBHOOK_POST') return 'JSON'
  if (k.startsWith('SYSLOG')) return 'JSON @ RFC5424'
  return 'JSON'
}

export function formatWizardRateLimitDraft(rateLimitJson: Record<string, unknown> | undefined): string {
  if (!rateLimitJson || typeof rateLimitJson !== 'object') return 'Not set (destination default)'
  const ps = rateLimitJson.per_second
  const burst = rateLimitJson.burst_size
  if (typeof ps === 'number' && typeof burst === 'number') return `${ps} EPS, Burst: ${burst}`
  if (typeof ps === 'number') return `${ps} EPS`
  return 'Not set (destination default)'
}

export type DestinationLibraryTab = 'all' | 'syslog' | 'webhook' | 'other'

export function destinationLibraryTab(kind: string): Exclude<DestinationLibraryTab, 'all'> {
  const k = kind.toUpperCase()
  if (k.startsWith('SYSLOG')) return 'syslog'
  if (k === 'WEBHOOK_POST') return 'webhook'
  return 'other'
}

export function duplicateRouteDraft(drafts: WizardRouteDraft[], key: string): WizardRouteDraft[] {
  const idx = drafts.findIndex((d) => d.key === key)
  if (idx < 0) return drafts
  const src = drafts[idx]
  const copy: WizardRouteDraft = {
    ...src,
    key: `wr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    rateLimitJson: { ...src.rateLimitJson },
  }
  const next = drafts.slice()
  next.splice(idx + 1, 0, copy)
  return next
}
