import { evaluateUnionFieldSuggestion } from './evaluateUnionFieldSuggestion'

export function isUnionFieldSensitive(
  fieldPath: string,
  sampleValues?: readonly unknown[],
  fieldType?: string,
): boolean {
  return evaluateUnionFieldSuggestion(fieldPath, fieldType, sampleValues).sensitive
}
