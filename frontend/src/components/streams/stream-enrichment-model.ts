/** Enrichment workspace types and starter rows for local preview (API save when stream id is numeric). */

export type OverridePolicy = 'missing' | 'always'

export type StaticFieldRow = {
  id: string
  fieldName: string
  value: string
  type: string
  description: string
  overridePolicy: OverridePolicy
}

export type ComputedFieldRow = {
  id: string
  fieldName: string
  expression: string
  type: string
  description: string
}

export const DEFAULT_STATIC_FIELDS: StaticFieldRow[] = [
  {
    id: 'sf1',
    fieldName: 'vendor',
    value: 'Cybereason',
    type: 'string',
    description: 'Security product vendor label',
    overridePolicy: 'missing',
  },
  {
    id: 'sf2',
    fieldName: 'product',
    value: 'EDR',
    type: 'string',
    description: 'Product family',
    overridePolicy: 'missing',
  },
  {
    id: 'sf3',
    fieldName: 'log_type',
    value: 'malop',
    type: 'string',
    description: 'Normalized log category',
    overridePolicy: 'missing',
  },
  {
    id: 'sf4',
    fieldName: 'event_source',
    value: 'cybereason_malop_api',
    type: 'string',
    description: 'Stable stream identifier for routing',
    overridePolicy: 'missing',
  },
  {
    id: 'sf5',
    fieldName: 'collector_name',
    value: 'generic-connector-01',
    type: 'string',
    description: 'Runtime collector instance',
    overridePolicy: 'always',
  },
  {
    id: 'sf6',
    fieldName: 'tenant',
    value: 'default',
    type: 'string',
    description: 'Tenant scope for multi-tenant SIEM',
    overridePolicy: 'missing',
  },
]

export const DEFAULT_COMPUTED_FIELDS: ComputedFieldRow[] = [
  {
    id: 'cf1',
    fieldName: 'event_time',
    expression: 'parse_timestamp($.detection_time, "ISO8601")',
    type: 'datetime',
    description: 'Normalize detection timestamp to UTC',
  },
  {
    id: 'cf2',
    fieldName: 'host_name',
    expression: 'coalesce($.machine_name, $.hostname, "unknown")',
    type: 'string',
    description: 'Best-effort host identifier',
  },
  {
    id: 'cf3',
    fieldName: 'user_name',
    expression: 'coalesce($.user_name, $.principal, "unknown")',
    type: 'string',
    description: 'Interactive or service account context',
  },
  {
    id: 'cf4',
    fieldName: 'severity_level',
    expression: 'to_int($.severity, 0)',
    type: 'integer',
    description: 'Numeric severity for correlation rules',
  },
]

/** Resolved preview values when expressions are not evaluated in the UI build. */
const PREVIEW_RESOLVED_COMPUTED: Record<string, string | number> = {
  event_time: '2026-05-08T11:30:22.123Z',
  host_name: 'host-07.corp.example',
  user_name: 'user4',
  severity_level: 4,
}

export function buildEnrichedPreviewRecord(
  staticRows: readonly StaticFieldRow[],
  computedRows: readonly ComputedFieldRow[],
): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const s of staticRows) {
    out[s.fieldName] = s.value
  }
  for (const c of computedRows) {
    const resolved = PREVIEW_RESOLVED_COMPUTED[c.fieldName]
    if (resolved !== undefined) out[c.fieldName] = resolved
    else out[c.fieldName] = `⟨${c.expression}⟩`
  }
  return out
}
