/**
 * JSONata Template Library — generates enrichment JSONata expressions from form inputs.
 * Runtime evaluates the stored expression only; template metadata is for UI restore.
 */

export type JsonataTemplateId =
  | 'copy_field'
  | 'rename_field'
  | 'concat_fields'
  | 'default_value'
  | 'coalesce'
  | 'conditional_value'
  | 'array_join'
  | 'extract_nested'
  | 'static_value'
  | 'build_object'

export type JsonataConditionalOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'is_empty'
  | 'is_not_empty'

export type JsonataObjectPair = {
  id: string
  key: string
  valueField: string
}

export type JsonataTemplateParams = {
  sourceField: string
  sourceFields: string[]
  separator: string
  defaultValue: string
  conditionField: string
  operator: JsonataConditionalOperator
  compareValue: string
  thenValue: string
  elseValue: string
  sourcePath: string
  staticValue: string
  objectPairs: JsonataObjectPair[]
}

export const JSONATA_TEMPLATE_OPTIONS: ReadonlyArray<{
  value: JsonataTemplateId
  label: string
  description: string
}> = [
  { value: 'copy_field', label: 'Copy Field', description: 'Copy a field value to a new target' },
  { value: 'rename_field', label: 'Rename Field', description: 'Map a source field to a new name' },
  { value: 'concat_fields', label: 'Concat Fields', description: 'Join multiple fields with a separator' },
  { value: 'default_value', label: 'Default Value', description: 'Use a default when source is empty' },
  { value: 'coalesce', label: 'Coalesce First Non-empty', description: 'First non-empty value from a list' },
  { value: 'conditional_value', label: 'Conditional Value', description: 'If-then-else based on a field' },
  { value: 'array_join', label: 'Array Join', description: 'Join array elements into a string' },
  { value: 'extract_nested', label: 'Extract Nested Field', description: 'Read a nested path into a target' },
  { value: 'static_value', label: 'Static Value', description: 'Set a constant value via JSONata' },
  { value: 'build_object', label: 'Build Object', description: 'Build an object from key/field pairs' },
]

export const JSONATA_CONDITIONAL_OPERATOR_OPTIONS: ReadonlyArray<{
  value: JsonataConditionalOperator
  label: string
}> = [
  { value: 'eq', label: 'Equals' },
  { value: 'neq', label: 'Not equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'is_empty', label: 'Is empty' },
  { value: 'is_not_empty', label: 'Is not empty' },
]

export function newJsonataPairId(): string {
  return `jtp-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`
}

export function defaultJsonataTemplateParams(): JsonataTemplateParams {
  return {
    sourceField: 'source_field',
    sourceFields: ['first_name', 'last_name'],
    separator: ' ',
    defaultValue: 'unknown',
    conditionField: 'status',
    operator: 'eq',
    compareValue: 'success',
    thenValue: 'ok',
    elseValue: 'fail',
    sourcePath: 'user.email',
    staticValue: 'static',
    objectPairs: [
      { id: newJsonataPairId(), key: 'id', valueField: 'user_id' },
      { id: newJsonataPairId(), key: 'name', valueField: 'user_name' },
    ],
  }
}

export function parseJsonataTemplateId(raw: unknown): JsonataTemplateId | '' {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
  const aliases: Record<string, JsonataTemplateId> = {
    copy: 'copy_field',
    rename: 'rename_field',
    concat: 'concat_fields',
    coalesce_first_non_empty: 'coalesce',
    conditional: 'conditional_value',
    join: 'array_join',
    extract: 'extract_nested',
    extract_nested_field: 'extract_nested',
    static: 'static_value',
    object: 'build_object',
  }
  const resolved = (aliases[v] ?? v) as JsonataTemplateId
  return JSONATA_TEMPLATE_OPTIONS.some((o) => o.value === resolved) ? resolved : ''
}

export function parseJsonataConditionalOperator(raw: unknown): JsonataConditionalOperator {
  const v = String(raw ?? 'eq')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
  const aliases: Record<string, JsonataConditionalOperator> = {
    '==': 'eq',
    '=': 'eq',
    equals: 'eq',
    '!=': 'neq',
    not_equals: 'neq',
    includes: 'contains',
    empty: 'is_empty',
    not_empty: 'is_not_empty',
  }
  const resolved = (aliases[v] ?? v) as JsonataConditionalOperator
  return JSONATA_CONDITIONAL_OPERATOR_OPTIONS.some((o) => o.value === resolved) ? resolved : 'eq'
}

export function jsonataTemplateLabel(id: JsonataTemplateId | ''): string {
  if (!id) return 'Advanced JSONata'
  return JSONATA_TEMPLATE_OPTIONS.find((o) => o.value === id)?.label ?? id
}

/** Build a JSONata field reference from a dotted path (supports @-prefixed keys). */
export function jsonataFieldRef(path: string): string {
  const key = path.trim()
  if (!key) return 'null'
  if (!key.includes('.') && (key.startsWith('@') || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))) {
    return `$lookup($, ${jsonataStringLiteral(key)})`
  }
  return key
    .split('.')
    .map((part, idx) => {
      if (idx === 0) return part
      return /^[A-Za-z_][A-Za-z0-9_]*$/.test(part) ? `.${part}` : `."${part}"`
    })
    .join('')
}

export function jsonataStringLiteral(value: string): string {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function jsonataStaticLiteral(raw: string): string {
  const text = raw.trim()
  if (text === '') return "''"
  if (text === 'null') return 'null'
  if (text === 'true') return 'true'
  if (text === 'false') return 'false'
  if (/^-?\d+(\.\d+)?$/.test(text)) return text
  if (
    (text.startsWith('{') && text.endsWith('}')) ||
    (text.startsWith('[') && text.endsWith(']'))
  ) {
    return text
  }
  return jsonataStringLiteral(text)
}

function nonEmptyExpr(ref: string): string {
  return `$exists(${ref}) and ${ref} != null and $string(${ref}) != ''`
}

function coalesceChain(fields: string[]): string {
  const refs = fields.map((f) => f.trim()).filter(Boolean).map(jsonataFieldRef)
  if (refs.length === 0) return 'null'
  let expr = 'null'
  for (let i = refs.length - 1; i >= 0; i -= 1) {
    const ref = refs[i]!
    expr = `(${nonEmptyExpr(ref)} ? ${ref} : ${expr})`
  }
  return expr
}

export function buildJsonataFromTemplate(
  template: JsonataTemplateId | '',
  params: JsonataTemplateParams,
): string {
  if (!template) return ''
  switch (template) {
    case 'copy_field':
    case 'rename_field':
      return jsonataFieldRef(params.sourceField || 'source_field')
    case 'extract_nested':
      return jsonataFieldRef(params.sourcePath || params.sourceField || 'field')
    case 'concat_fields': {
      const fields = (params.sourceFields.length > 0 ? params.sourceFields : [params.sourceField])
        .map((f) => f.trim())
        .filter(Boolean)
      const refs = fields.map(jsonataFieldRef)
      if (refs.length === 0) return "''"
      if (refs.length === 1) return `$string(${refs[0]})`
      return `$join([${refs.map((r) => `$string(${r})`).join(', ')}], ${jsonataStringLiteral(params.separator)})`
    }
    case 'default_value': {
      const src = jsonataFieldRef(params.sourceField || 'source_field')
      return `(${nonEmptyExpr(src)} ? ${src} : ${jsonataStaticLiteral(params.defaultValue)})`
    }
    case 'coalesce': {
      const fields =
        params.sourceFields.length > 0
          ? params.sourceFields
          : [params.sourceField].filter((f) => f.trim())
      return coalesceChain(fields)
    }
    case 'conditional_value': {
      const field = jsonataFieldRef(params.conditionField || 'status')
      const thenLit = jsonataStaticLiteral(params.thenValue)
      const elseLit = jsonataStaticLiteral(params.elseValue)
      const op = params.operator
      let cond: string
      if (op === 'is_empty') {
        cond = `not (${nonEmptyExpr(field)})`
      } else if (op === 'is_not_empty') {
        cond = nonEmptyExpr(field)
      } else if (op === 'contains') {
        cond = `$contains($string(${field}), ${jsonataStringLiteral(params.compareValue)})`
      } else if (op === 'neq') {
        cond = `$string(${field}) != ${jsonataStringLiteral(params.compareValue)}`
      } else {
        cond = `$string(${field}) = ${jsonataStringLiteral(params.compareValue)}`
      }
      return `(${cond} ? ${thenLit} : ${elseLit})`
    }
    case 'array_join': {
      const src = jsonataFieldRef(params.sourceField || 'tags')
      return `$join(${src}, ${jsonataStringLiteral(params.separator)})`
    }
    case 'static_value':
      return jsonataStaticLiteral(params.staticValue)
    case 'build_object': {
      const pairs = params.objectPairs
        .map((p) => ({ key: p.key.trim(), valueField: p.valueField.trim() }))
        .filter((p) => p.key && p.valueField)
      if (pairs.length === 0) return '{}'
      const body = pairs
        .map((p) => `${jsonataStringLiteral(p.key)}: ${jsonataFieldRef(p.valueField)}`)
        .join(', ')
      return `{${body}}`
    }
    default:
      return ''
  }
}

function getPathValue(event: Record<string, unknown>, path: string): unknown {
  const key = path.trim()
  if (!key) return undefined
  if (!key.includes('.')) return event[key]
  const parts = key.split('.')
  let cur: unknown = event
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function isNonEmpty(value: unknown): boolean {
  if (value == null) return false
  return String(value).trim() !== ''
}

/**
 * Client-side preview for template rules (does not require a JSONata engine).
 * Failures return a warning and never throw.
 */
export function previewJsonataTemplate(
  sampleEvent: Record<string, unknown> | undefined,
  template: JsonataTemplateId | '',
  params: JsonataTemplateParams,
  expressionOverride?: string,
): { value: unknown; warning: string | null; before: unknown } {
  try {
    if (expressionOverride?.trim() && template) {
      // Advanced override: show that preview uses runtime enrichment exec.
      return {
        value: null,
        warning: 'Advanced override enabled — preview uses runtime enrichment when available',
        before: null,
      }
    }
    if (!template) {
      return { value: null, warning: expressionOverride?.trim() ? null : 'Select a template', before: null }
    }
    if (!sampleEvent) {
      return { value: null, warning: 'No sample event for preview', before: null }
    }

    switch (template) {
      case 'copy_field':
      case 'rename_field': {
        const before = getPathValue(sampleEvent, params.sourceField)
        return { value: before ?? null, warning: before === undefined ? 'Source field missing in sample' : null, before }
      }
      case 'extract_nested': {
        const path = params.sourcePath || params.sourceField
        const before = getPathValue(sampleEvent, path)
        return { value: before ?? null, warning: before === undefined ? 'Source path missing in sample' : null, before }
      }
      case 'concat_fields': {
        const fields = (params.sourceFields.length > 0 ? params.sourceFields : [params.sourceField])
          .map((f) => f.trim())
          .filter(Boolean)
        const parts = fields.map((f) => getPathValue(sampleEvent, f))
        const value = parts.map((p) => (p == null ? '' : String(p))).join(params.separator)
        return { value, warning: null, before: parts }
      }
      case 'default_value': {
        const before = getPathValue(sampleEvent, params.sourceField)
        const value = isNonEmpty(before) ? before : params.defaultValue
        return { value, warning: null, before }
      }
      case 'coalesce': {
        const fields =
          params.sourceFields.length > 0
            ? params.sourceFields
            : [params.sourceField].filter((f) => f.trim())
        const values = fields.map((f) => getPathValue(sampleEvent, f))
        const value = values.find(isNonEmpty) ?? null
        return { value, warning: null, before: values }
      }
      case 'conditional_value': {
        const before = getPathValue(sampleEvent, params.conditionField)
        const text = before == null ? '' : String(before)
        let matched = false
        if (params.operator === 'is_empty') matched = !isNonEmpty(before)
        else if (params.operator === 'is_not_empty') matched = isNonEmpty(before)
        else if (params.operator === 'contains') matched = text.includes(params.compareValue)
        else if (params.operator === 'neq') matched = text !== params.compareValue
        else matched = text === params.compareValue
        return {
          value: matched ? params.thenValue : params.elseValue,
          warning: null,
          before,
        }
      }
      case 'array_join': {
        const before = getPathValue(sampleEvent, params.sourceField)
        if (!Array.isArray(before)) {
          return {
            value: null,
            warning: before === undefined ? 'Source field missing in sample' : 'Source is not an array',
            before,
          }
        }
        return { value: before.map((x) => String(x)).join(params.separator), warning: null, before }
      }
      case 'static_value': {
        const lit = params.staticValue.trim()
        if (lit === 'null') return { value: null, warning: null, before: null }
        if (lit === 'true') return { value: true, warning: null, before: null }
        if (lit === 'false') return { value: false, warning: null, before: null }
        if (/^-?\d+(\.\d+)?$/.test(lit)) return { value: Number(lit), warning: null, before: null }
        try {
          if (
            (lit.startsWith('{') && lit.endsWith('}')) ||
            (lit.startsWith('[') && lit.endsWith(']'))
          ) {
            return { value: JSON.parse(lit), warning: null, before: null }
          }
        } catch {
          /* fall through to string */
        }
        return { value: params.staticValue, warning: null, before: null }
      }
      case 'build_object': {
        const out: Record<string, unknown> = {}
        for (const pair of params.objectPairs) {
          const key = pair.key.trim()
          const vf = pair.valueField.trim()
          if (!key || !vf) continue
          out[key] = getPathValue(sampleEvent, vf) ?? null
        }
        return { value: out, warning: null, before: null }
      }
      default:
        return { value: null, warning: 'Unknown template', before: null }
    }
  } catch (e) {
    return {
      value: null,
      warning: e instanceof Error ? e.message : String(e),
      before: null,
    }
  }
}

export function templateParamsToStorage(params: JsonataTemplateParams): Record<string, unknown> {
  return {
    source_field: params.sourceField,
    source_fields: [...params.sourceFields],
    separator: params.separator,
    default_value: params.defaultValue,
    condition_field: params.conditionField,
    operator: params.operator,
    compare_value: params.compareValue,
    then_value: params.thenValue,
    else_value: params.elseValue,
    source_path: params.sourcePath,
    static_value: params.staticValue,
    object_pairs: params.objectPairs.map((p) => ({
      key: p.key,
      value_field: p.valueField,
    })),
  }
}

export function templateParamsFromStorage(raw: unknown): JsonataTemplateParams {
  const base = defaultJsonataTemplateParams()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const o = raw as Record<string, unknown>
  const sourceFieldsRaw = o.source_fields ?? o.sourceFields
  const sourceFields = Array.isArray(sourceFieldsRaw)
    ? sourceFieldsRaw.map((x) => String(x ?? '').trim()).filter(Boolean)
    : base.sourceFields
  const pairsRaw = o.object_pairs ?? o.objectPairs
  const objectPairs = Array.isArray(pairsRaw)
    ? pairsRaw
        .map((item) => {
          if (!item || typeof item !== 'object') return null
          const row = item as Record<string, unknown>
          return {
            id: typeof row.id === 'string' ? row.id : newJsonataPairId(),
            key: String(row.key ?? ''),
            valueField: String(row.value_field ?? row.valueField ?? ''),
          }
        })
        .filter((p): p is JsonataObjectPair => p != null)
    : base.objectPairs
  return {
    sourceField: String(o.source_field ?? o.sourceField ?? base.sourceField),
    sourceFields: sourceFields.length > 0 ? sourceFields : base.sourceFields,
    separator: String(o.separator ?? base.separator),
    defaultValue: String(o.default_value ?? o.defaultValue ?? base.defaultValue),
    conditionField: String(o.condition_field ?? o.conditionField ?? base.conditionField),
    operator: parseJsonataConditionalOperator(o.operator),
    compareValue: String(o.compare_value ?? o.compareValue ?? base.compareValue),
    thenValue: String(o.then_value ?? o.thenValue ?? base.thenValue),
    elseValue: String(o.else_value ?? o.elseValue ?? base.elseValue),
    sourcePath: String(o.source_path ?? o.sourcePath ?? base.sourcePath),
    staticValue: String(o.static_value ?? o.staticValue ?? base.staticValue),
    objectPairs: objectPairs.length > 0 ? objectPairs : base.objectPairs,
  }
}
