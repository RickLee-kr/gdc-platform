import type { TransformPreviewResponse } from '../../../api/gdcRuntimePreview'
import { resolveJsonPath } from '../mapping-jsonpath'
import type { FullEventRegexConfigDocument } from './wizard-full-event-regex-config'

export function buildWizardJsonataPreviewFieldMappings(jsonataExpression: string): Record<string, unknown> {
  return {
    mapping_mode: 'full_event_jsonata',
    jsonata_expression: jsonataExpression.trim(),
  }
}

function applyRegexConfigLocal(
  sampleEvent: Record<string, unknown>,
  config: FullEventRegexConfigDocument,
): { transformed: Record<string, unknown>; errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const base: Record<string, unknown> = config.preserve_source ? { ...sampleEvent } : {}

  for (const rule of config.rules) {
    const raw = resolveJsonPath(sampleEvent, rule.source_path)
    let sourceText: string | null = null
    if (typeof raw === 'string') {
      sourceText = raw
    } else if (raw === null || raw === undefined) {
      sourceText = null
    } else if (Array.isArray(raw) || (typeof raw === 'object' && raw !== null)) {
      try {
        sourceText = JSON.stringify(raw)
      } catch {
        sourceText = String(raw)
      }
    } else {
      sourceText = String(raw)
    }
    if (sourceText == null) {
      if (rule.default !== undefined) {
        base[rule.output_field] = rule.default
        warnings.push(`${rule.output_field}: source missing; used default`)
      } else {
        errors.push(`${rule.output_field}: source at ${rule.source_path} is missing`)
      }
      continue
    }
    try {
      const re = new RegExp(rule.pattern)
      const match = re.exec(sourceText)
      const groupIdx = rule.group > 0 ? rule.group : 1
      if (match && match[groupIdx] !== undefined) {
        base[rule.output_field] = match[groupIdx]
      } else if (rule.default !== undefined) {
        base[rule.output_field] = rule.default
        warnings.push(`${rule.output_field}: no match; used default`)
      } else {
        errors.push(`${rule.output_field}: pattern did not match`)
      }
    } catch (e) {
      errors.push(`${rule.output_field}: invalid pattern (${e instanceof Error ? e.message : 'error'})`)
    }
  }

  return { transformed: base, errors, warnings }
}

function applyJsonataLocal(
  sampleEvent: Record<string, unknown>,
  expression: string,
): { transformed: Record<string, unknown>; errors: string[]; warnings: string[] } {
  const trimmed = expression.trim()
  if (!trimmed) {
    return { transformed: {}, errors: ['Enter a JSONata expression before previewing.'], warnings: [] }
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return {
          transformed: { ...sampleEvent, ...(parsed as Record<string, unknown>) },
          errors: [],
          warnings: [],
        }
      }
    } catch {
      /* fall through */
    }
  }

  return {
    transformed: { ...sampleEvent },
    errors: [],
    warnings: ['Local preview: JSONata engine unavailable in wizard; showing source event.'],
  }
}

export function runWizardLocalTransformPreview(
  sampleEvent: Record<string, unknown>,
  options: {
    isExpert: boolean
    regexConfig?: FullEventRegexConfigDocument
    expression?: string
  },
): TransformPreviewResponse {
  const { isExpert, regexConfig, expression = '' } = options
  const result = isExpert && regexConfig
    ? applyRegexConfigLocal(sampleEvent, regexConfig)
    : applyJsonataLocal(sampleEvent, expression)

  const topKeys = Object.keys(sampleEvent)
  return {
    stage: 'mapping',
    input_sample_summary: {
      is_object: true,
      top_level_keys: topKeys.slice(0, 12),
      top_level_key_count: topKeys.length,
      keys_truncated: topKeys.length > 12,
    },
    transformed_result: result.transformed,
    field_results: [],
    errors: result.errors.map((message) => ({ level: 'event' as const, message })),
    warnings: result.warnings.map((message) => ({ level: 'field' as const, message })),
    save_blocked: result.errors.length > 0,
    duration_ms: 0,
    message:
      result.errors.length > 0
        ? 'Preview completed with errors.'
        : result.warnings.length > 0
          ? 'Preview completed with warnings.'
          : 'Preview OK.',
  }
}
