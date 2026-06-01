/** Advanced Transform UI models (Safe Expression Engine; no AI). */

export type TransformPreviewStage = 'mapping' | 'enrichment'

export type AdvancedTransformUiMode = 'advanced' | 'expert'

export type AdvancedTransformEngineMode = 'jsonata' | 'regex_extract'

export type AdvancedTransformRuleDraft = {
  id: string
  uiMode: AdvancedTransformUiMode
  outputField: string
  mode: AdvancedTransformEngineMode
  expression: string
  sourcePath: string
  pattern: string
  group: number
  defaultValue: string
  ruleId: string
}

export function newAdvancedTransformRuleId(): string {
  return `at-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`
}

export function defaultAdvancedRule(uiMode: AdvancedTransformUiMode): AdvancedTransformRuleDraft {
  return {
    id: newAdvancedTransformRuleId(),
    uiMode,
    outputField: '',
    mode: uiMode === 'expert' ? 'regex_extract' : 'jsonata',
    expression: '',
    sourcePath: '$.message',
    pattern: '',
    group: 1,
    defaultValue: '',
    ruleId: '',
  }
}
