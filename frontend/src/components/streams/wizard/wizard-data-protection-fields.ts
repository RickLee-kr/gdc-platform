import { isUnionFieldSensitive } from '../../../utils/unionSchemaFieldDisplay'
import type { UnionSchema } from '../../../utils/unionSchema'
import type { WizardSensitivityClass, WizardState } from './wizard-state'
import { collectWizardProtectionFieldCandidatesSync } from './wizard-data-protection-path-resolve'

function leafSegment(fieldPath: string): string {
  const trimmed = fieldPath.trim()
  const leaf = trimmed.split('.').pop() ?? trimmed
  return leaf.replace(/\[\d+\]/g, '').replace(/^\$\.?/, '').toLowerCase()
}

function normalizeSensitivityClass(value: string | null | undefined): WizardSensitivityClass | null {
  if (value === 'secret' || value === 'pii' || value === 'security_metadata') return value
  return null
}

export function inferWizardSensitivityClass(
  fieldPath: string,
  unionSchema?: UnionSchema | null,
): WizardSensitivityClass {
  const fields = unionSchema?.fields ?? []
  const exact = fields.find((field) => field.field_path === fieldPath)
  const exactClass = normalizeSensitivityClass(exact?.sensitivity_class)
  if (exactClass) return exactClass
  const leaf = leafSegment(fieldPath)
  const byLeaf = fields.find(
    (field) => leafSegment(field.field_path) === leaf && normalizeSensitivityClass(field.sensitivity_class),
  )
  const leafClass = normalizeSensitivityClass(byLeaf?.sensitivity_class)
  if (leafClass) return leafClass
  return 'pii'
}

export function normalizeWizardDetectedField(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('$')) return trimmed
  return `$.${trimmed}`
}

/** Candidate detected fields from the runtime enriched event preview (mapping + enrichment). */
export function collectWizardDetectedFieldCandidates(state: WizardState): string[] {
  return collectWizardProtectionFieldCandidatesSync(state)
}

export function suggestLikelySensitiveFieldsFromState(state: WizardState): string[] {
  const suggestedFields = (state.apiTest.unionSchema?.fields ?? []).filter(isUnionFieldSensitive)
  if (suggestedFields.length === 0) return []
  const suggestedLeaves = new Set(suggestedFields.map((field) => leafSegment(field.field_path)))
  const suggestedPaths = new Set(suggestedFields.map((field) => field.field_path))
  return collectWizardDetectedFieldCandidates(state).filter((path) => {
    return suggestedPaths.has(path) || suggestedLeaves.has(leafSegment(path))
  })
}

export function sensitivityClassLabel(sensitivityClass: WizardSensitivityClass): string {
  switch (sensitivityClass) {
    case 'secret':
      return 'Secret'
    case 'security_metadata':
      return 'Security metadata'
    default:
      return 'Personal data'
  }
}
