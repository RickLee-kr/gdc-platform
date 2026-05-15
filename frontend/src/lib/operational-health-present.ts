import type { HealthFactor, HealthLevel } from '../api/types/gdcApi'
import type { StatusTone } from '../components/shell/status-badge'

const FACTOR_TAG: Record<string, string> = {
  failure_rate: 'High failure rate',
  retry_rate: 'Retry-heavy',
  inactivity: 'No success in window',
  repeated_failures: 'Repeated failures',
  rate_limit_pressure: 'Rate limited',
  latency_p95: 'Latency tail',
}

export function healthLevelToStatusTone(level: HealthLevel): StatusTone {
  if (level === 'HEALTHY') return 'success'
  if (level === 'DEGRADED') return 'warning'
  return 'error'
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

export function routeConnectivityShortLabel(state: string | null | undefined): string {
  const u = String(state ?? '').trim().toUpperCase()
  if (u === 'ERROR') return 'Unreachable'
  if (u === 'DEGRADED') return 'Degraded'
  if (u === 'HEALTHY') return 'Reachable'
  if (u === 'DISABLED') return 'Disabled'
  return u ? u.replace(/_/g, ' ') : '—'
}
