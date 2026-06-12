import type { StreamRuntimeStatus } from '../api/streamRows'

/** Shared issue-rail context for console rows and runtime detail pages. */
export type StreamIssueContext = {
  id: string
  status: StreamRuntimeStatus
  connectorName: string
  connectorProductGroup?: string | null
  deliveryPctKnown: boolean
  deliveryPct: number
  routesError: number
  lastActivityRelative: string
  recentErrors: ReadonlyArray<{ message: string }>
}

export function issueWhatHappenedSummary(
  ctx: StreamIssueContext,
  headline?: StreamHeroHeadline,
): string {
  const h =
    headline ??
    deriveStreamHeroHeadline(ctx.status, ctx.routesError, ctx.deliveryPctKnown, ctx.deliveryPct)
  if (ctx.recentErrors[0]?.message) return ctx.recentErrors[0].message
  if (h === 'Stream Healthy') return 'Stream is operating normally with no active delivery issues.'
  if (h === 'Stream Stopped') return 'Stream is stopped — scheduled delivery is not running.'
  if (h === 'Delivery Failures Detected') return 'One or more delivery paths reported failures.'
  if (h === 'Delivery Delayed') return 'Delivery success rate or latency is below the healthy threshold.'
  if (h === 'Protection Violations Detected') return 'Data protection policies flagged events on this stream.'
  return `Stream status is ${ctx.status}.`
}

export function issueWhySummary(ctx: StreamIssueContext): string {
  const err = ctx.recentErrors[0]
  if (err?.message) return err.message
  if (ctx.status === 'ERROR') return 'Delivery failures or source errors were detected for this stream.'
  if (ctx.status === 'DEGRADED') return 'Delivery success rate or latency is below the healthy threshold.'
  if (ctx.routesError > 0) return `${ctx.routesError} delivery path${ctx.routesError === 1 ? '' : 's'} reporting errors.`
  return 'No active issues — stream is operating normally.'
}

export function issueChipLabel(ctx: StreamIssueContext): string {
  if (ctx.status === 'ERROR') return 'Failed'
  if (ctx.status === 'DEGRADED') return 'Degraded'
  if (ctx.routesError > 0) return 'Delivery path error'
  if (ctx.deliveryPctKnown && ctx.deliveryPct < 90) return 'Low success rate'
  return 'Healthy'
}

export type StreamHeroHeadline =
  | 'Stream Healthy'
  | 'Delivery Delayed'
  | 'Delivery Failures Detected'
  | 'Stream Stopped'
  | 'Protection Violations Detected'

export function deriveStreamHeroHeadline(
  status: StreamRuntimeStatus,
  routesError: number,
  deliveryPctKnown: boolean,
  deliveryPct: number,
  protectionViolations?: boolean,
): StreamHeroHeadline {
  if (protectionViolations) return 'Protection Violations Detected'
  if (status === 'STOPPED') return 'Stream Stopped'
  if (status === 'ERROR' || routesError > 0) return 'Delivery Failures Detected'
  if (status === 'DEGRADED' || (deliveryPctKnown && deliveryPct < 90)) return 'Delivery Delayed'
  return 'Stream Healthy'
}
