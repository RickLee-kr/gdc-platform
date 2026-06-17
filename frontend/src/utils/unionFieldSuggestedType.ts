import { evaluateUnionFieldSuggestion } from './evaluateUnionFieldSuggestion'

/** Union Schema Field Detail Panel — Likely * suggested type labels. */
export function suggestUnionFieldTypeLabel(
  fieldPath: string,
  sampleValues?: readonly unknown[],
  fieldType?: string,
): string {
  return evaluateUnionFieldSuggestion(fieldPath, fieldType, sampleValues).suggestedType ?? '—'
}
