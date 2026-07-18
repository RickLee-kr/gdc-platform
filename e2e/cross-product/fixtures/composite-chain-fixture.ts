/**
 * Composite chain fixture: ≥20 baseline events + drift events.
 * Rare fields appear in <30% of baseline events.
 * Transforms touch distinct fields to avoid order ambiguity.
 */
export type FixtureEvent = Record<string, unknown>

const SENSITIVE_VALUE = '4111111111111111'
const RARE_FIELD = 'rare_device_fingerprint'

export function correlationPrefix(combinationId: string, routeKey: string): string {
  return `${combinationId.slice(0, 16)}:${routeKey}`
}

/** Build ≥20 baseline events. Rare field on events 0,7 only (2/20 = 10% < 30%). */
export function buildBaselineEvents(opts: {
  combinationId: string
  count?: number
}): FixtureEvent[] {
  const n = opts.count ?? 20
  const events: FixtureEvent[] = []
  for (let i = 0; i < n; i++) {
    const event_id = `${opts.combinationId}:base:${String(i).padStart(4, '0')}`
    const ev: FixtureEvent = {
      event_id,
      checkpoint_seq: i + 1,
      event_time: `2026-07-01T12:${String(i).padStart(2, '0')}:00Z`,
      known_status: 'ok',
      map_src_host: `host-${i}.lab.local`,
      jsonata_amount: 100 + i,
      regex_message: `CODE=${1000 + i};user=alice`,
      account_number: SENSITIVE_VALUE,
      severity: 'info',
    }
    if (i === 0 || i === 7) {
      ev[RARE_FIELD] = `fp-${i}`
    }
    events.push(ev)
  }
  return events
}

/** Drift fixture: unknown normal/sensitive, add/remove/type-change, transforms, duplicate id. */
export function buildDriftEvents(opts: { combinationId: string }): FixtureEvent[] {
  const baseId = `${opts.combinationId}:drift`
  return [
    {
      event_id: `${baseId}:0001`,
      checkpoint_seq: 101,
      event_time: '2026-07-02T08:00:00Z',
      known_status: 'ok',
      map_src_host: 'drift-host.lab.local',
      jsonata_amount: 999,
      regex_message: 'CODE=9999;user=bob',
      account_number: SENSITIVE_VALUE,
      unknown_normal_field: 'visible-unknown',
      field_added: 'new-value',
      // field_removed: known_status intentionally still present on some; type change below
      severity: 1, // type changed from string → number
    },
    {
      event_id: `${baseId}:0002`,
      checkpoint_seq: 102,
      event_time: '07/02/2026 09:15:30', // timestamp normalization target (non-ISO)
      known_status: 'warn',
      map_src_host: 'ts-host.lab.local',
      jsonata_amount: 42,
      regex_message: 'CODE=4242;user=carol',
      account_number: SENSITIVE_VALUE,
      unknown_sensitive_field: 'ssn:123-45-6789',
      severity: 'info',
    },
    {
      // Duplicate of baseline event_id for dedup assertion
      event_id: `${opts.combinationId}:base:0000`,
      checkpoint_seq: 1,
      event_time: '2026-07-01T12:00:00Z',
      known_status: 'ok',
      map_src_host: 'host-0.lab.local',
      jsonata_amount: 100,
      regex_message: 'CODE=1000;user=alice',
      account_number: SENSITIVE_VALUE,
      severity: 'info',
      duplicate_marker: true,
    },
    {
      event_id: `${baseId}:0003`,
      checkpoint_seq: 103,
      event_time: '2026-07-02T10:00:00Z',
      // known_status removed
      map_src_host: 'removed-field-host.lab.local',
      jsonata_amount: 7,
      regex_message: 'CODE=0007;user=dave',
      account_number: SENSITIVE_VALUE,
      severity: 'info',
      unknown_normal_field: 'another-unknown',
    },
  ]
}

export function wrapHttpPayload(events: FixtureEvent[], profile: 'ROOT_ARRAY' | 'NESTED_DATA_EVENTS'): unknown {
  if (profile === 'NESTED_DATA_EVENTS') {
    return { data: { events } }
  }
  return events
}

export const FIXTURE_FIELD_CONTRACT = {
  event_id: 'event_id',
  checkpoint: 'checkpoint_seq',
  timestamp_source: 'event_time',
  mapping_input: 'map_src_host',
  mapping_output: 'mapped_host',
  jsonata_input: 'jsonata_amount',
  jsonata_output: 'jsonata_total',
  regex_input: 'regex_message',
  regex_output_code: 'regex_code',
  sensitive_known: 'account_number',
  rare_field: RARE_FIELD,
  unknown_normal: 'unknown_normal_field',
  unknown_sensitive: 'unknown_sensitive_field',
  rare_max_ratio: 0.3,
} as const

export function assertRareFieldRatio(events: FixtureEvent[]): void {
  const withRare = events.filter((e) => Object.prototype.hasOwnProperty.call(e, RARE_FIELD)).length
  const ratio = withRare / events.length
  if (ratio >= FIXTURE_FIELD_CONTRACT.rare_max_ratio) {
    throw new Error(`Rare field ratio ${ratio} must be < ${FIXTURE_FIELD_CONTRACT.rare_max_ratio}`)
  }
}
