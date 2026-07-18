import type { HealthFactor, HealthLevel } from '../api/types/gdcApi'
import type { StatusTone } from '../components/shell/status-badge'

/** User-facing Health vocabulary (presentation only — do not change API enums). */
export type UserHealthLabel = 'Healthy' | 'Warning' | 'Critical' | 'Unknown'

/** User-facing execution / scheduler status (kept separate from Health). */
export type UserExecutionStatusLabel =
  | 'Running'
  | 'Stopped'
  | 'Paused'
  | 'Disabled'
  | 'Starting'
  | 'Stopping'
  | 'Unknown'

/** User-facing delivery outcome labels (kept separate from Health). */
export type UserDeliveryResultLabel = 'Success' | 'Failed' | 'Skipped' | 'Quarantined' | 'Blocked'

const FACTOR_TAG: Record<string, string> = {
  failure_rate: 'High failure rate',
  retry_rate: 'Retry-heavy',
  inactivity: 'No success in window',
  repeated_failures: 'Repeated failures',
  rate_limit_pressure: 'Rate limited',
  latency_p95: 'Latency tail',
}

/**
 * Normalize any health-like raw API / beacon value to the product Health label.
 * Never returns raw enum strings (HEALTHY, DEGRADED, UNHEALTHY, …).
 */
export function formatUserHealthLabel(raw: string | null | undefined): UserHealthLabel {
  const u = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
  if (!u) return 'Unknown'
  if (
    u === 'HEALTHY' ||
    u === 'OK' ||
    u === 'OPERATIONAL' ||
    u === 'SUCCESS' ||
    u === 'PASS' ||
    u === 'PASSED'
  ) {
    return 'Healthy'
  }
  // Idle / no-activity is not a failure signal — do not present as Warning or Healthy.
  if (u === 'IDLE') return 'Unknown'
  if (
    u === 'DEGRADED' ||
    u === 'WARNING' ||
    u === 'WARN' ||
    u === 'RATE_LIMITED' ||
    u === 'RATE_LIMITED_SOURCE' ||
    u === 'RATE_LIMITED_DESTINATION' ||
    u === 'INCIDENT'
  ) {
    return 'Warning'
  }
  if (u === 'ERROR' || u === 'UNHEALTHY' || u === 'CRITICAL' || u === 'FAILING' || u === 'FAILED') {
    return 'Critical'
  }
  if (u === 'UNKNOWN' || u === 'N_A' || u === 'NA' || u === 'NONE') return 'Unknown'
  return 'Unknown'
}

/** Title-case operator label for score-based HealthLevel (matches snapshot vocabulary). */
export function formatHealthLevelLabel(level: HealthLevel | string | null | undefined): UserHealthLabel {
  return formatUserHealthLabel(level)
}

export function healthLevelToStatusTone(level: HealthLevel | string | null | undefined): StatusTone {
  const label = formatUserHealthLabel(level)
  if (label === 'Healthy') return 'success'
  if (label === 'Warning') return 'warning'
  if (label === 'Critical') return 'error'
  return 'neutral'
}

/** Overall dashboard / streams beacon raw → user Health label. */
export function formatOverallHealthBeaconLabel(
  raw: 'OPERATIONAL' | 'DEGRADED' | 'INCIDENT' | 'CRITICAL' | string | null | undefined,
): UserHealthLabel {
  return formatUserHealthLabel(raw)
}

/**
 * Mixed StreamRuntimeStatus vocabulary (RUNNING/STOPPED + DEGRADED/ERROR).
 * Presents execution labels for run state and Health labels for health-like values.
 */
export function formatStreamRuntimeStatusLabel(raw: string | null | undefined): string {
  const u = String(raw ?? '').trim().toUpperCase()
  if (u === 'RUNNING' || u === 'ACTIVE') return 'Running'
  if (u === 'STOPPED' || u === 'STOP' || u === 'INACTIVE') return 'Stopped'
  if (u === 'PAUSED' || u === 'PAUSE') return 'Paused'
  if (u === 'DISABLED') return 'Disabled'
  if (u === 'STARTING') return 'Starting'
  if (u === 'STOPPING') return 'Stopping'
  if (u === 'DEGRADED') return 'Warning'
  if (u === 'ERROR' || u === 'UNHEALTHY' || u === 'CRITICAL') return 'Critical'
  if (u === 'HEALTHY') return 'Healthy'
  return 'Unknown'
}

export function formatExecutionStatusLabel(raw: string | null | undefined): UserExecutionStatusLabel {
  const u = String(raw ?? '').trim().toUpperCase()
  if (u === 'RUNNING' || u === 'ACTIVE') return 'Running'
  if (u === 'STOPPED' || u === 'STOP' || u === 'INACTIVE') return 'Stopped'
  if (u === 'PAUSED' || u === 'PAUSE') return 'Paused'
  if (u === 'DISABLED') return 'Disabled'
  if (u === 'STARTING') return 'Starting'
  if (u === 'STOPPING') return 'Stopping'
  return 'Unknown'
}

export function formatDeliveryResultLabel(raw: string | null | undefined): UserDeliveryResultLabel | 'Unknown' {
  const u = String(raw ?? '').trim().toUpperCase()
  if (u === 'SUCCESS' || u === 'OK' || u === 'DELIVERED') return 'Success'
  if (u === 'FAILED' || u === 'FAIL' || u === 'ERROR' || u === 'FAILURE') return 'Failed'
  if (u === 'SKIPPED' || u === 'SKIP') return 'Skipped'
  if (u === 'QUARANTINED' || u === 'QUARANTINE') return 'Quarantined'
  if (u === 'BLOCKED' || u === 'BLOCK') return 'Blocked'
  return 'Unknown'
}

/** Admin maintenance panel status (OK / WARN / ERROR). */
export function formatMaintenancePanelHealthLabel(raw: string | null | undefined): UserHealthLabel {
  return formatUserHealthLabel(raw)
}

/** Short operator-facing tags derived from deterministic health factors (spec 012). */
export function operationalFactorTags(factors: HealthFactor[] | null | undefined, maxTags = 3): string[] {
  if (!factors?.length) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const f of factors) {
    const code = String(f.code ?? '').trim()
    if (!code || seen.has(code)) continue
    seen.add(code)
    const label = (FACTOR_TAG[code] ?? String(f.label ?? code).trim()) || code
    out.push(label)
    if (out.length >= maxTags) break
  }
  return out
}

export function formatFactorsTooltip(factors: HealthFactor[] | null | undefined): string {
  if (!factors?.length) return ''
  return factors
    .map((f) => {
      const detail = f.detail?.trim()
      return detail ? `${f.label} — ${detail}` : f.label
    })
    .join('\n')
}

/** Route connectivity is not Health; keep Reachable / Warning / Unreachable / Disabled. */
export function routeConnectivityShortLabel(state: string | null | undefined): string {
  const u = String(state ?? '').trim().toUpperCase()
  if (u === 'ERROR') return 'Unreachable'
  if (u === 'DEGRADED') return 'Warning'
  if (u === 'HEALTHY') return 'Reachable'
  if (u === 'DISABLED') return 'Disabled'
  if (!u) return '—'
  return formatUserHealthLabel(u)
}
