import { describe, expect, it } from 'vitest'
import type { HealthFactor } from '../api/types/gdcApi'
import {
  formatFactorsTooltip,
  healthLevelToStatusTone,
  operationalFactorTags,
  routeConnectivityShortLabel,
} from './operational-health-present'

describe('operational-health-present', () => {
  it('maps health levels to status tones', () => {
    expect(healthLevelToStatusTone('HEALTHY')).toBe('success')
    expect(healthLevelToStatusTone('DEGRADED')).toBe('warning')
    expect(healthLevelToStatusTone('UNHEALTHY')).toBe('error')
    expect(healthLevelToStatusTone('CRITICAL')).toBe('error')
  })

  it('dedupes factor codes and caps tags', () => {
    const factors: HealthFactor[] = [
      { code: 'failure_rate', label: 'Failure rate >= 10%', delta: -20, detail: 'x' },
      { code: 'failure_rate', label: 'dup', delta: 0, detail: null },
      { code: 'retry_rate', label: 'Retry rate >= 10%', delta: -5, detail: null },
      { code: 'inactivity', label: 'No successful deliveries', delta: -25, detail: null },
    ]
    expect(operationalFactorTags(factors, 2)).toEqual(['High failure rate', 'Retry-heavy'])
  })

  it('formats tooltip lines', () => {
    const factors: HealthFactor[] = [{ code: 'x', label: 'A', delta: 0, detail: 'detail' }]
    expect(formatFactorsTooltip(factors)).toBe('A — detail')
  })

  it('labels connectivity states', () => {
    expect(routeConnectivityShortLabel('ERROR')).toBe('Unreachable')
    expect(routeConnectivityShortLabel('DEGRADED')).toBe('Degraded')
    expect(routeConnectivityShortLabel(null)).toBe('—')
  })
})
