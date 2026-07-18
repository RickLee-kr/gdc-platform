/**
 * Enrichment rule types for the Stream Creation Wizard
 * (Static, Calculated, Lookup, Conditional, Normalize, Timestamp Conversion).
 */

import {
  type TimestampInputFormat,
  type TimestampOnFailure,
  type TimestampOutputFormat,
  type TimestampTimezoneMode,
  timestampFormatsEquivalent,
} from './timestamp-conversion-template'
import {
  type TypeConversionOnFailure,
  type TypeConversionTargetType,
  previewTypeConversion,
} from './type-conversion-template'
import {
  type NormalizeOnFailure,
  type NormalizeOperation,
  parseNormalizeOperation,
  previewNormalize,
} from './normalize-template'
import {
  type JsonataTemplateId,
  type JsonataTemplateParams,
  buildJsonataFromTemplate,
  defaultJsonataTemplateParams,
  parseJsonataTemplateId,
  previewJsonataTemplate,
  templateParamsFromStorage,
  templateParamsToStorage,
} from './jsonata-template-library'

export type EnrichmentRuleType =
  | 'static'
  | 'calculated'
  | 'lookup'
  | 'conditional'
  | 'normalize'
  | 'timestamp_conversion'
  | 'type_conversion'
  | 'jsonata'

export type WizardEnrichmentRule = {
  id: string
  /** Display label in the rule card header */
  label: string
  /** Target output field path */
  fieldName: string
  type: EnrichmentRuleType
  enabled: boolean
  /** Static Value */
  staticValue: string
  /** Calculated / JSONata expression */
  expression: string
  /** Lookup */
  lookupTable: string
  lookupKeyField: string
  /** Conditional */
  conditions: Array<{ id: string; when: string; then: string }>
  conditionalDefault: string
  /** Normalize */
  normalizeSourceField: string
  /** @deprecated Prefer normalizeOperation; kept for draft hydration. */
  normalizeFormat: NormalizeOperation
  normalizeOperation: NormalizeOperation
  normalizeOnFailure: NormalizeOnFailure
  /** Timestamp Conversion */
  tsSourceField: string
  tsInputFormat: TimestampInputFormat
  tsOutputFormat: TimestampOutputFormat
  tsTimezoneMode: TimestampTimezoneMode
  tsCustomTimezone: string
  tsOnFailure: TimestampOnFailure
  tsExpressionOverride: string
  /** Type Conversion */
  tcSourceField: string
  tcTargetType: TypeConversionTargetType
  tcOnFailure: TypeConversionOnFailure
  /** JSONata Template Library */
  jtTemplate: JsonataTemplateId | ''
  jtParams: JsonataTemplateParams
  /** True when the user edited the generated expression directly. */
  jtAdvancedOverride: boolean
}

export type EnrichmentRuleTypeMeta = {
  type: EnrichmentRuleType
  label: string
  shortLabel: string
  description: string
}

export const ENRICHMENT_RULE_TYPES: ReadonlyArray<EnrichmentRuleTypeMeta> = [
  { type: 'static', label: 'Static Value', shortLabel: 'Static', description: 'Set a fixed value' },
  { type: 'calculated', label: 'Calculated', shortLabel: 'Calculated', description: 'Expression-based computation' },
  { type: 'lookup', label: 'Lookup', shortLabel: 'Lookup', description: 'Reference lookup table' },
  { type: 'conditional', label: 'Conditional', shortLabel: 'Conditional', description: 'If-then logic' },
  { type: 'normalize', label: 'Normalize', shortLabel: 'Normalize', description: 'Trim, case, email/hostname cleanup' },
  {
    type: 'timestamp_conversion',
    label: 'Timestamp Conversion',
    shortLabel: 'Timestamp',
    description: 'Unix / ISO8601 / RFC3339 conversion',
  },
  {
    type: 'type_conversion',
    label: 'Type Conversion',
    shortLabel: 'Type',
    description: 'Coerce field values to String, Integer, Boolean, Array, etc.',
  },
  {
    type: 'jsonata',
    label: 'JSONata Template',
    shortLabel: 'JSONata',
    description: 'Generate JSONata from copy, concat, coalesce, and other templates',
  },
]

export const QUICK_ADD_PRESETS: ReadonlyArray<{ field: string; value: string; label: string }> = [
  { field: 'vendor', value: 'Cybereason', label: 'Vendor' },
  { field: 'product', value: 'EDR', label: 'Product' },
  { field: 'log_type', value: 'malop', label: 'Log type' },
  { field: 'event_source', value: 'connector', label: 'Event source' },
  { field: 'collector_name', value: 'gdc-collector', label: 'Collector' },
  { field: 'tenant', value: 'default', label: 'Tenant' },
]

export function newEnrichmentRuleId(): string {
  return `enr-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`
}

export function newConditionId(): string {
  return `cond-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`
}

function parseInputFormat(raw: unknown): TimestampInputFormat {
  const v = String(raw ?? 'auto').trim().toLowerCase()
  const allowed: TimestampInputFormat[] = [
    'unix_s',
    'unix_ms',
    'unix_us',
    'unix_ns',
    'iso8601',
    'rfc3339',
    'auto',
  ]
  return (allowed.includes(v as TimestampInputFormat) ? v : 'auto') as TimestampInputFormat
}

function parseOutputFormat(raw: unknown): TimestampOutputFormat {
  const v = String(raw ?? 'utc_iso8601').trim().toLowerCase()
  const allowed: TimestampOutputFormat[] = [
    'utc_iso8601',
    'unix_s',
    'unix_ms',
    'unix_us',
    'unix_ns',
    'rfc3339',
  ]
  return (allowed.includes(v as TimestampOutputFormat) ? v : 'utc_iso8601') as TimestampOutputFormat
}

function parseTimezoneMode(raw: unknown): TimestampTimezoneMode {
  const v = String(raw ?? 'utc').trim().toLowerCase()
  if (v === 'source' || v === 'custom') return v
  return 'utc'
}

/** Parse a timezone string that may be a mode or a bare IANA name. */
function parseTimezoneString(raw: string): { mode: TimestampTimezoneMode; iana: string } {
  const v = raw.trim()
  const lower = v.toLowerCase()
  if (!v || lower === 'utc') return { mode: 'utc', iana: '' }
  if (lower === 'source') return { mode: 'source', iana: '' }
  if (lower === 'custom') return { mode: 'custom', iana: '' }
  return { mode: 'custom', iana: v }
}

function parseOnFailure(raw: unknown): TimestampOnFailure {
  const v = String(raw ?? 'keep_original').trim().toLowerCase()
  const allowed: TimestampOnFailure[] = ['keep_original', 'set_null', 'drop_field', 'skip_event']
  return (allowed.includes(v as TimestampOnFailure) ? v : 'keep_original') as TimestampOnFailure
}

function parseTypeConversionOnFailure(raw: unknown): TypeConversionOnFailure {
  const v = String(raw ?? 'keep_original').trim().toLowerCase()
  const allowed: TypeConversionOnFailure[] = ['keep_original', 'set_null', 'drop_field', 'skip_event']
  return (allowed.includes(v as TypeConversionOnFailure) ? v : 'keep_original') as TypeConversionOnFailure
}

function parseTargetType(raw: unknown): TypeConversionTargetType {
  const v = String(raw ?? 'string').trim().toLowerCase()
  const allowed = [
    'string',
    'integer',
    'long',
    'float',
    'double',
    'boolean',
    'datetime',
    'array',
    'object',
    'json',
  ] as const
  return (allowed.includes(v as TypeConversionTargetType) ? v : 'string') as TypeConversionTargetType
}

function parseNormalizeOnFailure(raw: unknown): NormalizeOnFailure {
  const v = String(raw ?? 'keep_original').trim().toLowerCase()
  const allowed: NormalizeOnFailure[] = ['keep_original', 'set_null', 'drop_field', 'skip_event']
  return (allowed.includes(v as NormalizeOnFailure) ? v : 'keep_original') as NormalizeOnFailure
}

export type DefaultRuleOptions = {
  /** Prefill source field from Union Schema tree selection (runtime path, no ``$.``). */
  sourceField?: string | null
}

export function defaultRuleForType(
  type: EnrichmentRuleType,
  index: number,
  options?: DefaultRuleOptions,
): WizardEnrichmentRule {
  const n = index + 1
  const prefillSource = (options?.sourceField ?? '').trim()
  const base = {
    id: newEnrichmentRuleId(),
    enabled: true,
    fieldName: '',
    staticValue: '',
    expression: '',
    lookupTable: 'aws-regions',
    lookupKeyField: 'region',
    conditions: [{ id: newConditionId(), when: '', then: '' }],
    conditionalDefault: '',
    normalizeSourceField: 'email',
    normalizeFormat: 'normalize_email' as NormalizeOperation,
    normalizeOperation: 'normalize_email' as NormalizeOperation,
    normalizeOnFailure: 'keep_original' as const,
    tsSourceField: 'event_time',
    tsInputFormat: 'unix_ms' as const,
    tsOutputFormat: 'utc_iso8601' as const,
    tsTimezoneMode: 'utc' as const,
    tsCustomTimezone: '',
    tsOnFailure: 'keep_original' as const,
    tsExpressionOverride: '',
    tcSourceField: 'severity',
    tcTargetType: 'integer' as const,
    tcOnFailure: 'keep_original' as const,
    jtTemplate: 'copy_field' as const,
    jtParams: defaultJsonataTemplateParams(),
    jtAdvancedOverride: false,
  }
  switch (type) {
    case 'static':
      return { ...base, type, label: 'New Static', fieldName: `metadata.field_${n}`, staticValue: '' }
    case 'calculated':
      return {
        ...base,
        type,
        label: 'New Calculated',
        fieldName: `metadata.field_${n}`,
        expression: "eventName.includes('Delete') ? 8 : eventName.includes('Create') ? 5 : 3",
      }
    case 'lookup':
      return {
        ...base,
        type,
        label: 'Region Display Name',
        fieldName: 'metadata.cloud.region_name',
        lookupKeyField: 'region',
      }
    case 'conditional':
      return {
        ...base,
        type,
        label: 'Outcome Status',
        fieldName: 'metadata.outcome',
        conditions: [
          { id: newConditionId(), when: "status === 'success'", then: 'success' },
          { id: newConditionId(), when: "status === 'failure'", then: 'failure' },
        ],
        conditionalDefault: 'unknown',
      }
    case 'normalize': {
      const source = prefillSource || 'email'
      return {
        ...base,
        type,
        label: 'Normalize',
        // Target defaults to the same path as Source Field.
        fieldName: source,
        normalizeSourceField: source,
        normalizeFormat: 'normalize_email',
        normalizeOperation: 'normalize_email',
        normalizeOnFailure: 'keep_original',
      }
    }
    case 'timestamp_conversion': {
      const source = prefillSource || 'event_time'
      return {
        ...base,
        type,
        label: 'Timestamp Conversion',
        // Target defaults to the same path as Source Field.
        fieldName: source,
        tsSourceField: source,
        tsInputFormat: 'unix_ms',
        tsOutputFormat: 'utc_iso8601',
        tsTimezoneMode: 'utc',
        tsOnFailure: 'keep_original',
      }
    }
    case 'type_conversion':
      return {
        ...base,
        type,
        label: 'Type Conversion',
        fieldName: 'severity',
        tcSourceField: 'severity',
        tcTargetType: 'integer',
        tcOnFailure: 'keep_original',
      }
    case 'jsonata': {
      const jtParams = defaultJsonataTemplateParams()
      const jtTemplate: JsonataTemplateId = 'copy_field'
      return {
        ...base,
        type,
        label: 'JSONata Template',
        fieldName: 'copied_field',
        jtTemplate,
        jtParams,
        jtAdvancedOverride: false,
        expression: buildJsonataFromTemplate(jtTemplate, jtParams),
      }
    }
    default:
      return { ...base, type: 'static', label: 'New Static', fieldName: `metadata.field_${n}` }
  }
}

/** Legacy wizard rows `{ id, fieldName, value }` → rule model. */
export function normalizeWizardEnrichmentRule(raw: unknown): WizardEnrichmentRule | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string') return null

  if (typeof o.type === 'string' && ENRICHMENT_RULE_TYPES.some((t) => t.type === o.type)) {
    const type = o.type as EnrichmentRuleType
    const conditions = Array.isArray(o.conditions)
      ? o.conditions
          .map((c) => {
            if (!c || typeof c !== 'object') return null
            const row = c as Record<string, unknown>
            return {
              id: typeof row.id === 'string' ? row.id : newConditionId(),
              when: String(row.when ?? ''),
              then: String(row.then ?? ''),
            }
          })
          .filter((c): c is { id: string; when: string; then: string } => c != null)
      : [{ id: newConditionId(), when: '', then: '' }]

    const tzRaw = o.timezone
    let tsTimezoneMode: TimestampTimezoneMode = parseTimezoneMode(o.tsTimezoneMode)
    let tsCustomTimezone = String(o.tsCustomTimezone ?? '')
    if (tzRaw && typeof tzRaw === 'object') {
      const tz = tzRaw as Record<string, unknown>
      tsTimezoneMode = parseTimezoneMode(tz.mode)
      tsCustomTimezone = String(tz.iana ?? tz.timezone ?? tsCustomTimezone)
      if (tsTimezoneMode === 'custom' && !tsCustomTimezone.trim()) {
        const fallback = String(tz.iana ?? tz.timezone ?? tz.tz ?? '').trim()
        tsCustomTimezone = fallback
      }
    } else if (typeof tzRaw === 'string' && tzRaw.trim()) {
      const parsed = parseTimezoneString(tzRaw)
      tsTimezoneMode = parsed.mode
      if (parsed.iana) tsCustomTimezone = parsed.iana
    }

    const jtTemplate = parseJsonataTemplateId(o.jtTemplate ?? o.template)
    const jtParams = templateParamsFromStorage(o.jtParams ?? o.template_params ?? o.templateParams)
    let expression = String(o.expression ?? '')
    let jtAdvancedOverride =
      o.jtAdvancedOverride === true ||
      o.advanced_override === true ||
      o.advancedOverride === true
    if (type === 'jsonata') {
      if (!jtTemplate) {
        jtAdvancedOverride = true
      } else if (!jtAdvancedOverride) {
        const generated = buildJsonataFromTemplate(jtTemplate, jtParams)
        if (!expression.trim()) {
          expression = generated
        } else if (expression.trim() !== generated.trim()) {
          jtAdvancedOverride = true
        }
      }
    }

    return {
      id: o.id,
      label: String(o.label ?? 'Enrichment'),
      fieldName: String(o.fieldName ?? ''),
      type,
      enabled: o.enabled !== false,
      staticValue: String(o.staticValue ?? o.value ?? ''),
      expression,
      lookupTable: String(o.lookupTable ?? 'aws-regions'),
      lookupKeyField: String(o.lookupKeyField ?? ''),
      conditions: conditions.length > 0 ? conditions : [{ id: newConditionId(), when: '', then: '' }],
      conditionalDefault: String(o.conditionalDefault ?? ''),
      normalizeSourceField: String(
        o.normalizeSourceField ?? o.source_field ?? o.sourceField ?? 'email',
      ),
      normalizeFormat: parseNormalizeOperation(
        o.normalizeOperation ?? o.operation ?? o.normalizeFormat ?? o.format ?? 'normalize_email',
      ),
      normalizeOperation: parseNormalizeOperation(
        o.normalizeOperation ?? o.operation ?? o.normalizeFormat ?? o.format ?? 'normalize_email',
      ),
      normalizeOnFailure: parseNormalizeOnFailure(o.normalizeOnFailure ?? o.on_failure),
      tsSourceField: String(o.tsSourceField ?? o.source_field ?? 'event_time'),
      tsInputFormat: parseInputFormat(o.tsInputFormat ?? o.input_format),
      tsOutputFormat: parseOutputFormat(o.tsOutputFormat ?? o.output_format),
      tsTimezoneMode,
      tsCustomTimezone,
      tsOnFailure: parseOnFailure(o.tsOnFailure ?? o.on_failure),
      tsExpressionOverride: String(
        o.tsExpressionOverride ?? o.expression_override ?? o.jsonata_override ?? '',
      ),
      tcSourceField: String(o.tcSourceField ?? o.source_field ?? 'severity'),
      tcTargetType: parseTargetType(o.tcTargetType ?? o.target_type),
      tcOnFailure: parseTypeConversionOnFailure(o.tcOnFailure ?? o.on_failure),
      jtTemplate,
      jtParams,
      jtAdvancedOverride,
    }
  }

  if ('fieldName' in o || 'value' in o) {
    return {
      ...defaultRuleForType('static', 0),
      id: o.id,
      label: String(o.fieldName ?? 'Static'),
      fieldName: String(o.fieldName ?? ''),
      staticValue: String(o.value ?? ''),
      type: 'static',
      enabled: true,
    }
  }
  return null
}

export function normalizeWizardEnrichmentRules(raw: unknown): WizardEnrichmentRule[] {
  if (Array.isArray(raw)) {
    return raw.map((r) => normalizeWizardEnrichmentRule(r)).filter((r): r is WizardEnrichmentRule => r != null)
  }
  if (raw && typeof raw === 'object') {
    return enrichmentRulesFromDict(raw as Record<string, unknown>)
  }
  return []
}

/** Convert persisted enrichment_json (static keys + ``__rules``) into wizard rule rows. */
export function enrichmentRulesFromDict(enrichment: Record<string, unknown>): WizardEnrichmentRule[] {
  const rules: WizardEnrichmentRule[] = []
  const advanced = enrichment.__rules
  if (advanced && typeof advanced === 'object' && !Array.isArray(advanced)) {
    for (const [fieldName, ruleRaw] of Object.entries(advanced as Record<string, unknown>)) {
      if (!ruleRaw || typeof ruleRaw !== 'object') continue
      const rule = ruleRaw as Record<string, unknown>
      const type = String(rule.type ?? '')
      if (!ENRICHMENT_RULE_TYPES.some((t) => t.type === type)) continue
      const hydrated = normalizeWizardEnrichmentRule({
        ...rule,
        id: typeof rule.id === 'string' ? rule.id : newEnrichmentRuleId(),
        type,
        fieldName: String(rule.target_field ?? rule.fieldName ?? fieldName),
        label: String(rule.label ?? type),
        enabled: rule.enabled !== false,
      })
      if (hydrated) rules.push(hydrated)
    }
  }
  for (const [key, value] of Object.entries(enrichment)) {
    if (key.startsWith('__')) continue
    if (value !== null && typeof value === 'object') continue
    rules.push({
      ...defaultRuleForType('static', rules.length),
      id: newEnrichmentRuleId(),
      label: key,
      fieldName: key,
      staticValue: value == null ? '' : String(value),
      type: 'static',
      enabled: true,
    })
  }
  return rules
}

function isNowUtcTemplate(s: string): boolean {
  return s.trim().replace(/\s/g, '').toLowerCase() === '{{now_utc}}'
}

function isTemplateValue(s: string): boolean {
  const t = s.trim()
  return t.startsWith('{{') && t.includes('}}')
}

export function resolveStaticPreviewValue(raw: string): unknown {
  if (isNowUtcTemplate(raw)) return new Date().toISOString()
  return raw
}

export function enrichmentRuleSourceLabel(rule: WizardEnrichmentRule): string {
  if (rule.type === 'timestamp_conversion') return 'timestamp_conversion'
  if (rule.type === 'type_conversion') return 'type_conversion'
  if (rule.type === 'normalize') return 'normalize'
  if (rule.type === 'jsonata') return rule.jtTemplate ? `jsonata:${rule.jtTemplate}` : 'jsonata'
  if (rule.type !== 'static') return rule.type
  const v = rule.staticValue.trim()
  if (!v) return 'Static'
  if (isNowUtcTemplate(v)) return 'Auto (System Time)'
  if (isTemplateValue(v)) return 'Auto'
  return 'Static'
}

/** Sync generated expression from template params unless advanced override is enabled. */
export function syncJsonataExpression(rule: WizardEnrichmentRule): WizardEnrichmentRule {
  if (rule.type !== 'jsonata' || rule.jtAdvancedOverride) return rule
  if (!rule.jtTemplate) return rule
  return { ...rule, expression: buildJsonataFromTemplate(rule.jtTemplate, rule.jtParams) }
}

export function enrichmentDictFromRules(rules: readonly WizardEnrichmentRule[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const advanced: Record<string, unknown> = {}

  for (const rule of rules) {
    const key = rule.fieldName.trim()
    if (!key || !rule.enabled) continue

    if (rule.type === 'static') {
      out[key] = rule.staticValue
      continue
    }

    const payload: Record<string, unknown> = {
      type: rule.type,
      label: rule.label,
      enabled: rule.enabled,
    }
    if (rule.type === 'calculated') payload.expression = rule.expression
    if (rule.type === 'lookup') {
      payload.lookup_table = rule.lookupTable
      payload.lookup_key_field = rule.lookupKeyField
    }
    if (rule.type === 'conditional') {
      payload.conditions = rule.conditions.map((c) => ({ when: c.when, then: c.then }))
      payload.default = rule.conditionalDefault
    }
    if (rule.type === 'normalize') {
      payload.source_field = rule.normalizeSourceField
      payload.operation = rule.normalizeOperation || rule.normalizeFormat
      payload.on_failure = rule.normalizeOnFailure
    }
    if (rule.type === 'timestamp_conversion') {
      payload.source_field = rule.tsSourceField
      payload.input_format = rule.tsInputFormat
      payload.output_format = rule.tsOutputFormat
      payload.timezone =
        rule.tsTimezoneMode === 'custom'
          ? { mode: 'custom', iana: rule.tsCustomTimezone.trim() }
          : { mode: rule.tsTimezoneMode }
      payload.on_failure = rule.tsOnFailure
      if (rule.tsExpressionOverride.trim()) {
        payload.expression_override = rule.tsExpressionOverride.trim()
      }
    }
    if (rule.type === 'type_conversion') {
      payload.source_field = rule.tcSourceField
      payload.target_type = rule.tcTargetType
      payload.on_failure = rule.tcOnFailure
    }
    if (rule.type === 'jsonata') {
      const synced = syncJsonataExpression(rule)
      payload.expression = synced.expression
      payload.target_field = key
      if (synced.jtTemplate) {
        payload.template = synced.jtTemplate
        payload.template_params = templateParamsToStorage(synced.jtParams)
      }
      if (synced.jtAdvancedOverride) {
        payload.advanced_override = true
      }
    }
    advanced[key] = payload
  }

  if (Object.keys(advanced).length > 0) out.__rules = advanced
  return out
}

export function countRulesByType(rules: readonly WizardEnrichmentRule[]): Record<EnrichmentRuleType | 'all', number> {
  const active = rules.filter((r) => r.fieldName.trim() && r.enabled)
  const counts: Record<EnrichmentRuleType | 'all', number> = {
    all: active.length,
    static: 0,
    calculated: 0,
    lookup: 0,
    conditional: 0,
    normalize: 0,
    timestamp_conversion: 0,
    type_conversion: 0,
    jsonata: 0,
  }
  for (const r of active) counts[r.type] += 1
  return counts
}

export type EnrichmentIssueLike = {
  code: string
  severity?: 'error' | 'warning'
  message: string
  rule_type?: string | null
  target_field?: string | null
  field?: string | null
}

/** Match backend validation/preview issues to a wizard rule card. */
export function issuesForEnrichmentRule(
  rule: WizardEnrichmentRule,
  issues: readonly EnrichmentIssueLike[],
): EnrichmentIssueLike[] {
  const target = rule.fieldName.trim().toLowerCase()
  return issues.filter((issue) => {
    const issueTarget = (issue.target_field ?? '').trim().toLowerCase()
    if (target && issueTarget === target) return true
    if (!target && issue.rule_type === rule.type) return true
    return false
  })
}

/** Client-side validation for Timestamp Conversion cards. */
export function localTimestampConversionIssues(rule: WizardEnrichmentRule): EnrichmentIssueLike[] {
  if (rule.type !== 'timestamp_conversion' || !rule.enabled) return []
  const issues: EnrichmentIssueLike[] = []
  const target = rule.fieldName.trim()
  const source = rule.tsSourceField.trim()
  if (!source) {
    issues.push({
      code: 'missing_source_field',
      severity: 'error',
      message: 'Source field is required',
      rule_type: 'timestamp_conversion',
      target_field: target || null,
      field: 'source_field',
    })
  }
  if (!target) {
    issues.push({
      code: 'missing_target_field',
      severity: 'error',
      message: 'Target field is required',
      rule_type: 'timestamp_conversion',
      target_field: null,
      field: 'target_field',
    })
  }
  if (timestampFormatsEquivalent(rule.tsInputFormat, rule.tsOutputFormat)) {
    issues.push({
      code: 'timestamp_formats_identical',
      severity: 'warning',
      message: 'Input format and output format are the same; conversion may be a no-op',
      rule_type: 'timestamp_conversion',
      target_field: target || null,
      field: 'output_format',
    })
  }
  if (rule.tsTimezoneMode === 'custom' && !rule.tsCustomTimezone.trim()) {
    issues.push({
      code: 'invalid_timezone',
      severity: 'error',
      message: 'Custom timezone requires an IANA name (e.g. Asia/Seoul)',
      rule_type: 'timestamp_conversion',
      target_field: target || null,
      field: 'timezone',
    })
  }
  return issues
}

/** Client-side validation for Normalize cards. */
export function localNormalizeIssues(
  rule: WizardEnrichmentRule,
  sampleValue?: unknown,
): EnrichmentIssueLike[] {
  if (rule.type !== 'normalize' || !rule.enabled) return []
  const issues: EnrichmentIssueLike[] = []
  const target = rule.fieldName.trim()
  const source = rule.normalizeSourceField.trim()
  if (!source) {
    issues.push({
      code: 'missing_source_field',
      severity: 'error',
      message: 'Source field is required',
      rule_type: 'normalize',
      target_field: target || null,
      field: 'source_field',
    })
  }
  if (!target) {
    issues.push({
      code: 'missing_target_field',
      severity: 'error',
      message: 'Target field is required',
      rule_type: 'normalize',
      target_field: null,
      field: 'target_field',
    })
  }
  if (!rule.normalizeOperation) {
    issues.push({
      code: 'missing_normalize_operation',
      severity: 'error',
      message: 'Operation is required',
      rule_type: 'normalize',
      target_field: target || null,
      field: 'operation',
    })
  }
  if (sampleValue !== undefined && rule.normalizeOperation) {
    const { warning } = previewNormalize(sampleValue, rule.normalizeOperation)
    if (warning) {
      issues.push({
        code: 'normalize_preview_failed',
        severity: 'warning',
        message: `Sample value may not normalize: ${warning}`,
        rule_type: 'normalize',
        target_field: target || null,
        field: 'operation',
      })
    }
  }
  return issues
}

/** Client-side validation for Type Conversion cards. */
export function localTypeConversionIssues(
  rule: WizardEnrichmentRule,
  sampleValue?: unknown,
): EnrichmentIssueLike[] {
  if (rule.type !== 'type_conversion' || !rule.enabled) return []
  const issues: EnrichmentIssueLike[] = []
  const target = rule.fieldName.trim()
  const source = rule.tcSourceField.trim()
  if (!source) {
    issues.push({
      code: 'missing_source_field',
      severity: 'error',
      message: 'Source field is required',
      rule_type: 'type_conversion',
      target_field: target || null,
      field: 'source_field',
    })
  }
  if (!target) {
    issues.push({
      code: 'missing_target_field',
      severity: 'error',
      message: 'Target field is required',
      rule_type: 'type_conversion',
      target_field: null,
      field: 'target_field',
    })
  }
  if (!rule.tcTargetType) {
    issues.push({
      code: 'missing_target_type',
      severity: 'error',
      message: 'Target type is required',
      rule_type: 'type_conversion',
      target_field: target || null,
      field: 'target_type',
    })
  }
  if (sampleValue !== undefined && rule.tcTargetType) {
    const { warning } = previewTypeConversion(sampleValue, rule.tcTargetType)
    if (warning) {
      issues.push({
        code: 'type_conversion_preview_failed',
        severity: 'warning',
        message: `Sample value may not convert: ${warning}`,
        rule_type: 'type_conversion',
        target_field: target || null,
        field: 'target_type',
      })
    }
  }
  return issues
}

/** Client-side validation for JSONata Template cards. */
export function localJsonataTemplateIssues(
  rule: WizardEnrichmentRule,
  sampleEvent?: Record<string, unknown>,
): EnrichmentIssueLike[] {
  if (rule.type !== 'jsonata' || !rule.enabled) return []
  const issues: EnrichmentIssueLike[] = []
  const target = rule.fieldName.trim()
  if (!target) {
    issues.push({
      code: 'missing_target_field',
      severity: 'error',
      message: 'Target field is required',
      rule_type: 'jsonata',
      target_field: null,
      field: 'target_field',
    })
  }
  const expression = rule.jtAdvancedOverride
    ? rule.expression.trim()
    : (rule.expression.trim() || buildJsonataFromTemplate(rule.jtTemplate, rule.jtParams).trim())
  if (!expression) {
    issues.push({
      code: 'jsonata_expression_empty',
      severity: 'error',
      message: 'JSONata expression is required',
      rule_type: 'jsonata',
      target_field: target || null,
      field: 'expression',
    })
  }
  if (rule.jtTemplate === 'concat_fields' && rule.jtParams.sourceFields.filter((f) => f.trim()).length < 1) {
    issues.push({
      code: 'missing_source_fields',
      severity: 'error',
      message: 'At least one source field is required',
      rule_type: 'jsonata',
      target_field: target || null,
      field: 'source_fields',
    })
  }
  if (
    (rule.jtTemplate === 'copy_field' ||
      rule.jtTemplate === 'rename_field' ||
      rule.jtTemplate === 'default_value' ||
      rule.jtTemplate === 'array_join') &&
    !rule.jtParams.sourceField.trim()
  ) {
    issues.push({
      code: 'missing_source_field',
      severity: 'error',
      message: 'Source field is required',
      rule_type: 'jsonata',
      target_field: target || null,
      field: 'source_field',
    })
  }
  if (sampleEvent && rule.jtTemplate && !rule.jtAdvancedOverride) {
    const { warning } = previewJsonataTemplate(sampleEvent, rule.jtTemplate, rule.jtParams)
    if (warning && !warning.includes('Advanced override')) {
      issues.push({
        code: 'jsonata_preview_failed',
        severity: 'warning',
        message: warning,
        rule_type: 'jsonata',
        target_field: target || null,
        field: 'expression',
      })
    }
  }
  return issues
}

export function countDuplicateEnrichmentFieldNames(rules: readonly WizardEnrichmentRule[]): number {
  const counts = new Map<string, number>()
  for (const rule of rules) {
    const k = rule.fieldName.trim().toLowerCase()
    if (!k) continue
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  let dups = 0
  for (const n of counts.values()) {
    if (n > 1) dups += n - 1
  }
  return dups
}
