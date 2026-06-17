import {
  normalizeUnknownNormalFieldPolicy,
  normalizeUnknownSensitiveFieldPolicy,
} from '../components/streams/wizard/wizard-state'
import { schemaDriftPolicyReviewSummary } from '../components/streams/wizard/wizard-data-protection-summary'

export type StreamSchemaDriftPolicyLabels = {
  unknownNormalField: string
  unknownSensitiveField: string
}

/** Read deployed schema drift policy labels from streams.config_json (read-only display). */
export function schemaDriftPolicyLabelsFromStreamConfig(
  configJson: unknown,
): StreamSchemaDriftPolicyLabels {
  const root =
    configJson != null && typeof configJson === 'object' && !Array.isArray(configJson)
      ? (configJson as Record<string, unknown>)
      : {}
  const governance =
    root.governance != null && typeof root.governance === 'object' && !Array.isArray(root.governance)
      ? (root.governance as Record<string, unknown>)
      : {}
  const rawPolicy =
    governance.schema_drift_policy != null &&
    typeof governance.schema_drift_policy === 'object' &&
    !Array.isArray(governance.schema_drift_policy)
      ? (governance.schema_drift_policy as Record<string, unknown>)
      : {}

  return schemaDriftPolicyReviewSummary({
    unknownNormalFieldPolicy: normalizeUnknownNormalFieldPolicy(rawPolicy.unknown_normal_field_policy),
    unknownSensitiveFieldPolicy: normalizeUnknownSensitiveFieldPolicy(rawPolicy.unknown_sensitive_field_policy),
  })
}
