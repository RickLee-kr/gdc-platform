import { describe, expect, it } from 'vitest'
import {
  formatAutoProtectActivityTime,
  parseAutoProtectActivityFromLog,
  parseAutoProtectActivityLogs,
} from './auto-protect-activity'
import type { RuntimeLogSearchItem } from '../api/types/gdcApi'

function sampleLog(overrides: Partial<RuntimeLogSearchItem> = {}): RuntimeLogSearchItem {
  return {
    id: 1,
    connector_id: null,
    stream_id: 10,
    route_id: null,
    destination_id: null,
    run_id: null,
    stage: 'schema_drift_policy_auto_protect_applied',
    level: 'INFO',
    status: null,
    message: 'Auto protect applied: $.email (partial_mask)',
    retry_count: 0,
    http_status: null,
    latency_ms: null,
    error_code: null,
    created_at: '2026-06-14T10:32:01.000Z',
    ...overrides,
  }
}

describe('auto-protect-activity', () => {
  it('parses auto protect delivery log message', () => {
    const entry = parseAutoProtectActivityFromLog(sampleLog())
    expect(entry).toEqual({
      id: 1,
      timeIso: '2026-06-14T10:32:01.000Z',
      fieldPath: '$.email',
      protectionMode: 'partial_mask',
    })
  })

  it('ignores non auto protect stages', () => {
    expect(parseAutoProtectActivityFromLog(sampleLog({ stage: 'schema_drift_policy' }))).toBeNull()
  })

  it('parses multiple logs', () => {
    const entries = parseAutoProtectActivityLogs([
      sampleLog({ id: 1, message: 'Auto protect applied: $.email (partial_mask)' }),
      sampleLog({ id: 2, message: 'Auto protect applied: $.api_key (full_mask)' }),
    ])
    expect(entries).toHaveLength(2)
    expect(entries[1]?.fieldPath).toBe('$.api_key')
  })

  it('formats activity time', () => {
    expect(formatAutoProtectActivityTime('2026-06-14T10:32:01.000Z')).toMatch(/\d{2}:\d{2}:\d{2}/)
  })
})
