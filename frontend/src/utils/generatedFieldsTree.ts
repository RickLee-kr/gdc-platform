import type {
  EnrichmentRuleType,
  WizardEnrichmentRule,
} from '../components/streams/wizard/enrichment-rules-model'
import { ENRICHMENT_RULE_TYPES } from '../components/streams/wizard/enrichment-rules-model'
import type { UnionSchemaField } from './unionSchema'

export const GENERATED_FIELDS_ROOT_PATH = '$.__generated_fields__'
export const GENERATED_FIELD_FREQUENCY_LABEL = 'generated'

export type GeneratedFieldTreeNode = {
  label: string
  path: string
  field: UnionSchemaField
  rule: WizardEnrichmentRule
}

export function enrichmentFieldNameToJsonPath(fieldName: string): string {
  const trimmed = fieldName.trim()
  if (!trimmed) return ''
  return trimmed.startsWith('$') ? trimmed : `$.${trimmed}`
}

export function visibleGeneratedEnrichmentRules(
  rules: readonly WizardEnrichmentRule[],
): WizardEnrichmentRule[] {
  return rules.filter((rule) => rule.enabled && rule.fieldName.trim())
}

export function generatedFieldRuleTypeLabel(type: EnrichmentRuleType): string {
  return ENRICHMENT_RULE_TYPES.find((meta) => meta.type === type)?.label ?? type
}

export function ruleToSyntheticUnionField(rule: WizardEnrichmentRule): UnionSchemaField {
  const field_path = enrichmentFieldNameToJsonPath(rule.fieldName)
  const field_type = rule.type === 'static' ? 'string' : 'generated'
  const sample_values =
    rule.type === 'static' && rule.staticValue.trim() ? [rule.staticValue] : []

  return {
    field_path,
    field_type,
    occurrence_count: 0,
    sample_values,
  }
}

export function buildGeneratedFieldTreeNodes(
  rules: readonly WizardEnrichmentRule[],
): GeneratedFieldTreeNode[] {
  return visibleGeneratedEnrichmentRules(rules).map((rule) => {
    const path = enrichmentFieldNameToJsonPath(rule.fieldName)
    const leaf = path.split('.').pop() ?? rule.fieldName.trim()
    const label = leaf.replace(/\[\d+\]/g, '')
    return {
      label,
      path,
      field: ruleToSyntheticUnionField(rule),
      rule,
    }
  })
}

export function generatedFieldPathMap(
  rules: readonly WizardEnrichmentRule[],
): Map<string, WizardEnrichmentRule> {
  const map = new Map<string, WizardEnrichmentRule>()
  for (const rule of visibleGeneratedEnrichmentRules(rules)) {
    map.set(enrichmentFieldNameToJsonPath(rule.fieldName), rule)
  }
  return map
}

export function isGeneratedFieldPath(
  path: string,
  rules: readonly WizardEnrichmentRule[],
): boolean {
  return generatedFieldPathMap(rules).has(path)
}
