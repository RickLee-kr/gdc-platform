/**
 * Maps Logs Explorer URL query params (`status`, `stage`) to delivery_logs API filters.
 * Aliases keep drill-down URLs readable (`failed`, `success`, `retry`).
 */

export const STATUS_FILTER_OPTIONS = [
  'All status',
  'Failed',
  'Success',
  'Retry outcomes',
  'Rate limited',
  'Completed',
  'Skipped',
] as const

const KNOWN_STATUSES = new Set(['FAILED', 'OK', 'RATE_LIMITED', 'COMPLETED', 'SKIPPED'])

function isBackendStageToken(raw: string): boolean {
  return /^[a-z][a-z0-9_]*$/i.test(raw) && raw.includes('_')
}

function mapStatusAliasToApi(raw: string): string | undefined {
  const low = raw.trim().toLowerCase()
  const aliases: Record<string, string> = {
    failed: 'FAILED',
    failure: 'FAILED',
    success: 'OK',
    ok: 'OK',
    rate_limited: 'RATE_LIMITED',
    ratelimited: 'RATE_LIMITED',
    completed: 'COMPLETED',
    skipped: 'SKIPPED',
  }
  if (low in aliases) return aliases[low]
  const up = raw.trim().toUpperCase()
  if (KNOWN_STATUSES.has(up)) return up
  return undefined
}

/** Resolve URLSearchParams to API query fields for GET /runtime/logs/page and /logs/search. */
export function resolveDeliveryLogApiFilters(searchParams: URLSearchParams): {
  status?: string
  stage?: string
} {
  const stageRaw = searchParams.get('stage')?.trim()
  let stage: string | undefined
  if (stageRaw && isBackendStageToken(stageRaw)) {
    stage = stageRaw
  }

  const statusRaw = searchParams.get('status')?.trim()
  if (!statusRaw) {
    return { stage }
  }

  const low = statusRaw.toLowerCase()
  if (low === 'retry') {
    return {
      stage: stage ?? 'route_retry_failed',
      status: undefined,
    }
  }

  const mapped = mapStatusAliasToApi(statusRaw)
  return {
    status: mapped,
    stage,
  }
}

/** Active filters chip + dropdown label from current URL. */
export function statusUiLabelFromSearchParams(searchParams: URLSearchParams): string {
  const raw = searchParams.get('status')?.trim()
  if (!raw) return STATUS_FILTER_OPTIONS[0]

  const low = raw.toLowerCase()
  if (low === 'retry') return 'Retry outcomes'
  if (low === 'failed' || low === 'failure' || raw.toUpperCase() === 'FAILED') return 'Failed'
  if (low === 'success' || low === 'ok' || raw.toUpperCase() === 'OK') return 'Success'
  if (low === 'rate_limited' || low === 'ratelimited' || raw.toUpperCase() === 'RATE_LIMITED') return 'Rate limited'
  if (low === 'completed' || raw.toUpperCase() === 'COMPLETED') return 'Completed'
  if (low === 'skipped' || raw.toUpperCase() === 'SKIPPED') return 'Skipped'

  const mapped = mapStatusAliasToApi(raw)
  if (mapped === 'FAILED') return 'Failed'
  if (mapped === 'OK') return 'Success'
  if (mapped === 'RATE_LIMITED') return 'Rate limited'
  if (mapped === 'COMPLETED') return 'Completed'
  if (mapped === 'SKIPPED') return 'Skipped'
  return STATUS_FILTER_OPTIONS[0]
}

/** Maps dropdown label to `status` query value (aliases). Undefined = omit param. */
export function statusUrlParamFromUiLabel(label: string): string | undefined {
  switch (label) {
    case 'All status':
      return undefined
    case 'Failed':
      return 'failed'
    case 'Success':
      return 'success'
    case 'Retry outcomes':
      return 'retry'
    case 'Rate limited':
      return 'rate_limited'
    case 'Completed':
      return 'completed'
    case 'Skipped':
      return 'skipped'
    default:
      return undefined
  }
}
