/**
 * Field Importance — Stream Wizard UX Charter v3.0
 *
 * Labels what blocks progress (required), what is strongly recommended, and what
 * is optional. Distinct from Transform mapping coverage tiers.
 */

export type FieldImportance = 'required' | 'recommended' | 'optional'

/** Sample & Record Selection — extraction path fields (Charter v3 Phase 2). */
export const SAMPLE_RECORD_FIELD_IMPORTANCE = {
  /** Repeating record array / event source — blocks Transform until confirmed. */
  recordPath: 'required' as const satisfies FieldImportance,
  /** Sub-object within each record — narrows mapping source; default is entire record. */
  eventRoot: 'optional' as const satisfies FieldImportance,
  /** Sync position / incremental cursor — blocks Transform until confirmed. */
  checkpoint: 'required' as const satisfies FieldImportance,
} as const

export type SampleRecordFieldKey = keyof typeof SAMPLE_RECORD_FIELD_IMPORTANCE

export const FIELD_IMPORTANCE_LABEL: Record<FieldImportance, string> = {
  required: 'Required',
  recommended: 'Recommended',
  optional: 'Optional',
}

export const FIELD_IMPORTANCE_HELP: Record<SampleRecordFieldKey, string> = {
  recordPath:
    'Which array in the response holds one event per item. You must click a candidate or tree row to confirm — suggestions never apply automatically.',
  eventRoot:
    'Optional sub-path inside each record when the useful fields live below a wrapper (e.g. $.event). Leave unset to use the whole record.',
  checkpoint:
    'Field used to track sync position for incremental polling. You must click a tree row to confirm — never auto-selected.',
}

/** Transform step — user-facing field importance (Charter v3 Phase 3). */
export const TRANSFORM_FIELD_IMPORTANCE = {
  /** At least one output field or transform expression before delivery. */
  outputFields: 'required' as const satisfies FieldImportance,
  /** Schema-target auto suggestions — strongly recommended when available. */
  metadataProfile: 'recommended' as const satisfies FieldImportance,
  /** Static, calculated, conditional, normalize, JSONata, regex rules. */
  transformRules: 'optional' as const satisfies FieldImportance,
  /** Final delivered event preview before leaving Transform. */
  outputVerification: 'recommended' as const satisfies FieldImportance,
} as const

export type TransformFieldKey = keyof typeof TRANSFORM_FIELD_IMPORTANCE

export const TRANSFORM_FIELD_IMPORTANCE_HELP: Record<TransformFieldKey, string> = {
  outputFields: 'Link source sample fields to output names. At least one output field or full-event expression is required.',
  metadataProfile: 'Apply vendor schema suggestions when your destination expects a known metadata shape.',
  transformRules: 'Add static values, calculations, conditionals, normalization, JSONata, or regex extract rules.',
  outputVerification: 'Review the final event shape that destinations will receive.',
}
