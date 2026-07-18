import { describe, expect, it } from 'vitest'
import type { HealthFactor } from '../api/types/gdcApi'
import {
  formatDeliveryResultLabel,
  formatExecutionStatusLabel,
  formatFactorsTooltip,
  formatHealthLevelLabel,
  formatMaintenancePanelHealthLabel,
  formatOverallHealthBeaconLabel,
  formatStreamRuntimeStatusLabel,
  formatUserHealthLabel,
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
    expect(healthLevelToStatusTone(null)).toBe('neutral')
    expect(healthLevelToStatusTone(undefined)).toBe('neutral')
  })

  it('formats health level labels for operator UI (unified vocabulary)', () => {
    expect(formatHealthLevelLabel('HEALTHY')).toBe('Healthy')
    expect(formatHealthLevelLabel('healthy')).toBe('Healthy')
    expect(formatHealthLevelLabel('DEGRADED')).toBe('Warning')
    expect(formatHealthLevelLabel('warning')).toBe('Warning')
    expect(formatHealthLevelLabel('WARNING')).toBe('Warning')
    expect(formatHealthLevelLabel('UNHEALTHY')).toBe('Critical')
    expect(formatHealthLevelLabel('ERROR')).toBe('Critical')
    expect(formatHealthLevelLabel('error')).toBe('Critical')
    expect(formatHealthLevelLabel('CRITICAL')).toBe('Critical')
    expect(formatHealthLevelLabel('critical')).toBe('Critical')
    expect(formatHealthLevelLabel('unknown')).toBe('Unknown')
    expect(formatHealthLevelLabel('UNKNOWN')).toBe('Unknown')
    expect(formatHealthLevelLabel(null)).toBe('Unknown')
    expect(formatHealthLevelLabel(undefined)).toBe('Unknown')
    expect(formatHealthLevelLabel('')).toBe('Unknown')
  })

  it('never returns raw enum strings for user health labels', () => {
    for (const raw of ['HEALTHY', 'DEGRADED', 'WARNING', 'ERROR', 'CRITICAL', 'UNHEALTHY', 'UNKNOWN', null, undefined]) {
      const label = formatUserHealthLabel(raw)
      expect(['Healthy', 'Warning', 'Critical', 'Unknown']).toContain(label)
      expect(label === label.toUpperCase() && label.length > 0).toBe(false)
    }
  })

  it('maps overall health beacon raw values', () => {
    expect(formatOverallHealthBeaconLabel('OPERATIONAL')).toBe('Healthy')
    expect(formatOverallHealthBeaconLabel('DEGRADED')).toBe('Warning')
    expect(formatOverallHealthBeaconLabel('INCIDENT')).toBe('Warning')
    expect(formatOverallHealthBeaconLabel('CRITICAL')).toBe('Critical')
  })

  it('formats stream runtime status without mixing Healthy for Running', () => {
    expect(formatStreamRuntimeStatusLabel('RUNNING')).toBe('Running')
    expect(formatStreamRuntimeStatusLabel('STOPPED')).toBe('Stopped')
    expect(formatStreamRuntimeStatusLabel('DEGRADED')).toBe('Warning')
    expect(formatStreamRuntimeStatusLabel('ERROR')).toBe('Critical')
    expect(formatStreamRuntimeStatusLabel('UNKNOWN')).toBe('Unknown')
    expect(formatStreamRuntimeStatusLabel(null)).toBe('Unknown')
  })

  it('formats execution status separately from health', () => {
    expect(formatExecutionStatusLabel('RUNNING')).toBe('Running')
    expect(formatExecutionStatusLabel('STOPPED')).toBe('Stopped')
    expect(formatExecutionStatusLabel('PAUSED')).toBe('Paused')
    expect(formatExecutionStatusLabel('DISABLED')).toBe('Disabled')
    expect(formatExecutionStatusLabel('STARTING')).toBe('Starting')
    expect(formatExecutionStatusLabel('STOPPING')).toBe('Stopping')
    expect(formatExecutionStatusLabel(null)).toBe('Unknown')
  })

  it('formats delivery results separately from health', () => {
    expect(formatDeliveryResultLabel('SUCCESS')).toBe('Success')
    expect(formatDeliveryResultLabel('FAILED')).toBe('Failed')
    expect(formatDeliveryResultLabel('SKIPPED')).toBe('Skipped')
    expect(formatDeliveryResultLabel('QUARANTINED')).toBe('Quarantined')
    expect(formatDeliveryResultLabel('BLOCKED')).toBe('Blocked')
  })

  it('formats maintenance panel health', () => {
    expect(formatMaintenancePanelHealthLabel('OK')).toBe('Healthy')
    expect(formatMaintenancePanelHealthLabel('WARN')).toBe('Warning')
    expect(formatMaintenancePanelHealthLabel('ERROR')).toBe('Critical')
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

  it('labels connectivity states without raw enums', () => {
    expect(routeConnectivityShortLabel('ERROR')).toBe('Unreachable')
    expect(routeConnectivityShortLabel('DEGRADED')).toBe('Warning')
    expect(routeConnectivityShortLabel('HEALTHY')).toBe('Reachable')
    expect(routeConnectivityShortLabel(null)).toBe('—')
  })
})
